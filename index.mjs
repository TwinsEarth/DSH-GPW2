/**
 * A global approval answerer with a hard rate limit and a mandatory gap.
 *
 * ## What it does
 *
 * It answers DSH's `approval/request` waterfall, and it either **auto-approves** or **defers to the
 * human**. There is no third behaviour: it never rejects.
 *
 * | condition | outcome |
 * |---|---|
 * | fewer than `maxPerWindow` auto-approvals in the last `windowMs`, **and** at least `minGapMs` since the previous auto-approval | `'allowed-once'` |
 * | either limit is reached | `next()` -- the request falls through to the real answerer (your UI prompt) and **waits** for it |
 *
 * Defaults, which are the requested setting: **10 per rolling 60 s, at least 3 s apart, globally**.
 *
 * ## Why the return value looks like that
 *
 * `ApprovalOutcome` is a closed vocabulary -- `'allowed-once' | 'rejected' | 'cancelled' |
 * 'unavailable'` -- and `'allowed-once'` is the only value that grants anything. The seam's own
 * documented rule is that "a rogue non-vocabulary return value is normalized to `'unavailable'`",
 * so a listener that returns something inventive fails the request *closed*, not open. Returning
 * `next()` means "no opinion", which is what preserves the human path.
 *
 * The `never` policy needs no handling here: the approval service enforces it **before** waterfall
 * dispatch, so a listener registered with `prepend` cannot bypass it. When the operator has chosen
 * "never", this plugin is simply never consulted.
 *
 * ## The honest tradeoff, stated where the code is
 *
 * Every auto-approval is a permission decision made without a human reading it. The rate limit bounds
 * *how often* that can happen and how fast, and nothing else. It is deliberately not a content check,
 * and it is deliberately not the `Auto` preset (`@deepseek-ai/dsh-experimental-auto-review`), which
 * puts a model in the loop to review each request and costs a model call per approval. This is the
 * cheaper, blunter mechanism: a machine that is being asked too often gets a bounded, audible
 * amount of autonomy, and everything past that comes back to a person.
 *
 * ## Scope
 *
 * The counters are process-global and deliberately not per-session: the requirement is a *global*
 * ceiling, so ten approvals consumed by one session reduce what every other session may get. A
 * per-session cap would let N sessions each spend the full budget, which is a different guarantee
 * than the one asked for.
 */

/** @type {import('node:timers').Timeout | null} */
let logTimer = null;

export const name = 'dsh-gpw2';

export const inject = ['approval'];

/**
 * @param {object} ctx Cordis context.
 * @param {object} [config]
 * @param {number} [config.maxPerWindow] Auto-approvals allowed per rolling window. Default 10.
 * @param {number} [config.windowMs] Window length in ms. Default 60000.
 * @param {number} [config.minGapMs] Minimum gap between two auto-approvals, in ms. Default 3000.
 */
export function apply(ctx, config = {}) {
  const maxPerWindow = positiveInt(config.maxPerWindow, 10);
  const windowMs = positiveInt(config.windowMs, 60_000);
  const minGapMs = positiveInt(config.minGapMs, 3_000);

  /** Timestamps of the auto-approvals inside the current window, oldest first. */
  const approvals = [];
  /** Timestamp of the most recent auto-approval, or null. */
  let lastApprovalAt = null;
  /** Counters for the periodic line, so the operator can see this thing working. */
  let deferredTotal = 0;
  let allowedTotal = 0;

  /**
   * Drop approvals that have aged out of the window.
   *
   * A rolling window is the requirement; a fixed one would allow a burst of `2 * maxPerWindow`
   * straddling a boundary (ten at the end of one minute, ten at the start of the next).
   *
   * @param {number} now
   */
  function prune(now) {
    const cutoff = now - windowMs;
    while (approvals.length > 0 && approvals[0] <= cutoff) approvals.shift();
  }

  /**
   * Decide one request, without ever rejecting.
   *
   * @param {number} now
   * @returns {{ allow: boolean, reason: string, inWindow: number }}
   */
  function decide(now) {
    prune(now);
    if (lastApprovalAt !== null && now - lastApprovalAt < minGapMs) {
      return {
        allow: false,
        reason: `only ${now - lastApprovalAt} ms since the last auto-approval (needs ${minGapMs} ms)`,
        inWindow: approvals.length,
      };
    }
    if (approvals.length >= maxPerWindow) {
      return {
        allow: false,
        reason: `${approvals.length} auto-approvals already in the last ${Math.round(windowMs / 1000)} s (limit ${maxPerWindow})`,
        inWindow: approvals.length,
      };
    }
    return { allow: true, reason: 'within both limits', inWindow: approvals.length };
  }

  /**
   * One line per window of real activity, so a silent plugin and a broken plugin look different.
   *
   * The failure mode this guards against is the one this whole session keeps meeting: a component
   * that is mounted, doing nothing, and indistinguishable from a healthy one. `allowedTotal` and
   * `deferredTotal` are the two numbers that tell them apart.
   */
  function startReporter() {
    if (logTimer !== null) return () => {};
    logTimer = setInterval(() => {
      if (allowedTotal === 0 && deferredTotal === 0) return;
      ctx.logger?.info?.(
        `approval-ratelimit: ${allowedTotal} auto-approved, ${deferredTotal} deferred to the human `
        + `(limit ${maxPerWindow}/${Math.round(windowMs / 1000)}s, gap ${minGapMs}ms, ${approvals.length} in the current window)`,
      );
    }, windowMs);
    logTimer.unref?.();
    return () => {
      if (logTimer !== null) {
        clearInterval(logTimer);
        logTimer = null;
      }
    };
  }

  /**
   * The answerer.
   *
   * Registered on the `approval/request` waterfall. Returning `'allowed-once'` grants this one
   * request; returning `next()` is "no opinion" and hands the decision to whoever answers next --
   * which is the human prompt, and it *waits* there rather than being refused.
   */
  const disposeListener = ctx.on('approval/request', (request, next) => {
    const now = Date.now();
    const verdict = decide(now);
    if (!verdict.allow) {
      deferredTotal += 1;
      // Debug, not warn: deferring is the designed behaviour of this plugin, and warning about the
      // normal path trains an operator to ignore the line that would matter.
      ctx.logger?.debug?.(
        `approval-ratelimit: deferring to the human -- ${verdict.reason}`
        + (request?.toolName ? ` (tool ${request.toolName})` : ''),
      );
      return next();
    }
    approvals.push(now);
    lastApprovalAt = now;
    allowedTotal += 1;
    ctx.logger?.info?.(
      `approval-ratelimit: auto-approved (${approvals.length}/${maxPerWindow} in the current window)`
      + (request?.toolName ? ` tool ${request.toolName}` : '')
      + (request?.reason ? ` -- ${request.reason}` : ''),
    );
    return 'allowed-once';
  });

  const stopReporter = startReporter();

  // Reversible: the host owns this effect, so an unload removes the answerer and the timer with it.
  // A listener that outlived its plugin would keep approving requests with nobody watching.
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      disposeListener?.();
      stopReporter();
    });
  } else {
    // No effect seam: say so rather than pretending the cleanup is guaranteed.
    ctx.logger?.warn?.(
      'approval-ratelimit: the context provides no ctx.effect, so the answerer and its reporter '
      + 'cannot be released on unload',
    );
  }

  ctx.logger?.info?.(
    `approval-ratelimit: active -- at most ${maxPerWindow} auto-approvals per ${Math.round(windowMs / 1000)} s, `
    + `at least ${minGapMs} ms apart, process-wide; everything else waits for the human`,
  );
}

/**
 * Coerce a config value to a positive integer, falling back to the default.
 *
 * A misconfigured limit must not silently become "0", which would disable the plugin while looking
 * like it was on -- and must not become a non-finite number, which would break the comparison.
 *
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function positiveInt(value, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

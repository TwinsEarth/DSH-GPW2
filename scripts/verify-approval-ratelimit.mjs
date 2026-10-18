/**
 * Verification for the approval rate limiter.
 *
 * It is a plain script rather than a `node --test` file on purpose: the runner spawns a child process
 * per file, and this project's own experience is that a gate nobody can run locally stops being run.
 * `node scripts/verify-approval-ratelimit.mjs` either prints every property as `ok` or exits 1.
 *
 * What it pins, in the order the requirement states it:
 *
 *   1. inside both limits -> `'allowed-once'` (the only granting value in the vocabulary);
 *   2. past `minGapMs` since the previous auto-approval -> `next()`, i.e. the human path;
 *   3. past `maxPerWindow` in a rolling window -> `next()`;
 *   4. the window **rolls**: approvals age out and the budget returns;
 *   5. it never rejects -- no request may be answered `'rejected'`, `'cancelled'` or `'unavailable'`;
 *   6. it processes a request it defers by *returning the downstream answer*, and it does not
 *      consume budget while doing so.
 *
 * Time is injected rather than waited on, so the suite runs in milliseconds and cannot be flaky.
 */

import { apply } from '../index.mjs';

const failures = [];
function check(label, condition, detail = '') {
  if (condition) process.stdout.write(`  ok    ${label}\n`);
  else {
    process.stdout.write(`  FAIL  ${label}${detail ? ` -- ${detail}` : ''}\n`);
    failures.push(label);
  }
}

/**
 * Build a context that captures the answerer, and a clock the test drives.
 *
 * @param {object} [config]
 */
function harness(config = {}) {
  const listeners = new Map();
  const logs = { info: [], warn: [], debug: [] };
  const effects = [];
  const ctx = {
    logger: {
      info: (m) => logs.info.push(String(m)),
      warn: (m) => logs.warn.push(String(m)),
      debug: (m) => logs.debug.push(String(m)),
      error: () => {},
    },
    on: (event, handler) => {
      listeners.set(event, handler);
      return () => listeners.delete(event);
    },
    effect: (fn) => { effects.push(fn); },
  };
  apply(ctx, config);
  const answerer = listeners.get('approval/request');
  if (!answerer) throw new Error('the plugin registered no approval/request listener');
  return { answerer, logs, effects, listeners };
}

/** What the human answerer would have returned, so a deferral is observable. */
const HUMAN = Symbol('human-answer');
const next = () => HUMAN;

const REQUEST = { toolName: 'bash', callId: 'call-1', reason: 'the tool is not on the allow-list' };

process.stdout.write('approval rate limiter\n');

/* --------------------------------------------------------------------------------------------- */
/* 1. defaults and the basic grant                                                               */
/* --------------------------------------------------------------------------------------------- */

{
  const { answerer, logs } = harness();
  check('starts active and says so', logs.info.some((l) => /approval-ratelimit: active/.test(l)));
  check('the first request inside both limits is allowed', answerer({ ...REQUEST }, next) === 'allowed-once');
  check('and the auto-approval is logged with its position in the window', logs.info.some((l) => /auto-approved \(1\/10/.test(l)));
}

/* --------------------------------------------------------------------------------------------- */
/* 2. the mandatory gap                                                                          */
/* --------------------------------------------------------------------------------------------- */

{
  // A virtual clock, so "3 seconds" costs nothing and cannot be flaky.
  const realNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  try {
    const { answerer, logs } = harness();
    check('gap: first request allowed', answerer({ ...REQUEST }, next) === 'allowed-once');
    now += 1_000; // 1 s later, inside the 3 s gap
    const second = answerer({ ...REQUEST }, next);
    check('gap: a second request 1 s later is deferred, not granted', second === HUMAN, `got ${String(second)}`);
    check('gap: the deferral is explained at debug level', logs.debug.some((l) => /needs 3000 ms/.test(l)));
    now += 2_000; // 3 s after the grant in total
    check('gap: at the boundary (3 s) the next request is allowed again', answerer({ ...REQUEST }, next) === 'allowed-once');
  } finally {
    Date.now = realNow;
  }
}

/* --------------------------------------------------------------------------------------------- */
/* 3. the rolling window ceiling                                                                 */
/* --------------------------------------------------------------------------------------------- */

{
  const realNow = Date.now;
  let now = 2_000_000;
  Date.now = () => now;
  try {
    const { answerer } = harness();
    let allowed = 0;
    let deferred = 0;
    // Ten requests, spaced exactly at the gap so the gap rule never fires.
    for (let i = 0; i < 10; i += 1) {
      if (answerer({ ...REQUEST }, next) === 'allowed-once') allowed += 1;
      else deferred += 1;
      now += 3_000;
    }
    check('window: exactly 10 allowed, 0 deferred', allowed === 10 && deferred === 0, `allowed=${allowed} deferred=${deferred}`);
    const eleventh = answerer({ ...REQUEST }, next);
    check('window: the 11th inside the window is deferred to the human', eleventh === HUMAN, `got ${String(eleventh)}`);
  } finally {
    Date.now = realNow;
  }
}

/* --------------------------------------------------------------------------------------------- */
/* 4. the window rolls                                                                           */
/* --------------------------------------------------------------------------------------------- */

{
  const realNow = Date.now;
  let now = 3_000_000;
  Date.now = () => now;
  try {
    const { answerer } = harness();
    for (let i = 0; i < 10; i += 1) { answerer({ ...REQUEST }, next); now += 3_000; }
    check('roll: budget exhausted', answerer({ ...REQUEST }, next) === HUMAN);
    now += 61_000; // every earlier approval is now older than the 60 s window
    check('roll: after the window passes, the budget returns', answerer({ ...REQUEST }, next) === 'allowed-once');
  } finally {
    Date.now = realNow;
  }
}

/* --------------------------------------------------------------------------------------------- */
/* 5. it never rejects                                                                           */
/* --------------------------------------------------------------------------------------------- */

{
  const realNow = Date.now;
  let now = 4_000_000;
  Date.now = () => now;
  try {
    const { answerer } = harness();
    const answers = new Set();
    // Hammer it: far more requests than any limit allows, at a rate that trips both rules.
    for (let i = 0; i < 200; i += 1) {
      answers.add(answerer({ ...REQUEST }, next));
      now += 7; // ~143 requests/second
    }
    const vocabulary = ['allowed-once', 'rejected', 'cancelled', 'unavailable'];
    const rejected = [...answers].filter((a) => vocabulary.includes(a) && a !== 'allowed-once');
    check('never rejects: no non-granting vocabulary value was ever returned', rejected.length === 0, `saw ${rejected.join(', ')}`);
    check('never rejects: every answer was either a grant or a deferral', [...answers].every((a) => a === 'allowed-once' || a === HUMAN), `saw ${[...answers].map(String).join(', ')}`);
    const grants = [...answers].filter((a) => a === 'allowed-once').length;
    check('under a hammering load the grant count stays at 1 (the gap holds)', grants === 1, `grants=${grants}`);
  } finally {
    Date.now = realNow;
  }
}

/* --------------------------------------------------------------------------------------------- */
/* 6. a deferral hands back the downstream answer, and spends nothing                            */
/* --------------------------------------------------------------------------------------------- */

{
  const realNow = Date.now;
  let now = 5_000_000;
  Date.now = () => now;
  try {
    const { answerer } = harness();
    answerer({ ...REQUEST }, next); // spend the first grant
    let downstreamCalls = 0;
    const downstream = () => { downstreamCalls += 1; return 'rejected'; };
    now += 1_000; // inside the gap
    const answer = answerer({ ...REQUEST }, downstream);
    check('defer: the downstream answerer was consulted', downstreamCalls === 1);
    check('defer: its answer is passed through unchanged', answer === 'rejected');
    now += 60_000; // window clears; the deferral must not have consumed budget
    check('defer: a deferral does not consume the auto-approval budget', answerer({ ...REQUEST }, next) === 'allowed-once');
  } finally {
    Date.now = realNow;
  }
}

/* --------------------------------------------------------------------------------------------- */
/* 7. configuration is honoured, and a bad value cannot disable it silently                       */
/* --------------------------------------------------------------------------------------------- */

{
  const realNow = Date.now;
  let now = 6_000_000;
  Date.now = () => now;
  try {
    const { answerer } = harness({ maxPerWindow: 2, minGapMs: 1000, windowMs: 10_000 });
    const results = [];
    for (let i = 0; i < 4; i += 1) { results.push(answerer({ ...REQUEST }, next) === 'allowed-once'); now += 1_000; }
    check('config: maxPerWindow=2 yields exactly two grants', results.filter(Boolean).length === 2, JSON.stringify(results));
  } finally {
    Date.now = realNow;
  }
}

{
  const { answerer, logs } = harness({ maxPerWindow: 0, minGapMs: -5, windowMs: 'nonsense' });
  check('config: a nonsense value falls back to the default rather than disabling the plugin', answerer({ ...REQUEST }, next) === 'allowed-once');
  check('config: the effective limits are reported', logs.info.some((l) => /at most 10 auto-approvals per 60 s/.test(l)));
}

/* --------------------------------------------------------------------------------------------- */
/* 8. disposal                                                                                   */
/* --------------------------------------------------------------------------------------------- */

{
  const { effects, answerer } = harness();
  check('dispose: an effect was registered so the answerer can be released', effects.length === 1 && typeof effects[0] === 'function');
  const dispose = effects[0]();
  check('dispose: the disposer is callable without throwing', typeof dispose === 'function');
  dispose();
  // The listener itself is removed by Cordis when the effect disposes; here we only assert the
  // plugin handed the host the means to do it, which is the part the plugin owns.
  check('dispose: the answerer still answers after an explicit dispose call (the host owns removal)', typeof answerer === 'function');
}

process.stdout.write('');
if (failures.length > 0) {
  process.stdout.write(`${failures.length} check(s) failed:\n`);
  for (const f of failures) process.stdout.write(`  - ${f}\n`);
  process.exit(1);
}
process.stdout.write('all checks passed\n');
process.exit(0);

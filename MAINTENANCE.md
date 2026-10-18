# Maintaining `@twinsearth/dsh-gpw2`

This session is dedicated to this package only. Everything needed to work on it is recorded here, because the code does
not live next to the fleet plugin it was once developed beside.

## Where things are

| | |
|---|---|
| Source | `E:\GPT\approval-ratelimit` |
| Repository | https://github.com/TwinsEarth/DSH-GPW2 (public, default branch `main`) |
| npm | `@twinsearth/dsh-gpw2` |
| Current version | **1.0.4** (`latest`) — the maintained line |
| Beta tag | *(removed)* |

## What this package is

Two halves, one install:

- **`index.mjs` — the watchdog (server).** Answers DSH's `approval/request` waterfall with a hard budget: at most 10
  auto-approvals per rolling 60 s, at least 3 s apart. Past either limit it returns `next()` — no opinion — so the request
  reaches the human and waits. It never refuses and never changes what is being asked.
- **`lib/client.js` — the screenshot half (browser, added in 1.1.0).** Alt+Q in the DSH web shell: capture the screen,
  drag a rectangle, the selection is copied to the clipboard as PNG. Declares `inject = []`; it cannot widen the
  watchdog's authority.

## Commands that must pass before any publish

```powershell
cd E:\GPT\approval-ratelimit
node --test --test-force-exit "test/*.test.mjs"   # 7/7 today (entry shape + selection geometry)
node scripts/verify-approval-ratelimit.mjs        # "all checks passed" (budget, defer, dispose, config)
```

`node --test test/` does **not** work on this Node: it resolves the directory as a module and fails before running
anything. That is why `package.json#scripts.test` uses a glob.

## Publishing

```powershell
# 1. bump version in package.json + add a CHANGELOG entry (newest first; the file is read by humans, not tooling)
# 2. run the two commands above
# 3. pack and publish
node E:\DS\...\pnpm\bin\pnpm.mjs pack --pack-destination .
node E:\DS\...\pnpm\bin\pnpm.mjs publish "twinsearth-dsh-gpw2-<version>.tgz" --access public --no-git-checks
# 4. verify the registry actually carries it (npmjs reads stale on the first request; retry)
#    https://registry.npmjs.org/@twinsearth%2Fdsh-gpw2/<version>
```

Two facts learned the hard way:

- **`pnpm publish <tarball>` prints ✅ before the registry has the version.** Always re-read
  `/@twinsearth%2Fdsh-gpw2/<version>` and `dist-tags` afterwards; a publish is confirmed by the registry, not by the CLI.
- **Starving the registry of a tag is not the same as failing to publish.** 1.1.0-beta.1 was staged and uninstallable;
  1.1.0-beta.2 replaced it; both are in the version list now. Check `/1.1.0-beta.2` before assuming a beta never landed.

## Rules that are load-bearing (do not "fix" them casually)

1. **Installs disabled.** The bundle patch row carries `disabled: true`. A permission answerer that starts because
   someone installed a package takes a decision away from the person who has to live with it. Enabling is the plugin
   manager's toggle. **The screenshot half rides on the same row**: a disabled row is not composed, so no browser half
   either — this trade-off is documented in `cordis.patch.yml` and README, and it is why the README says "enable the
   component" rather than "it just works".
2. **Distinct id `dsh-gpw2`.** The same idea ships inside `@twinsearth/w2m-dsh-plugin` as `dsh-gpw`. A shared id composes
   two rows and stops the client from opening — measured twice on that project. Never merge the ids.
3. **`inject` is an array.** The first version shipped `{ required: ['approval'] }`, which made the host wait for a
   service literally named `required` and stay pending forever.
4. **The screenshot half never throws at the shell.** A client entry whose `apply` throws refuses the whole web boot. It
   reports through `console.error` — the console the desktop app forwards to its crash log.
5. **Crop in frame coordinates, not window coordinates.** The frozen canvas is stretched to the viewport; without the
   letterbox scaling the copied pixels are wrong on any display whose resolution differs from the window.

## Known gaps (next work)

- **No CI.** The repository exists but nothing runs tests on push, and there is no release workflow. The fleet plugin has
  `ci.yml` + `release.yml` with an approval gate; this package has nothing.
- **No `test` for the server half's budget under concurrency** — the verifier drives it sequentially.
- **Alt+Q is page-level**, not system-wide, and the platform picker appears on each capture unless the browser remembers
  the choice. A web shell cannot do better; a native half would need host support.
- **End-to-end capture is unverified by machine.** `getDisplayMedia` needs a display and a gesture, so the copy path is
  first tried by hand.

## History worth keeping

- **1.0.2** — first published; no `repository`/`homepage`/`bugs` fields.
- **1.0.3** — metadata only: those three fields plus this changelog. No behaviour change.
- **1.1.0-beta.1 / beta.2** — screenshot work; beta.1 was staged and never installable.
- **1.1.0** — screenshot released first on the 1.1.0 line; **now deprecated** on the registry, pointing at 1.0.4.
- **1.0.4** — the maintained release: same tree as 1.1.0 on the 1.0 line, and the reason `latest` moved. The 1.1.0 line
  is not to be published to again unless the operator says otherwise.

# DSH-GPW2 — Global Permission Watchdog (standalone)

A DSH plugin that answers permission requests with a **hard global budget**, so a long unattended run cannot
silently grant everything.

| Limit | Default | Meaning |
|---|---|---|
| `maxPerWindow` | **10** | auto-approvals allowed per rolling window |
| `windowMs` | **60000** | the window, in ms |
| `minGapMs` | **3000** | minimum gap between two auto-approvals |

**Past either limit it returns `next()`** — *"no opinion"* — so the request falls through to the human prompt and
**waits** there. It never refuses, and it never changes what is being asked. It only decides **who answers and how
fast**.

## Install

```
dsh plugin --profile <name> add @twinsearth/dsh-gpw2
```

It mounts itself from its own bundle patch. Settings go on the row it created, **matched by id** (do not add an
`insert:` for an id that already exists — that appends a second row and the client stops opening):

```yaml
- id: dsh-gpw2
  config:
    maxPerWindow: 5
    windowMs: 60000
    minGapMs: 5000
```

Remove the row to disable it entirely.

## Why a budget rather than a rule

Every auto-approval is a permission decision made **without a human reading it**. A watchdog with no ceiling is a
plugin that grants everything and is indistinguishable from one that is working correctly.

So it logs two counters. **Without the second line, "mounted and working" and "mounted and doing nothing" are the
same picture:**

```
dsh-gpw2: active -- at most 10 auto-approvals per 60 s, at least 3000 ms apart, process-wide
dsh-gpw2: N auto-approved, M deferred to the human (limit 10/60s, gap 3000ms, ...)
```

## Requirement

Needs the `approval` service, which DSH's own base bundle provides
(`@deepseek-ai/dsh-base` mounts `@deepseek-ai/dsh-user-approval` as id `approval`).

It also needs the `approval/request` waterfall. If either is absent the plugin stays `pending (waiting for
service: …)` rather than mounting and silently doing nothing.


## Screenshot (Alt+Q)

This package also ships a browser half (`lib/client.js`, declared as `dsh.client`). Press **Alt+Q** while the DSH window has
focus, pick a screen or window in the platform picker, then **drag a rectangle**: the selection is copied to the clipboard
as PNG. **Enter** copies the current rectangle, **Esc** cancels.

### The three limits, stated up front

| Limit | Why | What it means for you |
|---|---|---|
| The shortcut is **page-level**, not system-wide | A web shell cannot register an OS-level hotkey | Alt+Q works when DSH is focused; it does nothing in other apps |
| A **source picker** appears every time | `getDisplayMedia` has no API to preselect a display, by design | You choose screen/window each press; there is no "capture silently" mode |
| The clipboard needs a secure context | `navigator.clipboard.write` requires https or localhost | On plain http over the LAN the selection is downloaded as a PNG instead, and the toast says so |

There is no state stored, no upload and no relay call: the frame is drawn into a canvas in the page, the selected pixels are
cropped locally, and the only output is the clipboard (or a local download fallback).

### Why it lives in this package

The operator asked for one package rather than two. The two halves share nothing at runtime -- the watchdog answers
`approval/request` on the server, this half declares `inject = []` and never touches an approval -- so a screenshot
failure cannot disable the watchdog.

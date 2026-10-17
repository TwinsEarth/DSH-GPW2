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

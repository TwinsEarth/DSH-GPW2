# Changelog

## Current line: 1.0.4

The maintained version of this package is **1.0.4**. The 1.1.0 family exists because this feature was first released on
the 1.1.0 line, and the operator then asked for it on 1.0.x; publishing 1.0.4 moved `latest` there as intended. 1.1.0 is
marked **deprecated** on the registry with a message pointing at 1.0.4, and the `beta` dist-tag has been removed so
`@beta` cannot resolve to a superseded prerelease.

This note is here because a reader sorting by version string will otherwise conclude 1.1.0 is newer. The registry's own
`dist-tags` is the authority, and it says `latest = 1.0.4`.

Newest first. This package is a **frozen standalone implementation** of the global permission watchdog: the same idea
continues inside `@twinsearth/w2m-dsh-plugin` as the `dsh-gpw` sub-plugin. A fleet operator installs one of them.

## [1.0.4] — 2026-10-18

**The 1.0.x line gets the 1.1.0 bodies: the watchdog plus the Alt+Q region screenshot.**

The operator asked for this on the 1.0 line, so this release is the same tree as 1.1.0 on a lower version. That ordering is
deliberate and worth writing down rather than leaving as a surprise later:

- `latest` now points at **1.0.4**, not 1.1.0. Both carry the screenshot half; 1.0.4 sorts lower, so a reader who checks
  "which is newest" by version string will be told 1.1.0. The registry's own answer is authoritative: see `dist-tags`.
- `npm unpublish @twinsearth/dsh-gpw2@1.0.3` was attempted first and refused by the registry (`ERR_PNPM_FORBIDDEN`, and
  re-publishing over an existing version is refused with 403), so 1.0.3 cannot be replaced in place. This release is the
  forward path instead of the rewrite that is not permitted.
- 1.0.3 remains published and remains metadata-only (no screenshot). It is no longer `latest`.

Contents are identical to 1.1.0: `lib/client.js` (Alt+Q, drag, clipboard), the client-entry and selection-geometry tests
(7/7), the watchdog verifier, and the same two-halves bundle patch.

## [1.1.0] — 2026-10-18

**Region screenshot to the clipboard: Alt+Q in the DSH web shell.**

The watchdog is the server half; this release adds the half a person reaches for. Press Alt+Q, drag a rectangle over the
screen, and the selection is on the clipboard as a PNG.

- **page-level shortcut, and it says so**: a web shell cannot register an OS-level hotkey. Alt+Q fires while the DSH window
  has focus, and the keydown is also the user gesture `getDisplayMedia` requires -- so the platform picker appears at
  once instead of the user hunting for a button.
- **the frame is frozen before the drag**: the capture stream is copied to a canvas and stopped immediately, so the
  "sharing your screen" indicator disappears and the preview cannot tear while windows repaint underneath it.
- **crop is in frame coordinates, not window coordinates**: the frozen canvas is stretched to the viewport, so the drag
  rectangle is scaled through the letterbox. Without that, the copied pixels are wrong on every display whose resolution
  differs from the window -- which is most of them.
- **it declares `inject = []`**: this half touches no service and no approval. It cannot widen the watchdog's authority,
  and a screenshot failure cannot take the permission path down with it.

### The beta history, recorded

1.1.0-beta.1 was staged by the registry and never became installable; 1.1.0-beta.2 was built as its replacement and did not
land either. Rather than shipping a third beta of a local-only feature, this release publishes the tested state as 1.1.0.

### Verified

The client entry shape (registers under the package specifier, array `inject`, callable `apply`, survives a window with no
document) and the selection geometry (any drag direction, clamping at the edges, zero-size click rejected, letterbox
scaling, both corner origins): 7/7. The watchdog itself is unchanged and its own verifier still passes.

### Not verified

A real capture against a real screen: `getDisplayMedia` needs a display and a user gesture, so the end-to-end copy is the
first thing to try by hand.

## [1.1.0-beta.2] — 2026-10-18

First published attempt of this feature (1.1.0-beta.1) was staged by the registry and never became installable: the tarball
404s and republishing the same version is refused with "Cannot publish over previously staged version". Re-published as
beta.2 with identical contents.

## [1.1.0-beta.1] — 2026-10-18 (staged, never installable)

**Adds a screenshot half: Alt+Q, drag a rectangle, the selection is copied to the clipboard.**

The watchdog is a server plugin and a screenshot belongs to the browser process, so this release adds a client entry
(`lib/client.js`, `dsh.client.platform = "web"`, `exports["./client"]`). The two halves share nothing at runtime: the entry
declares `inject = []` and never touches an approval, so a broken screenshot cannot disable the watchdog.

What the feature does: Alt+Q opens the platform's source picker, captures one frame, draws it full-screen, and lets the user
drag a rectangle; Enter copies, Esc cancels. The captured frame is letterboxed to the window, and the selection is mapped
back through that letterbox before cropping -- without that mapping the wrong pixels are copied on any screen whose aspect
ratio differs from the window's. Drags in any direction are normalised, and drags past the edge are clamped.

Three limits are documented rather than discovered: the shortcut is page-level (no OS hotkey API in a web shell), the
source picker appears on every press (no API to preselect a display), and the clipboard needs a secure context, with a
local PNG download as the fallback.

### Verified

The bundle loads through the real loader contract and registers under the package specifier with an array `inject`; its
`apply` survives a window without a document. The geometry is tested: normalisation, clamping, click-without-drag, and the
letterbox mapping (`computeSelection`, `fitRect`, `mapToImage`, `dragToRect`). 7 tests, all passing; the watchdog's own
verification script still passes.

### Not verified

The overlay and clipboard against a live browser. This is a **beta**: install `@twinsearth/dsh-gpw2@1.1.0-beta.1`
explicitly and say what happens -- `latest` stays on the watchdog-only build until that report.

## [1.0.3] — 2026-10-18

**Metadata only. No behaviour changed.**

1.0.2 shipped without `repository`, `homepage` or `bugs`. On npm that means the package page carries no link back to the
code it was built from, so anyone auditing a permission-answering plugin -- the one kind of plugin where "where did this
come from" is a fair question -- had only the tarball. This release adds the three fields pointing at
https://github.com/TwinsEarth/DSH-GPW2 and records this changelog in the tarball.

Nothing in `index.mjs` or `cordis.patch.yml` differs from 1.0.2; the budget defaults are unchanged (10 approvals per
60 s, at least 3 s apart), it still never refuses, and it still installs disabled.

### Not verified

Whether it intercepts a live permission request on a running host. That was true of 1.0.2 as well and is stated here
rather than implied by the version bump.

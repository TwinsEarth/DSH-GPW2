/**
 * The screenshot half: the entry shape the web shell reads, and the geometry that decides which pixels are copied.
 *
 * The entry shape is load-bearing beyond this package: a client entry that fails to activate keeps the whole page from
 * booting, so `apply` is asserted to survive a window without a document. The geometry is where a screenshot feature is
 * usually wrong -- a selection that is not normalised (drag up-left), not clamped (drag past the edge), or not mapped
 * through the letterbox (screen aspect ratio differs from the window's) copies the wrong pixels silently, which is
 * worse than failing.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

/** The bundle runs in another realm, so its objects are not reference-equal to host literals; compare plain data. */
const plain = (value) => JSON.parse(JSON.stringify(value));

/** Load the shipped bundle into a fake window, exactly as the shell's loader would, and return its exports. */
function loadBundle() {
  const code = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
  const loaded = [];
  const window = {
    __ModuleLoader__: { load: (entry) => loaded.push(entry) },
    addEventListener() {},
    removeEventListener() {},
    setTimeout: (fn) => fn(),
    requestAnimationFrame: (fn) => fn(),
  };
  const context = vm.createContext({ window, console: { error() {}, warn() {}, log() {} } });
  vm.runInContext(code, context, { filename: 'lib/client.js' });
  assert.equal(loaded.length, 1, 'a client bundle must register exactly one factory');
  return { entry: loaded[0], exports: loaded[0].factory(() => {}) };
}

describe('the entry the web shell reads', () => {
  it('registers under the package specifier, with an array inject and a callable apply', () => {
    const { entry, exports } = loadBundle();
    assert.equal(entry.id, '@twinsearth/dsh-gpw2');
    assert.ok(Array.isArray(exports.inject), 'inject is read as an array of service names; an object shape waits forever');
    assert.equal(exports.inject.length, 0, 'this half answers no approval and needs no service');
    assert.equal(typeof exports.apply, 'function');
  });

  it('does not throw when the window has no document', () => {
    const { exports } = loadBundle();
    assert.doesNotThrow(() => exports.apply({}));
  });
});

describe('the selection geometry', () => {
  it('normalises a drag in any direction instead of requiring left-to-right', () => {
    const { exports } = loadBundle();
    const rect = exports.computeSelection({ startX: 40, startY: 30, endX: 10, endY: 5, width: 100, height: 100 });
    assert.deepEqual(plain(rect), { x: 10, y: 5, width: 30, height: 25 });
  });

  it('clamps a drag that leaves the surface', () => {
    const { exports } = loadBundle();
    const rect = exports.computeSelection({ startX: 90, startY: 90, endX: 500, endY: 500, width: 100, height: 100 });
    assert.deepEqual(plain(rect), { x: 90, y: 90, width: 10, height: 10 });
  });

  it('returns a zero-sized selection for a click without a drag', () => {
    const { exports } = loadBundle();
    assert.deepEqual(plain(exports.computeSelection({ startX: 7, startY: 7, endX: 7, endY: 7, width: 10, height: 10 })), {
      x: 7, y: 7, width: 0, height: 0,
    });
  });

  it('maps through the letterbox, so a screen wider than the window copies the pixels the user drew', () => {
    const { exports } = loadBundle();
    // A 2000x1000 frame in a 1000x1000 viewport is scaled to 1000x500 and centred vertically at y=250.
    const fit = exports.fitRect({ imageWidth: 2000, imageHeight: 1000, viewWidth: 1000, viewHeight: 1000 });
    assert.deepEqual(plain(fit), { x: 0, y: 250, width: 1000, height: 500, scale: 0.5 });
    const selection = { x: 100, y: 300, width: 200, height: 100 };
    const source = exports.mapToImage({ selection, fit, imageWidth: 2000, imageHeight: 1000 });
    assert.deepEqual(plain(source), { sx: 200, sy: 100, sw: 400, sh: 200 });
  });

  it('reports the rectangle a drag covers, whichever corner it started from', () => {
    const { exports } = loadBundle();
    assert.deepEqual(plain(exports.dragToRect({ x: 10, y: 20 }, { x: 4, y: 30 })), { x: 4, y: 20, width: 6, height: 10 });
  });
});

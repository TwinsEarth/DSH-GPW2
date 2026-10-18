/**
 * Screenshot half of `@twinsearth/dsh-gpw2`: press **Alt+Q**, drag a rectangle over the screen, and the selection is
 * copied to the clipboard.
 *
 * # Why this file lives in the watchdog's package
 *
 * The operator asked for it as a sub-plugin of this package, so the two halves ship together: the server half answers
 * permission requests, this half takes screenshots. They share nothing at runtime -- this entry declares `inject = []`
 * and answers no approval -- so a broken screenshot can never disable the watchdog, and vice versa.
 *
 * # Why it is a client entry at all
 *
 * A screenshot cannot be taken from the server half: the pixels belong to the browser process, and the clipboard does
 * too. `getDisplayMedia` is the only capture API a web shell offers, it requires a user gesture, and the gesture here is
 * the Alt+Q keydown itself.
 *
 * # The constraint that shapes everything: the picker
 *
 * `getDisplayMedia` always shows the platform's source picker (a screen or a window). There is no API to skip it and
 * none to auto-select a display, which means:
 *
 *   * the shortcut is a page-level shortcut, not a system-wide one -- it fires while this page has focus;
 *   * the first thing a user sees after pressing it is the OS picker, not a selection overlay.
 *
 * The overlay appears **after** a frame has been captured, drawn over that frame, so the region drawn is the region
 * copied -- no coordinate guessing between the picker's surface and this window.
 *
 * # A failed client entry is fatal to the page
 *
 * The shell audits entries after activation and refuses to boot when one did not activate. Therefore {@link apply}
 * installs inside a try/catch, reports its own failure to `console.error`, and never throws. Everything else is
 * best-effort by design: a browser without `getDisplayMedia` gets a toast that says so, not a broken page.
 */

/** The id this entry registers under. It must equal the package specifier the Loader row carries. */
const ENTRY_ID = '@twinsearth/dsh-gpw2';

const TOAST_MS = 2600;

/**
 * Normalise a drag into a selection rectangle.
 *
 * Dragging up or to the left is normal user behaviour, so the rectangle is normalised rather than rejected. Clamping
 * happens against the surface the drag happened on: a selection that leaves the image would otherwise crop pixels that
 * are not there.
 *
 * @param {{startX: number, startY: number, endX: number, endY: number, width: number, height: number}} input
 * @returns {{x: number, y: number, width: number, height: number}} zero-sized when the drag is degenerate
 */
function computeSelection(input) {
  const { startX, startY, endX, endY } = input ?? {};
  const width = Number.isFinite(input?.width) ? input.width : 0;
  const height = Number.isFinite(input?.height) ? input.height : 0;
  const clamp = (value, max) => Math.min(Math.max(0, value), max);
  const left = clamp(Math.min(startX, endX), width);
  const right = clamp(Math.max(startX, endX), width);
  const top = clamp(Math.min(startY, endY), height);
  const bottom = clamp(Math.max(startY, endY), height);
  return { x: Math.round(left), y: Math.round(top), width: Math.round(right - left), height: Math.round(bottom - top) };
}

/**
 * Where a captured frame is drawn inside the viewport, keeping its aspect ratio.
 *
 * The frame is letterboxed to fit the window, so a point in the viewport is **not** a point in the frame. Without this
 * mapping a selection copied the wrong pixels on any screen whose aspect ratio differs from the window's.
 *
 * @param {{imageWidth: number, imageHeight: number, viewWidth: number, viewHeight: number}} input
 * @returns {{x: number, y: number, width: number, height: number, scale: number}}
 */
function fitRect(input) {
  const imageWidth = Math.max(1, input?.imageWidth ?? 0);
  const imageHeight = Math.max(1, input?.imageHeight ?? 0);
  const viewWidth = Math.max(1, input?.viewWidth ?? 0);
  const viewHeight = Math.max(1, input?.viewHeight ?? 0);
  const scale = Math.min(viewWidth / imageWidth, viewHeight / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return { x: (viewWidth - width) / 2, y: (viewHeight - height) / 2, width, height, scale };
}

/**
 * Map a viewport selection onto the captured frame.
 *
 * @param {{selection: {x: number, y: number, width: number, height: number}, fit: {x: number, y: number, scale: number},
 *          imageWidth: number, imageHeight: number}} input
 * @returns {{sx: number, sy: number, sw: number, sh: number}} source pixels for `drawImage`
 */
function mapToImage(input) {
  const selection = input?.selection ?? {};
  const fit = input?.fit ?? {};
  const imageWidth = Math.max(1, input?.imageWidth ?? 0);
  const imageHeight = Math.max(1, input?.imageHeight ?? 0);
  const scale = fit.scale > 0 ? fit.scale : 1;
  const clamp = (value, max) => Math.min(Math.max(0, value), max);
  const sx = clamp((selection.x - (fit.x ?? 0)) / scale, imageWidth);
  const sy = clamp((selection.y - (fit.y ?? 0)) / scale, imageHeight);
  const sw = clamp(selection.width / scale, imageWidth - sx);
  const sh = clamp(selection.height / scale, imageHeight - sy);
  return { sx, sy, sw, sh };
}

/** The rectangle a drag currently covers, in viewport coordinates. Used for the live preview. */
function dragToRect(from, to) {
  const x = Math.min(from.x, to.x);
  const y = Math.min(from.y, to.y);
  return { x, y, width: Math.abs(to.x - from.x), height: Math.abs(to.y - from.y) };
}

/**
 * Install the shortcut. Never throws: a client entry that fails to activate keeps the whole page from booting, so every
 * failure here is reported and contained.
 *
 * @param {object} [_ctx] the Cordis fiber; nothing is read from it, which is why `inject` is empty
 */
function apply(_ctx) {
  try {
    install(window);
  } catch (error) {
    console.error(`${ENTRY_ID}: the screenshot shortcut was not installed; the rest of the page is unaffected`, error);
  }
}

/** Cordis services this entry requires. Empty on purpose -- see {@link apply}. */
const inject = [];

/** Wire the keyboard, the capture, the overlay and the clipboard onto one window. Exported for tests. */
function install(win) {
  if (!win || typeof win.addEventListener !== 'function') return;
  if (win.__dshGpw2ShotInstalled === true) return;
  const doc = win.document;
  if (!doc || typeof doc.createElement !== 'function') return;
  win.__dshGpw2ShotInstalled = true;

  win.addEventListener('keydown', (event) => {
    if (event.altKey !== true || event.ctrlKey === true || event.shiftKey === true) return;
    const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
    const code = typeof event.code === 'string' ? event.code : '';
    if (key !== 'q' && code !== 'KeyQ') return;
    if (event.isComposing === true) return;
    event.preventDefault();
    event.stopPropagation();
    startCapture(win);
  }, true);
}

/** Toast in the corner of the page: short, non-blocking, and the only feedback channel this entry has. */
function toast(win, message, kind) {
  const doc = win.document;
  const node = doc.createElement('div');
  node.textContent = message;
  node.setAttribute('role', 'status');
  node.style.cssText = [
    'position:fixed',
    'z-index:2147483647',
    'right:18px',
    'bottom:18px',
    'max-width:min(60ch, 70vw)',
    'padding:10px 14px',
    'border-radius:10px',
    'font:500 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif',
    'color:var(--dsw-text, #ffffff)',
    kind === 'error' ? 'background:var(--dsw-danger, #b3261e)' : 'background:var(--dsw-surface-raised, #202124)',
    'box-shadow:0 6px 24px rgba(0,0,0,.35)',
    'pointer-events:none',
    'opacity:0',
    'transition:opacity .12s ease-out',
  ].join(';');
  doc.body.appendChild(node);
  win.requestAnimationFrame(() => { node.style.opacity = '1'; });
  win.setTimeout(() => {
    node.style.opacity = '0';
    win.setTimeout(() => node.remove(), 200);
  }, TOAST_MS);
}

/** Ask the platform for a screen, take one frame, and open the selection overlay over it. */
async function startCapture(win) {
  const doc = win.document;
  const media = win.navigator?.mediaDevices;
  if (!media || typeof media.getDisplayMedia !== 'function') {
    toast(win, '这个浏览器不支持屏幕捕获（缺少 getDisplayMedia）', 'error');
    return;
  }
  let stream = null;
  try {
    stream = await media.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
  } catch (error) {
    // Cancelling the picker lands here and is not an error worth a red toast.
    const cancelled = error && (error.name === 'NotAllowedError' || error.name === 'AbortError');
    toast(win, cancelled ? '已取消截图' : `无法获取屏幕：${error?.message ?? error}`, cancelled ? undefined : 'error');
    return;
  }

  const stop = () => { try { stream.getTracks().forEach((track) => track.stop()); } catch { /* already stopped */ } };

  try {
    const frame = await grabFrame(win, stream);
    stop();
    openOverlay(win, frame);
  } catch (error) {
    stop();
    toast(win, `截图失败：${error?.message ?? error}`, 'error');
  }
}

/** Draw the current video frame into an offscreen canvas and return it. */
async function grabFrame(win, stream) {
  const doc = win.document;
  const video = doc.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play();
  // One animation frame is not enough on every platform: wait for the first painted frame, with a short ceiling.
  await new Promise((resolve) => {
    const done = () => resolve();
    video.addEventListener('loadeddata', done, { once: true });
    win.setTimeout(done, 400);
  });
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) throw new Error('the captured frame is empty');
  const canvas = doc.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(video, 0, 0, width, height);
  return canvas;
}

/** Full-screen selection surface: the captured frame, a drag rectangle, and Enter/Esc. */
function openOverlay(win, frame) {
  const doc = win.document;
  const layer = doc.createElement('div');
  layer.setAttribute('data-dsh-gpw2-shot', 'overlay');
  layer.style.cssText = 'position:fixed;inset:0;z-index:2147483646;cursor:crosshair;background:#000;user-select:none';

  const canvas = doc.createElement('canvas');
  canvas.width = win.innerWidth;
  canvas.height = win.innerHeight;
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
  layer.appendChild(canvas);

  const hint = doc.createElement('div');
  hint.textContent = '拖拽选择区域 · Enter 复制 · Esc 取消';
  hint.style.cssText = [
    'position:absolute',
    'left:50%',
    'top:18px',
    'transform:translateX(-50%)',
    'padding:8px 14px',
    'border-radius:999px',
    'font:500 13px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif',
    'color:var(--dsw-text, #fff)',
    'background:var(--dsw-surface-raised, #202124)',
    'box-shadow:0 6px 24px rgba(0,0,0,.35)',
  ].join(';');
  layer.appendChild(hint);

  doc.body.appendChild(layer);

  const context = canvas.getContext('2d');
  const fit = fitRect({
    imageWidth: frame.width,
    imageHeight: frame.height,
    viewWidth: canvas.width,
    viewHeight: canvas.height,
  });

  let from = null;
  let current = null;

  const paint = () => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(frame, fit.x, fit.y, fit.width, fit.height);
    // Dim everything outside the selection, so the chosen pixels read as "kept".
    context.fillStyle = 'rgba(0,0,0,0.45)';
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (current === null) return;
    const rect = dragToRect(from, current);
    if (rect.width < 1 || rect.height < 1) return;
    context.clearRect(rect.x, rect.y, rect.width, rect.height);
    context.drawImage(frame, fit.x, fit.y, fit.width, fit.height);
    context.strokeStyle = 'var(--dsw-accent, #4c6ef5)';
    context.lineWidth = 2;
    context.strokeRect(rect.x + 1, rect.y + 1, Math.max(0, rect.width - 2), Math.max(0, rect.height - 2));
  };

  const pointOf = (event) => {
    const bounds = canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };

  const cleanup = () => {
    win.removeEventListener('keydown', onKey, true);
    layer.remove();
  };

  const finish = async () => {
    if (from === null || current === null) return;
    const selection = computeSelection({
      startX: from.x,
      startY: from.y,
      endX: current.x,
      endY: current.y,
      width: canvas.width,
      height: canvas.height,
    });
    if (selection.width < 1 || selection.height < 1) return;
    const source = mapToImage({ selection, fit, imageWidth: frame.width, imageHeight: frame.height });
    const out = doc.createElement('canvas');
    out.width = Math.max(1, Math.round(source.sw));
    out.height = Math.max(1, Math.round(source.sh));
    out.getContext('2d').drawImage(frame, source.sx, source.sy, source.sw, source.sh, 0, 0, out.width, out.height);
    cleanup();
    await copyToClipboard(win, out);
  };

  const onKey = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); cleanup(); toast(win, '已取消'); return; }
    if (event.key === 'Enter') { event.preventDefault(); finish(); }
  };

  layer.addEventListener('mousedown', (event) => {
    event.preventDefault();
    from = pointOf(event);
    current = from;
    paint();
  });
  layer.addEventListener('mousemove', (event) => {
    if (from === null) return;
    current = pointOf(event);
    paint();
  });
  layer.addEventListener('mouseup', () => { if (from !== null && current !== null) finish(); });
  win.addEventListener('keydown', onKey, true);
  paint();
}

/** Put the cropped selection on the clipboard, and say so in words that match what happened. */
async function copyToClipboard(win, canvas) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) { toast(win, '截图编码失败', 'error'); return; }
  const size = `${canvas.width}×${canvas.height}`;
  try {
    const item = new win.ClipboardItem({ 'image/png': blob });
    await win.navigator.clipboard.write([item]);
    toast(win, `已复制选区 ${size} 到剪贴板`);
  } catch (error) {
    // Fall back to a download when the clipboard is unavailable (permissions, insecure context). Losing the shot
    // silently after the user drew it would be the worst outcome.
    try {
      const url = win.URL.createObjectURL(blob);
      const link = win.document.createElement('a');
      link.href = url;
      link.download = `dsh-shot-${Date.now()}.png`;
      link.click();
      win.setTimeout(() => win.URL.revokeObjectURL(url), 4000);
      toast(win, `剪贴板不可用，已保存为下载文件（${size}）`);
    } catch {
      toast(win, `复制失败：${error?.message ?? error}`, 'error');
    }
  }
}

window.__ModuleLoader__.load({
  id: ENTRY_ID,
  factory: (_require) => {
    const module = { exports: {} };
    module.exports.apply = apply;
    module.exports.inject = inject;
    module.exports.computeSelection = computeSelection;
    module.exports.fitRect = fitRect;
    module.exports.mapToImage = mapToImage;
    module.exports.dragToRect = dragToRect;
    return module.exports;
  },
});

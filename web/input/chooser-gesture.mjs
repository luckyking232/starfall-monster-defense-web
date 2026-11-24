/**
 * Stage selector gestures. Only reports canonical coordinates or scroll
 * requests; the caller's stage lock and hit-map remain authoritative.
 */
export function chooserGesture({point, setScroll, read, slop = 9}) {
  let press = null;
  const reset = () => { press = null; };
  const valid = (e, s) => e.isPrimary && Number.isSafeInteger(e.pointerId)
    && Number.isFinite(e.clientX) && Number.isFinite(e.clientY)
    && s?.phase === 'chooser' && !s.pending;
  function begin(e, rect) {
    if (!e.isPrimary) return false;
    reset();
    const state = read();
    if (e.button !== 0 || !valid(e, state) || !Number.isFinite(rect?.width)
        || rect.width <= 0 || !Number.isFinite(state.scroll)) return false;
    press = {id: e.pointerId, owner: state.owner, scroll: state.scroll,
      x: e.clientX, y: e.clientY, width: rect.width, mode: 'tap'};
    return true;
  }
  function move(e, rect) {
    if (!press || e.pointerId !== press.id) return 'none';
    const state = read();
    if (!valid(e, state) || state.owner !== press.owner
        || !Number.isFinite(rect?.width) || rect.width <= 0
        || Math.abs(rect.width - press.width) > 0.5) {
      reset();
      return 'none';
    }
    const dx = e.clientX - press.x, dy = e.clientY - press.y;
    if (press.mode === 'tap' && Math.max(Math.abs(dx), Math.abs(dy)) >= slop)
      press.mode = Math.abs(dx) >= Math.abs(dy) ? 'drag' : 'scroll-page';
    if (press.mode === 'drag') setScroll(press.scroll - dx * 1334 / rect.width);
    return press.mode;
  }
  function end(e, rect) {
    if (!press || e.pointerId !== press.id) return {kind: 'ignored'};
    const mode = move(e, rect);
    reset();
    if (mode !== 'tap' || e.button !== 0 || !Number.isFinite(rect.height) || rect.height <= 0)
      return {kind: 'ignored'};
    const p = point(e.clientX, e.clientY, rect);
    const inside = Number.isFinite(p.x) && Number.isFinite(p.y)
      && p.x >= 0 && p.x < 1334 && p.y >= 0 && p.y < 750;
    return inside ? {kind: 'tap', x: p.x, y: p.y} : {kind: 'ignored'};
  }
  function cancel(id) {
    if (id === undefined || press?.id === id) reset();
  }
  return Object.freeze({begin, move, end, cancel});
}

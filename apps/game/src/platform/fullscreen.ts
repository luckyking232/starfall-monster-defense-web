type LockableOrientation = ScreenOrientation & { lock?(mode: 'landscape'): Promise<void> };

export function createFullscreenButton(doc: Document, report: (message: string) => void): HTMLButtonElement | null {
  const root = doc.documentElement;
  if (!doc.fullscreenEnabled || typeof root.requestFullscreen !== 'function' || typeof doc.exitFullscreen !== 'function') {
    return null;
  }

  const control = doc.createElement('button');
  control.type = 'button';
  const active = () => doc.fullscreenElement === root;
  let landscapeRequest: { orientation: LockableOrientation } | undefined;

  function sync(): void {
    control.textContent = active() ? '退出全屏' : '进入全屏';
    if (active() || !landscapeRequest) return;
    const { orientation } = landscapeRequest;
    landscapeRequest = undefined;
    try { orientation.unlock(); } catch { /* The browser may release the lock itself. */ }
  }

  async function lockLandscape(): Promise<void> {
    const orientation: LockableOrientation | undefined = doc.defaultView?.screen.orientation;
    if (!active() || typeof orientation?.lock !== 'function' || typeof orientation.unlock !== 'function') return;
    const request = { orientation };
    landscapeRequest = request;
    try {
      await orientation.lock('landscape');
    } catch {
      if (landscapeRequest === request) landscapeRequest = undefined;
    }
  }

  control.onclick = async (event) => {
    const leaving = active();
    const touch = ('pointerType' in event && event.pointerType === 'touch') ||
      doc.defaultView?.matchMedia('(pointer: coarse)').matches;
    control.disabled = true;
    report('');
    try {
      if (leaving) await doc.exitFullscreen();
      else {
        await root.requestFullscreen();
        if (touch) void lockLandscape();
      }
    } catch {
      report(leaving ? '浏览器未能退出全屏。' : '浏览器未能进入全屏。');
    } finally {
      control.disabled = false;
      sync();
    }
  };
  doc.addEventListener('fullscreenchange', sync);
  sync();
  return control;
}

import type Phaser from 'phaser';

const MANUAL_ROTATION = 'starfall.web.manual-rotation';
export function rotateFrame(portrait: boolean, manualRotation: boolean): boolean {
  return portrait && manualRotation;
}

export function installViewportTracking(): () => void {
  const root = document.documentElement;
  const hint = document.createElement('aside');
  hint.className = 'orientation-hint';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  hint.append('横放手机游玩，或', toggle);
  document.body.append(hint);
  let manual = false;
  try { manual = localStorage.getItem(MANUAL_ROTATION) === '1'; } catch { /* Private session. */ }
  let layoutWidth = 0;
  let portrait = false;
  const viewport = window.visualViewport;
  const update = () => {
    // Toolbars and soft keyboards can change available height without rotating the device.
    if (layoutWidth !== root.clientWidth || !matchMedia('(pointer: coarse)').matches) {
      layoutWidth = root.clientWidth;
      portrait = layoutWidth < root.clientHeight;
    }
    root.dataset['orientation'] = portrait ? 'portrait' : 'landscape';
    root.dataset['frameRotation'] = rotateFrame(portrait,manual) ? '90' : '0';
    root.style.setProperty('--viewport-width', (viewport?.width ?? window.innerWidth) + 'px');
    root.style.setProperty('--viewport-height', (viewport?.height ?? window.innerHeight) + 'px');
    root.style.setProperty('--viewport-left', (viewport?.offsetLeft ?? 0) + 'px');
    root.style.setProperty('--viewport-top', (viewport?.offsetTop ?? 0) + 'px');
    toggle.textContent = manual ? '恢复自然方向' : '竖持横屏';
    hint.hidden = !portrait;
  };
  toggle.onclick = () => {
    manual = !manual;
    try { localStorage.setItem(MANUAL_ROTATION,manual ? '1' : '0'); } catch { /* Applies in this session. */ }
    update();
  };
  update();
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', update);
  document.addEventListener('fullscreenchange', update);
  viewport?.addEventListener('resize', update);
  viewport?.addEventListener('scroll', update);
  return () => {
    window.removeEventListener('resize', update);
    window.removeEventListener('orientationchange', update);
    document.removeEventListener('fullscreenchange', update);
    viewport?.removeEventListener('resize', update);
    viewport?.removeEventListener('scroll', update);
    hint.remove();
  };
}

/** Use as a Phaser postBoot callback for a canvas inside the landscape frame. */
export function installPhaserViewport(game: Phaser.Game): void {
  const { canvas, input, scale } = game;
  const browser = canvas.ownerDocument.defaultView;
  if (!browser || !canvas.closest('.game-frame') || canvas.hasAttribute('data-game-viewport-canvas')) return;
  canvas.setAttribute('data-game-viewport-canvas', '');

  input.transformPointer = (pointer, pageX, pageY, wasMove) => {
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return;
    const relativeX = (pageX - browser.scrollX - bounds.left) / bounds.width;
    const relativeY = (pageY - browser.scrollY - bounds.top) / bounds.height;
    const rotated = canvas.ownerDocument.documentElement.dataset['frameRotation'] === '90';
    const x = (rotated ? relativeY : relativeX) * scale.baseSize.width;
    const y = (rotated ? 1 - relativeX : relativeY) * scale.baseSize.height;

    const { position, prevPosition } = pointer;
    prevPosition.set(position.x, position.y);
    const smoothing = wasMove ? pointer.smoothFactor : 0;
    if (smoothing === 0) position.set(x, y);
    else position.set(x * smoothing + prevPosition.x * (1 - smoothing), y * smoothing + prevPosition.y * (1 - smoothing));
  };
}

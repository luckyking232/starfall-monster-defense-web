import type Phaser from 'phaser';

const PORTRAIT = '(orientation: portrait)';

export function installViewportTracking(): () => void {
  const portrait = window.matchMedia(PORTRAIT);
  const update = () => {
    document.documentElement.style.setProperty('--viewport-width', `${window.innerWidth}px`);
    document.documentElement.style.setProperty('--viewport-height', `${window.innerHeight}px`);
    document.documentElement.dataset['orientation'] = portrait.matches ? 'portrait' : 'landscape';
  };
  update();
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', update);
  window.visualViewport?.addEventListener('resize', update);
  return () => {
    window.removeEventListener('resize', update);
    window.removeEventListener('orientationchange', update);
    window.visualViewport?.removeEventListener('resize', update);
  };
}

/** Use as a Phaser postBoot callback for a canvas inside the landscape frame. */
export function installPhaserViewport(game: Phaser.Game): void {
  const { canvas, input, scale } = game;
  const browser = canvas.ownerDocument.defaultView;
  if (!browser || !canvas.closest('.game-frame') || canvas.hasAttribute('data-game-viewport-canvas')) return;
  const portrait = browser.matchMedia(PORTRAIT);
  canvas.setAttribute('data-game-viewport-canvas', '');

  input.transformPointer = (pointer, pageX, pageY, wasMove) => {
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return;
    const relativeX = (pageX - browser.scrollX - bounds.left) / bounds.width;
    const relativeY = (pageY - browser.scrollY - bounds.top) / bounds.height;
    const x = (portrait.matches ? relativeY : relativeX) * scale.baseSize.width;
    const y = (portrait.matches ? 1 - relativeX : relativeY) * scale.baseSize.height;

    const { position, prevPosition } = pointer;
    prevPosition.set(position.x, position.y);
    const smoothing = wasMove ? pointer.smoothFactor : 0;
    if (smoothing === 0) position.set(x, y);
    else position.set(x * smoothing + prevPosition.x * (1 - smoothing), y * smoothing + prevPosition.y * (1 - smoothing));
  };
}

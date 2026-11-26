import { expect, test } from '@playwright/test';
import { openChooser, originalClick } from './navigation';

test('the opening characters draw their original projectile shader and mesh in battle', async ({ page }) => {
  test.setTimeout(90000);
  await page.addInitScript(() => {
    const evidence = { draws: 0, visiblePixels: 0 };
    Object.assign(window, { projectileEvidence: evidence });
    const drawElements = WebGLRenderingContext.prototype.drawElements;
    WebGLRenderingContext.prototype.drawElements = function (...args) {
      drawElements.apply(this, args);
      if (evidence.visiblePixels) return;
      const program = this.getParameter(this.CURRENT_PROGRAM) as WebGLProgram | null;
      if (!program || !this.getUniformLocation(program, '_PixelValue')) return;
      evidence.draws++;
      const rgba = new Uint8Array(this.drawingBufferWidth * this.drawingBufferHeight * 4);
      this.readPixels(0, 0, this.drawingBufferWidth, this.drawingBufferHeight, this.RGBA, this.UNSIGNED_BYTE, rgba);
      for (let i = 3; i < rgba.length; i += 4) {
        if (rgba[i]! > 15) evidence.visiblePixels++;
      }
    };
  });
  await page.goto('./');
  await openChooser(page);
  await originalClick(page, 145, 274);
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as { projectileEvidence: { visiblePixels: number } }).projectileEvidence.visiblePixels),
    { timeout: 45000 }).toBeGreaterThan(3);
  await page.screenshot({ path: test.info().outputPath('original-projectiles.png') });
});

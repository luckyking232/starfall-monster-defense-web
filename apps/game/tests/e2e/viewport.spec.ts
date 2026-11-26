import { expect, test } from '@playwright/test';
import { openChooser, originalClick } from './navigation';

test('wide and small landscape viewports preserve the original battlefield ratio', async ({ page }) => {
  for (const viewport of [{ width: 1920, height: 900 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await page.goto('./');
    const frame = await page.locator('#app').boundingBox();
    expect(frame).not.toBeNull();
    expect(frame!.width / frame!.height).toBeCloseTo(1334 / 750, 3);
    await openChooser(page);
    await originalClick(page,145,274);
    await expect(page.getByRole('region',{name:'魔物抵御战战场'})).toBeVisible();
    const canvas = page.locator('section canvas');
    await expect(canvas).toBeVisible({ timeout: 30000 });
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.width / bounds!.height).toBeCloseTo(1334 / 750, 3);
    await expect(canvas).toBeInViewport();
  }
});

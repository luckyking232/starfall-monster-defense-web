import { expect, type Page } from '@playwright/test';

type CanvasPointer = 'mouse' | 'touch';

export async function originalPointMapper(page: Page): Promise<(x: number, y: number) => { x: number; y: number }> {
  const surface = page.locator('#app canvas:visible').last();
  await expect(surface).toBeVisible();
  const bounds = await surface.boundingBox();
  if (!bounds) throw new Error('Original window has no visible canvas');
  const rotated = await page.evaluate(() => document.documentElement.dataset['frameRotation'] === '90');
  return (x, y) => ({
    x: bounds.x + (rotated ? 1 - y / 750 : x / 1334) * bounds.width,
    y: bounds.y + (rotated ? x / 1334 : y / 750) * bounds.height,
  });
}

export async function originalClick(page: Page, x: number, y: number, pointer: CanvasPointer = 'mouse'): Promise<void> {
  const point = (await originalPointMapper(page))(x, y);
  if (pointer === 'touch') await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
}

export async function openChooser(page: Page, pointer: CanvasPointer = 'mouse'): Promise<void> {
  await expect(page.getByRole('region', { name: '魔物抵御战活动主页' })).toBeVisible({ timeout: 30000 });
  await expect(page.locator('#startup')).toHaveCount(0, { timeout: 30000 });
  await originalClick(page, 1147, 679, pointer);
  await expect(page.getByRole('region', { name: '选择关卡', exact: true })).toBeVisible({ timeout: 15000 });
}

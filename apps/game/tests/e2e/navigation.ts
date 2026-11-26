import { expect, type Page } from '@playwright/test';

type CanvasPointer = 'mouse' | 'touch';

export async function originalClick(page: Page, x: number, y: number, pointer: CanvasPointer = 'mouse'): Promise<void> {
  const surface = page.locator('#app canvas:visible').last();
  await expect(surface).toBeVisible();
  const bounds = await surface.boundingBox();
  if (!bounds) throw new Error('Original window has no visible canvas');
  const portrait = await page.evaluate(() => matchMedia('(orientation: portrait)').matches);
  const clientX = bounds.x + (portrait ? 1 - y / 750 : x / 1334) * bounds.width;
  const clientY = bounds.y + (portrait ? x / 1334 : y / 750) * bounds.height;
  if (pointer === 'touch') await page.touchscreen.tap(clientX, clientY);
  else await page.mouse.click(clientX, clientY);
}

export async function openChooser(page: Page, pointer: CanvasPointer = 'mouse'): Promise<void> {
  await expect(page.getByRole('region', { name: '魔物抵御战活动主页' })).toBeVisible({ timeout: 30000 });
  await originalClick(page, 1147, 679, pointer);
  await expect(page.getByRole('region', { name: '选择关卡', exact: true })).toBeVisible({ timeout: 15000 });
}

import { expect, test, type Page } from '@playwright/test';
import { openChooser, originalClick } from './navigation';

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

const fullscreen = (page: Page) => page.evaluate(() => document.fullscreenElement === document.documentElement);
const settings = (page: Page) => page.getByRole('button', { name: '网页设置' });
const enter = (page: Page) => page.getByRole('button', { name: '进入全屏' });
const exit = (page: Page) => page.getByRole('button', { name: '退出全屏' });
const close = (page: Page) => page.getByRole('button', { name: '关闭', exact: true });

async function checkChooserTouch(page: Page): Promise<void> {
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator('#app canvas:visible').last()).toBeInViewport({ ratio: 0.98 });
  await openChooser(page, 'touch');
  await originalClick(page, 525, 274, 'touch');
  await expect(page.getByRole('status')).toHaveText('前置关卡未通过');
}

test('uses the browser fullscreen API on tap and releases the orientation lock on exit', async ({ page }) => {
  await page.addInitScript(() => {
    const events: string[] = [];
    Object.defineProperty(window, 'fullscreenTestEvents', { value: events });
    Object.defineProperty(screen.orientation, 'lock', { value: async (mode: string) => {
      events.push(mode + ':' + String(document.fullscreenElement === document.documentElement));
    } });
    Object.defineProperty(screen.orientation, 'unlock', { value: () => { events.push('unlock'); } });
  });
  const events = () => page.evaluate(() => (window as Window & { fullscreenTestEvents?: string[] }).fullscreenTestEvents);
  await page.goto('./');
  await settings(page).tap();
  expect(await fullscreen(page)).toBe(false);
  expect(await events()).toEqual([]);
  await enter(page).tap();
  await expect.poll(() => fullscreen(page)).toBe(true);
  await expect.poll(events).toEqual(['landscape:true']);
  await expect(close(page)).toBeVisible();
  await exit(page).tap();
  await expect.poll(() => fullscreen(page)).toBe(false);
  await expect.poll(events).toEqual(['landscape:true', 'unlock']);

  await enter(page).tap();
  await expect.poll(() => fullscreen(page)).toBe(true);
  await page.evaluate(() => document.exitFullscreen());
  await expect.poll(events).toEqual(['landscape:true', 'unlock', 'landscape:true', 'unlock']);
  await expect(enter(page)).toBeVisible();
  await close(page).tap();
  await checkChooserTouch(page);
});

test('keeps ordinary gameplay when fullscreen capability is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, 'fullscreenEnabled', { value: false });
  });
  await page.goto('./');
  await settings(page).tap();
  await expect(enter(page)).toHaveCount(0);
  await close(page).tap();
  await checkChooserTouch(page);
});

test('recovers from rejected fullscreen and orientation requests', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Element.prototype.requestFullscreen;
    let rejectNext = true;
    Element.prototype.requestFullscreen = function () {
      if (!rejectNext) return original.call(this);
      rejectNext = false;
      return Promise.reject(new DOMException('blocked', 'NotAllowedError'));
    };
    Object.defineProperty(screen.orientation, 'lock', { value: () => {
      return Promise.reject(new DOMException('unavailable', 'NotSupportedError'));
    } });
  });
  await page.goto('./');
  await settings(page).tap();
  await enter(page).tap();
  expect(await fullscreen(page)).toBe(false);
  await expect(page.getByText('浏览器未能进入全屏。')).toBeVisible();
  await expect(enter(page)).toBeEnabled();

  await enter(page).tap();
  await expect.poll(() => fullscreen(page)).toBe(true);
  await exit(page).tap();
  await expect.poll(() => fullscreen(page)).toBe(false);
  await close(page).tap();
  await checkChooserTouch(page);
});

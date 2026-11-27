import { expect, test, type Page } from '@playwright/test';
import { openChooser, originalClick } from './navigation';

const chooser = (page: Page) => page.getByRole('region', { name: '选择关卡', exact: true });
const records = (page: Page) => page.getByRole('note', { name: '无尽纪录' });

async function revealEndless(page: Page): Promise<void> {
  await page.mouse.move(690, 370);
  await page.mouse.wheel(0, 4200);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function startEndless(page: Page): Promise<void> {
  await originalClick(page, 1162, 368);
  await expect(page.getByRole('region', {name: '魔物抵御战战场'})).toBeVisible({ timeout: 30000 });
}

async function openExit(page: Page): Promise<void> {
  await expect(async () => {
    await originalClick(page, 79, 47);
    await expect(page.getByRole('region', { name: '确认退出战斗' })).toBeVisible({ timeout: 700 });
  }).toPass({ timeout: 15000 });
}

test('无尽取消退出不记分，确认退出时保存，返回选关和刷新后仍可读取', async ({ page }) => {
  test.setTimeout(100000);
  await page.addInitScript(() => {
    const prefix = document.querySelector('meta[name="game-channel"]')?.getAttribute('content') === 'test' ? 'starfall.web-test:' : '';
    localStorage.setItem(prefix + 'starfall.monster-defense.settings/3', '{"music":0,"effects":0}');
  });
  await page.goto('./');
  await page.getByRole('button', {name: '网页设置'}).click();
  await page.getByRole('button', {name: '调试',exact: true}).click();
  await Promise.all([
    page.waitForEvent('framenavigated', frame => frame === page.mainFrame()),
    page.getByRole('button', {name: '全解锁',exact: true}).click(),
  ]);
  await expect(page.locator('#startup')).toHaveCount(0, { timeout: 30000 });
  await openChooser(page);
  await expect(records(page)).toContainText('正式最佳　暂无纪录');
  await revealEndless(page);
  await page.screenshot({ path: test.info().outputPath('endless-chooser.png') });
  await startEndless(page);
  await openExit(page);
  await originalClick(page, 356, 575);
  await expect(page.getByRole('region', {name: '魔物抵御战战场'})).toBeVisible();
  const runCount = () => page.evaluate(() => Object.keys(localStorage).filter(key => key.includes('/endless/')).length);
  expect(await runCount()).toBe(0);

  await page.reload();
  await expect(page.locator('#startup')).toHaveCount(0, { timeout: 30000 });
  expect(await runCount()).toBe(0);
  await openChooser(page);
  await revealEndless(page);
  await startEndless(page);
  await openExit(page);
  await originalClick(page, 977, 575);
  await expect(page.getByRole('region', {name: '战斗结算'})).toBeVisible();
  await expect(records(page)).toContainText(/正式最佳.+击退 \d+ · 到达第 1 波.+新纪录/);
  await expect(records(page)).toContainText('练习最佳　暂无纪录');
  expect(await runCount()).toBe(1);
  await page.screenshot({ path: test.info().outputPath('endless-result.png') });

  await originalClick(page, 667, 575);
  await expect(chooser(page)).toBeVisible();
  await expect(records(page)).toContainText('到达第 1 波');
  await expect(records(page)).not.toContainText('新纪录');
  await page.reload();
  await expect(page.locator('#startup')).toHaveCount(0, { timeout: 30000 });
  await openChooser(page);
  await expect(records(page)).toContainText('到达第 1 波');
});

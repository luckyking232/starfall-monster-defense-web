import { test, expect } from '@playwright/test';
import { originalClick, openChooser } from './navigation';

test('普通入口由原活动窗口打开选关、提示锁关并返回', async ({ page }) => {
  await page.goto('./');
  await openChooser(page);
  await originalClick(page, 525, 274);
  await expect(page.getByRole('status')).toHaveText('前置关卡未通过');
  await page.screenshot({ path: test.info().outputPath('original-chooser.png') });
  await originalClick(page, 100, 42);
  await expect(page.getByRole('region', { name: '魔物抵御战活动主页' })).toBeVisible();
  await originalClick(page, 100, 42);
  await expect(page.getByRole('dialog',{name:'城外的路牌'})).toBeVisible();
  await page.getByRole('button',{name:'翻到背面'}).click();
  await page.getByRole('button',{name:'回营',exact:true}).click();
  await openChooser(page);
  await page.reload();
  await expect(page.getByRole('region', { name: '魔物抵御战活动主页' })).toBeVisible({timeout:45000});
  await page.screenshot({ path: test.info().outputPath('original-home.png') });
});

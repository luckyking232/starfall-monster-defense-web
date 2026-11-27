import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('Pages exposes old saves for export and imports them into isolated slots',async ({page},testInfo) => {
  test.setTimeout(90000);
  await page.route('**/',async route => {
    const response = await route.fetch();
    const html = (await response.text()).replace('name="game-channel" content="production"','name="game-channel" content="test"');
    await route.fulfill({response,body:html});
  });
  await page.addInitScript(() => {
    localStorage.setItem('starfall.monster-defense.progress/2/default/clear/78000001','1');
  });
  const open = async () => {
    await expect(page.getByRole('region',{name:'魔物抵御战活动主页'})).toBeVisible({timeout:45000});
    await page.getByRole('button',{name:'网页设置'}).click();
    await page.getByRole('button',{name:'存档',exact:true}).click();
  };
  await page.goto('./');
  await open();
  await expect(page.getByText('已通关 0 关')).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button',{name:'导出旧版 Pages 存档'}).click();
  const path = testInfo.outputPath('previous-pages.json');
  await (await downloaded).saveAs(path);
  expect(JSON.parse(await readFile(path,'utf8')).slots[0].cleared).toEqual([78000001]);
  await page.locator('input[type=file]').setInputFiles(path);
  await expect(page.getByRole('dialog')).toHaveCount(0,{timeout:30000});
  await open();
  await expect(page.getByText('已通关 1 关')).toBeVisible();
  await expect(page.getByRole('combobox',{name:'选择存档'}).locator('option')).toHaveCount(2);
});

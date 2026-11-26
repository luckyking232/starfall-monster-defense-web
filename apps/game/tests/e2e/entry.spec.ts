import { expect, test } from '@playwright/test';
import { openChooser, originalClick } from './navigation';

test('saved progression opens stage two through the original scrolled selector', async ({ page }) => {
  const schema = 'starfall.monster-defense.progress/1';
  await page.addInitScript((schema) => {
    localStorage.setItem(schema+'/78000001', JSON.stringify({schema,stageId:78000001,settlement:'confirmed_natural_win'}));
  },schema);
  await page.goto('./');
  await openChooser(page);
  // Original window scrolls the map horizontally to the next available stage.
  await originalClick(page,145,444);
  await expect(page.getByRole('region',{name:'魔物抵御战战场'})).toBeVisible({timeout:15000});
  await page.reload();
  await expect(page.getByRole('region',{name:'魔物抵御战活动主页'})).toBeVisible();
});

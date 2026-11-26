import { expect, test, type Page } from '@playwright/test';
import { openChooser, originalClick } from './navigation';

async function enter(page: Page): Promise<void> {
  await page.goto('./');
  await openChooser(page);
  await originalClick(page,145,274);
  await expect(page.getByRole('region',{name:'魔物抵御战战场'})).toBeVisible();
}

test('ordinary player opens the original pause and exit windows then enters a fresh battle',async({page})=>{
  test.setTimeout(80000);
  const errors: string[] = [];
  page.on('pageerror',error=>errors.push(error.message));
  await enter(page);
  // The original HUD enables input when its authored entrance transition ends.
  await expect(async () => {
    await originalClick(page,163,47);
    await expect(page.getByRole('region',{name:'战斗暂停'})).toBeVisible({timeout:700});
  }).toPass({timeout:15000});
  await originalClick(page,660,380);
  await expect(page.getByRole('region',{name:'魔物抵御战战场'})).toBeVisible();
  await originalClick(page,79,47);
  await expect(page.getByRole('region',{name:'确认退出战斗'})).toBeVisible();
  await originalClick(page,356,575);
  await expect(page.getByRole('region',{name:'魔物抵御战战场'})).toBeVisible();
  await originalClick(page,79,47);
  await expect(page.getByRole('region',{name:'确认退出战斗'})).toBeVisible();
  await originalClick(page,977,575);
  await expect(page.getByRole('region',{name:'战斗结算'})).toBeVisible();
  await originalClick(page,667,575);

  await expect(page.getByRole('region',{name:'选择关卡'})).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem('starfall.monster-defense.progress/2/default/clear/78000001'))).toBeNull();
  await originalClick(page,145,274);
  await expect(page.getByRole('region',{name:'魔物抵御战战场'})).toBeVisible();
  expect(errors).toEqual([]);
});

test('original upgrade UI accepts a pointer selection and resumes the same battle',async({page})=>{
  test.setTimeout(110000);
  await enter(page);
  await expect(page.getByRole('region',{name:'选择强化'})).toBeVisible({timeout:80000});
  await page.screenshot({path:test.info().outputPath('original-choice.png')});
  await originalClick(page,365,340);
  await originalClick(page,667,654);
  await expect(page.getByRole('region',{name:'魔物抵御战战场'})).toBeVisible();
  await originalClick(page,163,47);
  await expect(page.getByRole('region',{name:'战斗暂停'})).toBeVisible();
});

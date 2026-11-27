import {expect,test} from '@playwright/test';
import {openChooser,originalClick} from './navigation';

test('省电选项只降低世界画布分辨率，退出设置后继续战斗',async ({page}) => {
  test.setTimeout(90000);
  await page.goto('./');
  await page.getByRole('button',{name:'网页设置'}).click();
  await page.getByLabel('省电画质（降低战场分辨率）').check();
  await page.getByLabel('显示帧率').check();
  await page.getByRole('button',{name:'关闭',exact:true}).click();
  await openChooser(page);
  await originalClick(page,145,274);
  await expect(page.getByRole('region',{name:'魔物抵御战战场'})).toBeVisible({timeout:40000});
  const world = page.locator('canvas[aria-label="战场画面"]');
  await expect(world).toHaveAttribute('width','667');
  await expect(world).toHaveAttribute('height','375');
  await expect(page.locator('.web-fps')).toContainText('战场',{timeout:15000});
  await page.getByRole('button',{name:'网页设置'}).click();
  await page.getByLabel('省电画质（降低战场分辨率）').uncheck();
  await page.getByRole('button',{name:'关闭',exact:true}).click();
  await expect(world).toHaveAttribute('width','1334');
  await expect(page.locator('section canvas').first()).toHaveAttribute('width','1334');
});

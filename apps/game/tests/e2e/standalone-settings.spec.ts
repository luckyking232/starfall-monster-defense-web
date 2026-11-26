import { expect, test } from '@playwright/test';
import { originalClick, openChooser } from './navigation';

test('网页设置记住音量和帧率，新旧档独立并能删除', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('./');
  const settings = page.getByRole('button', { name: '网页设置' });
  await settings.click();
  const effects = page.getByRole('slider', { name: '音效音量' });
  await expect(effects).toHaveValue('100');
  await page.screenshot({path:test.info().outputPath('settings.png')});
  await effects.focus();
  await effects.press('Home');
  for (let i=0;i<22;i++) await effects.press('ArrowRight');
  await page.getByLabel('显示帧率').check();
  await page.getByRole('button', {name:'关闭',exact:true}).click();
  await expect(page.locator('.web-fps')).toHaveText(/\d+ FPS/);
  await page.reload();
  await settings.click();
  await expect(effects).toHaveValue('22');
  await page.getByRole('button',{name:'存档',exact:true}).click();
  await page.getByLabel('存档名称').fill('测试营地');
  await page.getByRole('button',{name:'新建并切换'}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await settings.click();
  await page.getByRole('button',{name:'调试',exact:true}).click();
  await page.getByRole('button',{name:'全解锁',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await settings.click();
  await page.getByRole('button',{name:'存档',exact:true}).click();
  await expect(page.getByText('已启用全解锁')).toBeVisible();
  await page.getByLabel('存档名称').fill('夜巡');
  await page.getByRole('button',{name:'重命名'}).click();
  await expect(page.getByText('当前存档 · 夜巡')).toBeVisible();
  await page.getByLabel('选择存档').selectOption({label:'默认存档'});
  await page.getByRole('button',{name:'切换存档'}).click();
  await settings.click();
  await page.getByRole('button',{name:'存档',exact:true}).click();
  await expect(page.getByText('当前存档 · 默认存档')).toBeVisible();
  await page.getByLabel('选择存档').selectOption({label:'夜巡'});
  await page.getByRole('button',{name:'切换存档'}).click();
  await settings.click();
  await page.getByRole('button',{name:'存档',exact:true}).click();
  await expect(page.getByText('已启用全解锁')).toBeVisible();
  await page.getByRole('button',{name:'删除存档'}).click();
  await page.getByRole('button',{name:'确认删除'}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await settings.click();
  await page.getByRole('button',{name:'存档',exact:true}).click();
  await expect(page.getByText('已启用全解锁')).toHaveCount(0);
});

test.describe('竖屏网页设置', () => {
  test.use({ viewport:{width:360,height:640}, hasTouch:true, isMobile:true });
  test('触摸齿轮可以管理存档并返回选关', async ({page}) => {
    await page.goto('./');
    await openChooser(page,'touch');
    await page.getByRole('button',{name:'网页设置'}).tap();
    await page.getByRole('button',{name:'存档',exact:true}).tap();
    await expect(page.getByRole('button',{name:'新建并切换'})).toBeInViewport();
    await page.screenshot({path:test.info().outputPath('portrait-slots.png')});
    await page.getByRole('button',{name:'关闭',exact:true}).tap();
    await expect(page.getByRole('region',{name:'选择关卡'})).toBeVisible();
  });
});

test('原主页礼包和参与任务按钮打开不同彩蛋', async ({page}) => {
  await page.goto('./');
  await expect(page.getByRole('region',{name:'魔物抵御战活动主页'})).toBeVisible();
  await originalClick(page,45,679);
  await expect(page.getByRole('dialog',{name:'前线补给箱'})).toBeVisible();
  await page.getByRole('button',{name:'打开补给箱'}).click();
  await expect(page.getByRole('button',{name:'再翻一层'})).toBeVisible();
  await page.getByRole('button',{name:'关闭'}).click();
  await originalClick(page,435,680);
  const ring = page.getByRole('button',{name:'敲锣'});
  for (let i=0;i<3;i++) await ring.click();
  await expect(page.getByRole('button',{name:'已交班'})).toBeDisabled();
});

test('战斗调试升一级进入原版选卡', async ({ page }) => {
  await page.goto('./');
  await openChooser(page);
  await originalClick(page, 145, 274);
  await expect(page.getByRole('region',{name:'魔物抵御战战场'})).toBeVisible({timeout:30000});
  await page.getByRole('button',{name:'网页设置'}).click();
  await page.getByRole('button',{name:'调试',exact:true}).click();
  await page.getByLabel('调试码').fill('levelup');
  await page.getByRole('button',{name:'执行'}).click();
  await expect(page.getByRole('region',{name:'选择强化'})).toBeVisible({timeout:15000});
});

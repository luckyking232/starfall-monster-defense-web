import { expect, test } from '@playwright/test';

test('首次启动在脚本和资源等待时保持可见并显示真实进度', async ({ page }) => {
  let resume!: () => void;
  const gate = new Promise<void>(done => { resume = done; });
  await page.route('**/assets/runtime/ui/manifest.json', async route => { await gate; await route.continue(); });
  await page.goto('./',{ waitUntil:'domcontentloaded' });
  const screen = page.locator('#startup');
  await expect(screen).toBeVisible();
  await expect(screen).toContainText('首次');
  await expect(screen.getByRole('progressbar')).toBeVisible();
  await page.screenshot({path:test.info().outputPath('first-load.png')});
  await page.evaluate(() => {
    const bar = document.querySelector('progress')!;
    const values = (window as unknown as {bootValues:number[]}).bootValues = [bar.value];
    new MutationObserver(() => values.push(bar.value)).observe(bar,{attributes:true});
  });
  resume();
  await expect(page.getByRole('region',{name:'魔物抵御战活动主页'})).toBeVisible({timeout:45000});
  await expect(screen).toHaveCount(0);
  const values = await page.evaluate(() => (window as unknown as {bootValues:number[]}).bootValues);
  expect(values.some(v=>v>10 && v<100)).toBe(true);
  expect(values.at(-1)).toBe(100);
});

test('资源失败可从加载页重试', async ({page}) => {
  await page.route('**/assets/runtime/ui/manifest.json', route => route.abort(),{times:1});
  await page.goto('./');
  const retry = page.getByRole('button',{name:'重新加载'});
  await expect(retry).toBeVisible({timeout:20000});
  await retry.click();
  await expect(page.getByRole('region',{name:'魔物抵御战活动主页'})).toBeVisible({timeout:45000});
});

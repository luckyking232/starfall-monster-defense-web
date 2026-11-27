import { expect, test } from '@playwright/test';

const uiManifest = /\/assets\/(?:release-[a-f0-9]+\/)?runtime\/ui\/manifest\.json$/;
const commonFontUrl = /\/source-han-sans-common-[^/]+\.woff2$/;
const fullFontUrl = /\/source-han-sans-full-[^/]+\.woff2$/;
// U+20BB7 is in the original full face and outside the generated common face.
const rareSaveName = '夜巡𠮷';
const rareFontRange = 'U+20BB7';

test('首次启动在脚本和资源等待时保持可见并显示真实进度', async ({ page }) => {
  let resume!: () => void;
  const gate = new Promise<void>(done => { resume = done; });
  await page.route(uiManifest, async route => { await gate; await route.continue(); });
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
  await page.route(uiManifest, route => route.abort(),{times:1});
  await page.goto('./');
  const retry = page.getByRole('button',{name:'重新加载'});
  await expect(retry).toBeVisible({timeout:20000});
  await retry.click();
  await expect(page.getByRole('region',{name:'魔物抵御战活动主页'})).toBeVisible({timeout:45000});
});

test('冷首页只载入常用字形，罕见字存档名使用完整原字体', async ({page}) => {
  const fontRequests: string[] = [];
  page.on('request', request => {
    if (request.url().endsWith('.woff2')) fontRequests.push(request.url());
  });
  await page.goto('./');
  await expect(page.getByRole('region', {name:'魔物抵御战活动主页'})).toBeVisible({timeout:45000});
  await expect(page.locator('#startup')).toHaveCount(0);
  expect(fontRequests, '冷首页请求常用字体').toEqual(expect.arrayContaining([expect.stringMatching(commonFontUrl)]));
  expect(fontRequests.filter(url => fullFontUrl.test(url)), '冷首页完整字体请求').toEqual([]);

  let resume!: () => void;
  const gate = new Promise<void>(done => { resume = done; });
  await page.route(fullFontUrl, async route => { await gate; await route.continue(); });
  await page.evaluate(() => {
    const requests = document.createElement('output');
    requests.id = 'font-load-requests';
    requests.hidden = true;
    document.body.append(requests);
    const load = document.fonts.load.bind(document.fonts);
    document.fonts.load = (font, text) => {
      requests.value += `${font} ${text ?? ''}\n`;
      return load(font, text);
    };
  });
  const rareFaceStatus = () => page.evaluate(range => [...document.fonts]
    .filter(face => face.family === 'SourceHanSans' && face.unicodeRange.split(',').some(item => item.trim().toUpperCase() === range))
    .map(face => face.status), rareFontRange);
  try {
    await page.getByRole('button', {name:'网页设置'}).click();
    await page.getByRole('button', {name:'存档',exact:true}).click();
    await page.getByLabel('存档名称').fill(rareSaveName);
    await page.getByRole('button', {name:'重命名'}).click();
    await expect(page.getByText(`当前存档 · ${rareSaveName}`)).toBeVisible();
    await expect(page.locator('#font-load-requests')).toContainText(rareSaveName);
    await expect.poll(rareFaceStatus, {message:'完整原字体在响应被延迟时处于加载状态'}).toEqual(['loading']);
  } finally {
    resume();
  }
  await expect.poll(rareFaceStatus, {message:'U+20BB7 对应的 SourceHanSans 已完成加载'}).toEqual(['loaded']);
});

test('没有浏览器解压 API 时，使用相同的原格式词条进入游戏', async ({page}) => {
  await page.route('**/ui-host-worker.js', async route => {
    const response = await route.fetch();
    await route.fulfill({contentType:'text/javascript', body:'self.DecompressionStream = undefined;\n' + await response.text()});
  });
  await page.route('**/BaseWord_cn.lua.gz', route => route.abort());
  const table = page.waitForResponse(response => response.url().endsWith('/BaseWord_cn.player.lua') && response.ok());
  await page.goto('./');
  await expect(page.getByRole('region', {name:'魔物抵御战活动主页'})).toBeVisible({timeout:45000});
  expect((await (await table).body()).byteLength).toBeLessThan(50000);
});

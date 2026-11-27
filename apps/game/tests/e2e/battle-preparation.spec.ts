import { expect, test } from '@playwright/test';
import type { UiHostMessage } from '../../runtime/ui/protocol';
import { openChooser, originalClick } from './navigation';

const musicTrack = /\/assets\/(?:release-[a-f0-9]+\/)?audio\/02_B02-O\.(wav|flac)$/;

test('选关只预取推荐关，改选第二关时增量准备所需资源', async ({ page }) => {
  test.setTimeout(90000);
  await page.addInitScript(() => {
    for (const prefix of ['', 'starfall.web-test:']) {
      localStorage.setItem(prefix + 'starfall.monster-defense.progress/2/default/all-unlocked', '1');
      localStorage.setItem(prefix + 'starfall.monster-defense.settings/3', '{"music":0,"effects":0}');
    }
  });
  const requests: string[] = [];
  page.on('request', request => requests.push(new URL(request.url()).pathname));
  const count = (ending: string) => requests.filter(path => path.endsWith(ending)).length;
  const map = (index: number) => `/native/frames/MiniGame022_map${index}.png`;
  await page.goto('./');
  await openChooser(page);
  await expect.poll(() => count(map(1))).toBe(1);
  await page.waitForLoadState('networkidle');
  expect(count(map(2))).toBe(0);
  expect(count(map(3))).toBe(0);
  expect(count('/native/units/minigamespine_20108_pixel.json')).toBe(0);
  await originalClick(page, 335, 444);
  await expect(page.getByRole('region', { name: '魔物抵御战战场' })).toBeVisible({ timeout: 30000 });
  await expect(page.locator('body')).toHaveAttribute('data-map', 'map2');
  expect(count(map(2))).toBe(1);
  expect(count(map(3))).toBe(0);
  expect(count('/native/units/minigamespine_10000118_pixel.json')).toBe(1);

  const exit = page.getByRole('region', { name: '确认退出战斗' });
  await expect(async () => {
    await originalClick(page, 79, 47);
    await expect(exit).toBeVisible({ timeout: 700 });
  }).toPass({ timeout: 15000 });
  await originalClick(page, 977, 575);
  await expect(page.getByRole('region', { name: '战斗结算' })).toBeVisible();
  await originalClick(page, 667, 575);
  await expect(page.getByRole('region', { name: '选择关卡' })).toBeVisible();
  await originalClick(page, 145, 274);
  await expect(page.getByRole('region', { name: '魔物抵御战战场' })).toBeVisible({ timeout: 30000 });
  await expect(page.locator('body')).toHaveAttribute('data-map', 'map1');
  expect(count(map(1))).toBe(1);
  expect(count('/native/units/minigamespine_10000118_pixel.json')).toBe(1);
});

test('首页跳过战斗图集，并等待首战界面在选关时预取的贴图', async ({page}) => {
  let allow!: () => void;
  let requests = 0;
  const gate = new Promise<void>(done => { allow = done; });
  await page.route('**/ActivityDungeon1017Battle_atlas0.webp', async route => {
    requests++;
    await gate;
    await route.continue();
  });
  try {
    await page.goto('./');
    await expect(page.getByRole('region', {name:'魔物抵御战活动主页'})).toBeVisible({timeout:45000});
    expect(requests).toBe(0);
    await openChooser(page);
    await expect.poll(() => requests).toBe(1);
    await originalClick(page,145,274);
    await expect(page.locator('.battle-wait')).toContainText('战斗界面');
    await expect(page.getByRole('region', {name:'魔物抵御战战场'})).toHaveCount(0);
  } finally { allow(); }
  await expect(page.getByRole('region', {name:'魔物抵御战战场'})).toBeVisible({timeout:30000});
  await expect(page.locator('.battle-wait')).toBeHidden();
  expect(requests).toBe(1);
});

test('选关预载音乐，慢请求期间显示原过场，开战前音乐已完成解码', async ({page}) => {
  test.setTimeout(90000);
  let allow!: () => void, requests = 0;
  const gate = new Promise<void>(done => { allow=done; });
  await page.route(musicTrack, async route => { requests++; await gate; await route.continue(); });
  await page.addInitScript(() => {
    const observed = { frame:0, musicStarts:0, decodedMusic:0, decodedAtFirstFrame:0 };
    Object.assign(window,{ battlePreparation:observed });
    const priorDecode = AudioContext.prototype.decodeAudioData;
    AudioContext.prototype.decodeAudioData = function (...args) {
      const result = priorDecode.apply(this,args);
      void result.then(buffer=>{ if (buffer.duration>30) observed.decodedMusic++; }).catch(()=>{});
      return result;
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      if (this.buffer && this.buffer.duration>30) observed.musicStarts++;
      return start.apply(this,args);
    };
    const WorkerClass = window.Worker;
    window.Worker = class extends WorkerClass {
      constructor(url:string|URL,options?:WorkerOptions) {
        super(url,options);
        this.addEventListener('message',({data}:MessageEvent<UiHostMessage>)=>{
          if(data.type==='event' && data.event.name==='world' && data.event.state.fixedFrame>0) {
            if (!observed.frame) observed.decodedAtFirstFrame = observed.decodedMusic;
            observed.frame = data.event.state.fixedFrame;
          }
        });
      }
    };
  });
  const observe = () => page.evaluate(()=>(window as unknown as {battlePreparation:{frame:number;musicStarts:number;decodedAtFirstFrame:number}}).battlePreparation);
  try {
    await page.goto('./');
    await openChooser(page);
    await expect.poll(()=>requests,{timeout:10000}).toBe(1);
    await originalClick(page,145,274);
    await expect(page.locator('.battle-wait')).toContainText('战斗音乐');
    await expect(page.locator('.loading-art')).toBeVisible({timeout:10000});
    expect(await observe()).toMatchObject({frame:0,musicStarts:0});
  } finally { allow(); }
  await expect.poll(async()=>(await observe()).frame,{timeout:30000}).toBeGreaterThan(0);
  await expect.poll(async()=>(await observe()).musicStarts).toBeGreaterThanOrEqual(2);
  expect((await observe()).decodedAtFirstFrame).toBeGreaterThanOrEqual(2);
  await expect(page.locator('.battle-wait')).toBeHidden();
  expect(requests).toBe(1);
});

test('音乐不可用时可重试，也能选择无音乐进入', async({page})=>{
  test.setTimeout(75000);
  let failures=0;
  await page.route(musicTrack, async route=>{failures++; await route.abort();});
  await page.goto('./');
  await openChooser(page);
  await originalClick(page,145,274);
  const retry = page.getByRole('button',{name:'重试音乐'});
  await expect(retry).toBeVisible({timeout:20000});
  const previous=failures;
  await retry.click();
  await expect.poll(()=>failures).toBeGreaterThan(previous);
  await page.getByRole('button',{name:'无音乐进入'}).click();
  await expect(page.getByRole('region',{name:'魔物抵御战战场'})).toBeVisible({timeout:30000});
  await expect(page.locator('.battle-wait')).toBeHidden();
});

test('角色帧预取遇到短暂 503 时只重取失败的帧，并自动进入战斗', async ({ page }, info) => {
  test.setTimeout(60000);
  const frameAsset = /\/assets\/(?:release-[a-f0-9]+\/)?native\/frames\/[^/]+\.png$/;
  const interruptedFrame = '/native/frames/battlespine_20302_pixel_5.png';
  const requests = new Map<string, number>();
  const loaded = new Set<string>();
  const interrupted: { afterEntry: boolean; status: number }[] = [];
  let attempts = 0;

  await page.addInitScript(() => {
    const battle = { entered: false, frame: 0 };
    Object.assign(window, { spriteRetryBattle: battle });
    const WorkerClass = window.Worker;
    window.Worker = class extends WorkerClass {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('message', ({ data }: MessageEvent<UiHostMessage>) => {
          if (data.type !== 'event') return;
          if (data.event.name === 'start-battle') battle.entered = true;
          if (data.event.name === 'world') battle.frame = data.event.state.fixedFrame;
        });
      }
    };
  });
  const battle = () => page.evaluate(() =>
    (window as unknown as { spriteRetryBattle: { entered: boolean; frame: number } }).spriteRetryBattle);

  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (frameAsset.test(path)) requests.set(path, (requests.get(path) ?? 0) + 1);
  });
  page.on('response', response => {
    const path = new URL(response.url()).pathname;
    if (frameAsset.test(path) && response.ok()) loaded.add(path);
  });
  await page.route(`**${interruptedFrame}`, async route => {
    const attempt = ++attempts;
    // Hold the second response across entry. Even a fresh foreground preload
    // still gets a 503, without using up the full retry budget in the chooser.
    if (attempt === 2) {
      await page.waitForFunction(() =>
        (window as unknown as { spriteRetryBattle: { entered: boolean } }).spriteRetryBattle.entered);
    }
    const { entered } = await battle();
    if (attempt <= 2) {
      interrupted.push({ afterEntry: entered, status: 503 });
      await route.fulfill({ status: 503, contentType: 'text/plain', body: 'Temporary sprite outage' });
    } else {
      interrupted.push({ afterEntry: entered, status: 200 });
      await route.continue();
    }
  });

  let prefetched: string[] = [];
  try {
    await page.goto('./');
    await openChooser(page);
    await expect.poll(() => interrupted.some(request => !request.afterEntry && request.status === 503)).toBe(true);
    await expect.poll(() => [...loaded].some(path => path.endsWith('/battlespine_20302_pixel_4.png'))).toBe(true);
    prefetched = [...loaded];
    await originalClick(page, 145, 274);
    const battlefield = page.getByRole('region', { name: '魔物抵御战战场' });
    const retry = page.getByRole('button', { name: '重试画面' });
    const outcome = await Promise.race([
      battlefield.waitFor({ state: 'visible', timeout: 30000 }).then(() => 'battle'),
      retry.waitFor({ state: 'visible', timeout: 30000 }).then(() => 'manual-retry'),
    ]);
    expect(outcome).toBe('battle');
    await expect.poll(async () => (await battle()).frame).toBeGreaterThan(0);
    await expect(page.locator('.battle-wait')).toBeHidden();
    expect(interrupted).toEqual([
      { afterEntry: false, status: 503 },
      { afterEntry: true, status: 503 },
      { afterEntry: true, status: 200 },
    ]);
    expect([...loaded].some(path => path.endsWith(interruptedFrame))).toBe(true);
    expect(prefetched.filter(path => requests.get(path) !== 1)).toEqual([]);
  } finally {
    await info.attach('sprite-requests', {
      contentType: 'application/json',
      body: JSON.stringify({
        interrupted, prefetched: prefetched.length,
        repeatedSuccesses: prefetched.filter(path => requests.get(path) !== 1),
        requests: Object.fromEntries(requests),
      }, null, 2),
    });
    await page.screenshot({ path: info.outputPath('sprite-retry.png') });
  }
});

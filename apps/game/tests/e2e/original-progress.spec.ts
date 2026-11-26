import { expect, test } from '@playwright/test';
import { openChooser, originalClick } from './navigation';

test('saved clears reach the original UI worker without rewriting damaged or isolated records', async ({ page }) => {
  test.setTimeout(120000);
  const schema = 'starfall.monster-defense.progress/1';
  const marker = (stageId: number) => JSON.stringify({ schema, stageId, settlement: 'confirmed_natural_win' });
  const records = {
    [`${schema}/78000001`]: marker(78000001),
    [`${schema}/78000002`]: '{damaged',
    [`${schema}/78000003`]: marker(78000003),
    [`${schema}/78000021`]: marker(78000021),
  };
  await page.route('**/original-progress.html', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><div id="app" style="position:fixed;inset:0"></div>',
  }));
  await page.goto('./original-progress.html');
  await page.evaluate((initialRecords) => {
    for (const [key, value] of Object.entries(initialRecords)) localStorage.setItem(key, value);
  }, records);

  const score = await page.evaluate(async () => {
    const { OriginalUiClient, OriginalUiWindow } = await import(/* @vite-ignore */ new URL('assets/ui-client.js', document.baseURI).href);
    const client = new OriginalUiClient();
    const events: unknown[] = [];
    const view = new OriginalUiWindow(
      document.querySelector('#app'),
      client,
      (event: unknown) => events.push(event),
      (error: Error) => { throw error; },
    );
    Object.assign(window, { __progressView: view, __progressEvents: events });
    await view.init({ activityStartStamp: 1_700_000_000, serverNowStamp: 1_764_000_000 });
    return view.runtime.find('Main/Top/Integral/NumberTxt').content.text;
  });
  expect(score).toBe('1');

  await page.mouse.click(1147, 679);
  await expect.poll(() => page.evaluate(() => {
    const view = (window as any).__progressView;
    const list = view.runtime.views.get('Activity17MiniGameChoice2Window')?.nodes.get('Main/TipsList');
    const map = list?.list?.items[0];
    const nodes = map ? [...map.children.values()] : [];
    const get = (name: string) => nodes.find((node: any) => node.path.endsWith(`/${name}`)) as any;
    return {
      firstPassed: get('Tips1Btn')?.controllers.get('c2'),
      secondLocked: get('Tips2Btn')?.controllers.get('lock'),
      thirdLocked: get('Tips3Btn')?.controllers.get('lock'),
      scrollX: list?.list?.scrollX,
    };
  })).toEqual({ firstPassed: 1, secondLocked: 0, thirdLocked: 1, scrollX: -190 });

  // The original window scrolls to the next stage. Expose both buttons for pointer input.
  await page.evaluate(() => (window as any).__progressView.runtime.setScroll('Main/TipsList', 0));
  await page.mouse.click(145, 274);
  await expect.poll(() => page.evaluate(() => (window as any).__progressEvents)).toContainEqual({ name: 'warn-tips', text: '已通关' });
  await page.mouse.click(525, 274);
  await expect.poll(() => page.evaluate(() => (window as any).__progressEvents)).toContainEqual({ name: 'warn-tips', text: '前置关卡未通过' });
  await page.mouse.click(335, 444);
  await expect.poll(() => page.evaluate(() => (window as any).__progressEvents.filter((event: any) => event.name === 'start-battle')))
    .toEqual([{ name: 'start-battle', stageId: 78000002 }]);

  const stored = await page.evaluate((keys) => Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)])), Object.keys(records));
  expect(stored).toEqual(records);
  await page.evaluate(() => (window as any).__progressView.dispose());
});

test('a clear in another tab unlocks the open chooser for the same local save', async ({ page, context }) => {
  await page.goto('./');
  await openChooser(page);
  await originalClick(page, 335, 444);
  await expect(page.getByRole('status').filter({ hasText: '前置关卡未通过' })).toBeVisible();

  const otherTab = await context.newPage();
  await otherTab.route('**/write-test-save.html', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }));
  await otherTab.goto('./write-test-save.html');
  await otherTab.evaluate(() => localStorage.setItem('starfall.monster-defense.progress/2/default/clear/78000001', '1'));
  await otherTab.close();

  await page.bringToFront();
  await expect(async () => {
    await originalClick(page, 335, 444);
    await expect(page.getByRole('region', { name: '魔物抵御战战场' })).toBeVisible({ timeout: 1600 });
  }).toPass({ timeout: 15000 });
});

test('an assisted second clear in another tab unlocks the third stage and persists across reload', async ({ page, context }) => {
  await page.addInitScript(() => localStorage.setItem('starfall.monster-defense.progress/2/default/clear/78000001', '1'));
  await page.goto('./');
  await openChooser(page);
  await originalClick(page, 335, 294);
  await expect(page.getByRole('status').filter({ hasText: '前置关卡未通过' })).toBeVisible();

  const otherTab = await context.newPage();
  await otherTab.route('**/write-test-save.html', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }));
  await otherTab.goto('./write-test-save.html');
  await otherTab.evaluate(() => localStorage.setItem('starfall.monster-defense.progress/2/default/assisted/78000002', '1'));
  await otherTab.close();
  await page.bringToFront();
  await expect(async () => {
    await originalClick(page, 335, 294);
    await expect(page.getByRole('region', { name: '魔物抵御战战场' })).toBeVisible({ timeout: 1600 });
  }).toPass({ timeout: 15000 });

  await page.reload();
  await openChooser(page);
  await originalClick(page, 145, 294);
  await expect(page.getByRole('region', { name: '魔物抵御战战场' })).toBeVisible({ timeout: 30000 });
});

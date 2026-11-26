import { expect, test } from '@playwright/test';

const TEST_ACTIVITY_START = 1_700_000_000;
const TEST_SERVER_NOW = 1_764_000_000;

test('original Lua windows drive the real FGUI renderer and input', async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await (await import('./fixture')).openFixture(page);
  const initial = await page.evaluate(async ({ activityStartStamp, serverNowStamp }) => {
    const { OriginalUiClient, OriginalUiWindow } = await import(/* @vite-ignore */ new URL('assets/ui-client.js', document.baseURI).href);
    const events: any[] = [];
    const failures: string[] = [];
    const view = new OriginalUiWindow(
      document.querySelector('#app'),
      new OriginalUiClient(),
      (event: any) => events.push(event),
      (error: Error) => failures.push(error.message),
    );
    Object.assign(window, { __originalView: view, __originalEvents: events, __originalFailures: failures });
    const ready = await view.init({ activityStartStamp, serverNowStamp });
    const start = view.runtime.find('Main/StartBtn');
    return {
      entryPoint: ready.entryPoint,
      text: view.runtime.find('Main/StartBtn/WordTxt').content.text,
      handlers: view.handlerCount(start.source.id),
      x: start.x,
      y: start.y,
      width: start.width,
      height: start.height,
      buttonImageWidth: view.runtime.find('Main/StartBtn/n10').width,
      titleWidth: view.runtime.find('Main/n14').width,
      failures,
    };
  }, { activityStartStamp: TEST_ACTIVITY_START, serverNowStamp: TEST_SERVER_NOW });
  expect(initial.entryPoint).toBe('Activity17MiniGame2MainWindow');
  expect(initial.text).toBe('前往');
  expect(initial.handlers).toBe(1);
  expect([initial.x, initial.y, initial.width, initial.height]).toEqual([1036, 647, 222, 64]);
  expect(initial.buttonImageWidth).toBe(221);
  expect(initial.titleWidth).toBe(387);
  expect(initial.failures).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('main.png') });

  await page.mouse.click(1147, 679);
  await expect.poll(() => page.evaluate(() => {
    const view = (window as any).__originalView;
    return view.runtime.views.get('Activity17MiniGameChoice2Window')?.nodes.get('Main/CardRegion/HeadList')?.list?.items.length ?? 0;
  })).toBe(5);
  expect(await page.evaluate(() => {
    const view = (window as any).__originalView;
    const map = view.runtime.find('Main/TipsList').list.items[0];
    return [...map.children.values()].filter((node: any) => /^Tips\d+Btn$/.test(node.path.split('/').pop()) || node.path.endsWith('SpecialBtn')).length;
  })).toBe(21);
  await page.screenshot({ path: test.info().outputPath('choice.png') });

  await page.mouse.click(525, 274);
  await expect.poll(() => page.evaluate(() => (window as any).__originalEvents.filter((event: any) => event.name === 'warn-tips').length)).toBe(1);
  expect(await page.evaluate(() => (window as any).__originalEvents.filter((event: any) => event.name === 'start-battle').length)).toBe(0);
  await page.mouse.click(145, 274);
  await expect.poll(() => page.evaluate(() => (window as any).__originalEvents.filter((event: any) => event.name === 'start-battle').length)).toBe(1);
  expect(await page.evaluate(() => (window as any).__originalEvents.find((event: any) => event.name === 'start-battle').stageId)).toBe(78000001);
  expect(await page.evaluate(() => (window as any).__originalFailures)).toEqual([]);
  expect(errors).toEqual([]);
  await page.evaluate(() => (window as any).__originalView.dispose());
});

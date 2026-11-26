import { expect, test } from '@playwright/test';

test('the original FGUI start window renders with original atlas geometry and input', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await (await import('./fixture')).openFixture(page);
  const result = await page.evaluate(async () => {
    const { FguiRuntime } = await import(/* @vite-ignore */ new URL('assets/fgui-probe.js', document.baseURI).href);
    const events: unknown[] = [];
    const runtime = new FguiRuntime(document.querySelector('#app'), (event: unknown) => events.push(event));
    await runtime.show('ActivityDungeon1017', 'MiniGame2Window');
    runtime.setUrl('Main/BackGround/BackGroundLoader', 'ui://aonql508q3oheq');
    runtime.setText('Main/StartBtn/WordTxt', '前往');
    const start = runtime.find('Main/StartBtn');
    Object.assign(window, { __fguiProbe: { runtime, events } });
    return { start: { x: start.x, y: start.y, width: start.width, height: start.height }, canvasCount: document.querySelectorAll('canvas').length };
  });
  expect(result.start).toEqual({ x: 1036, y: 647, width: 222, height: 64 });
  expect(result.canvasCount).toBe(1);
  await page.screenshot({ path: test.info().outputPath('original-start.png') });
  await page.mouse.click(1147, 679);
  await expect.poll(() => page.evaluate(() => (window as any).__fguiProbe.events.length)).toBe(1);
  expect(await page.evaluate(() => (window as any).__fguiProbe.events[0].path)).toBe('Main/StartBtn');
  expect(errors).toEqual([]);
});

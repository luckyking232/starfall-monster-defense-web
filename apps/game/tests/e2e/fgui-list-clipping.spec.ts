import { expect, test, type Page } from '@playwright/test';
import type { PackageRegistry as FguiPackageRegistry } from '../../src/fgui/package';

async function visiblePixels(page: Page, x: number, y: number): Promise<number> {
  const screenshot = (await page.screenshot()).toString('base64');
  return page.evaluate(async ({ screenshot, x, y }) => {
    const image = new Image();
    image.src = `data:image/png;base64,${screenshot}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 24;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, -x, -y);
    const rgba = context.getImageData(0, 0, 24, 24).data;
    let colored = 0;
    for (let offset = 0; offset < rgba.length; offset += 4) {
      if (Math.max(rgba[offset]!, rgba[offset + 1]!, rgba[offset + 2]!) > 24) colored++;
    }
    return colored;
  }, { screenshot, x, y });
}

test('the WebGL stage viewport clips pixels and hits as the original list scrolls', async ({ page }) => {
  const maskWarnings: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes('Phaser.GameObjects.Components.Mask.setMask')) maskWarnings.push(message.text());
  });
  await page.goto('./');
  const renderer = await page.evaluate(async () => {
    const { FguiRuntime, PackageRegistry } = await import(/* @vite-ignore */ new URL('assets/fgui-probe.js', document.baseURI).href);
    const registry: FguiPackageRegistry = await PackageRegistry.load();
    const packageName = 'ActivityDungeon1017';
    const parent = document.createElement('div');
    parent.style.cssText = 'position:fixed;inset:0;z-index:100';
    document.body.append(parent);
    const actions: string[] = [];
    const runtime = new FguiRuntime(parent, (action: { path: string }) => actions.push(action.path));
    await runtime.show(packageName, 'MiniGameChoice2');
    const source = registry.component('MiniGameChoice2', packageName).children!.find((child) => child.name === 'TipsList')!;
    const viewport = { ...source, x: 100, y: 60, width: 390, height: 680 };
    runtime.mount('clipping-probe', { id: 'root', name: 'root', objectType: 'Component', width: 1334, height: 750, children: [viewport] }, packageName);
    runtime.addListItem('TipsList', source.defaultItem!);
    Object.assign(window, { __scrollClip: { actions, runtime } });
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return runtime.find('TipsList').container.scene.sys.renderer.type;
  });
  expect(renderer).toBe(2);
  expect(await visiblePixels(page, 233, 320)).toBeGreaterThan(100);
  expect(await visiblePixels(page, 613, 320)).toBe(0);
  await page.mouse.click(625, 334);
  await page.mouse.click(245, 334);
  await expect.poll(() => page.evaluate(() => (window as any).__scrollClip.actions)).toEqual(['TipsList/item0/Tips1Btn']);
  await page.mouse.move(300, 300);
  await page.mouse.wheel(380, 0);
  await expect.poll(() => page.evaluate(() => (window as any).__scrollClip.runtime.find('TipsList').list.scrollX)).toBe(-380);
  expect(await visiblePixels(page, 233, 320)).toBeGreaterThan(100);
  expect(await visiblePixels(page, 613, 320)).toBe(0);
  await page.mouse.click(625, 334);
  await page.mouse.click(245, 334);
  await expect.poll(() => page.evaluate(() => (window as any).__scrollClip.actions)).toEqual(['TipsList/item0/Tips1Btn', 'TipsList/item0/Tips3Btn']);
  await page.evaluate(() => (window as any).__scrollClip.runtime.dispose());
  expect(maskWarnings).toEqual([]);
});

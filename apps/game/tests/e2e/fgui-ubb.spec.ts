import { expect, test } from '@playwright/test';
import type { FguiChild, PackageRegistry as FguiPackageRegistry } from '../../src/fgui/package';

test('the original HUD renders its localized UBB colors in order without drawing tags', async ({ page }) => {
  await page.goto('./');
  const fixture = await page.evaluate(async () => {
    const { FguiRuntime, PackageRegistry } = await import(/* @vite-ignore */ new URL('assets/fgui-probe.js', document.baseURI).href);
    const registry: FguiPackageRegistry = await PackageRegistry.load();
    const pkg = 'ActivityDungeon1017Battle';
    const words = await (await fetch(new URL('assets/runtime/ui/original/BaseWord_cn.lua', document.baseURI))).text();
    const localized = (id: number, ...values: string[]) => {
      const entry = new RegExp(`\\[${id}\\]\\s*=\\s*\\{[^}]*?name\\s*=\\s*"([^"]+)"`).exec(words);
      if (!entry) throw new Error(`Missing original word ${id}`);
      let index = 0;
      return entry[1]!.replace(/%[ds]/g, () => values[index++]!);
    };
    const text = (component: string, name: string, y: number): FguiChild => ({
      ...registry.component(component, pkg).children!.find((child) => child.name === name)!, x: 250, y,
    });
    const exp = localized(11900, '12', '180');
    const killed = localized(11901, '17');
    const wave = localized(11903, '第一关', '2');
    const centered = text('BattleEnd', 'TitleTxt', 240);
    const plain = { ...text('Number', 'NumberTxt', 300), name: 'Plain', ubbEnabled: false };
    const parent = document.createElement('div');
    parent.style.cssText = 'position:fixed;inset:0;z-index:100';
    document.body.append(parent);
    const runtime = new FguiRuntime(parent, () => {});
    await runtime.show(pkg, 'BattleUIWindow');
    runtime.close('preview');
    runtime.mount('ubb', {
      id: 'probe', name: 'probe', objectType: 'Component', width: 1334, height: 750,
      children: [text('Exp', 'ExpTxt', 60), text('Number', 'NumberTxt', 120), text('Progress', 'TimeTxt', 180), centered, plain],
    }, pkg);
    runtime.setText('ExpTxt', exp);
    runtime.setText('NumberTxt', killed);
    runtime.setText('TimeTxt', wave);
    runtime.setText('TitleTxt', exp);
    runtime.setText('Plain', killed);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return {
      originalText: killed, plainText: runtime.find('Plain').content.text,
      renderedText: ['ExpTxt', 'NumberTxt', 'TimeTxt'].map((name) => runtime.find(name).content.text),
      centeredX: centered.x!, centeredWidth: centered.width!,
    };
  });
  const screenshot = await page.screenshot({ path: test.info().outputPath('original-HUD-ubb.png') });
  const pixels = await page.evaluate(async ({ screen, centeredX, centeredWidth }) => {
    const image = new Image();
    image.src = `data:image/png;base64,${screen}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    function colors(y: number, color: [number, number, number]) {
      const left = 100;
      const width = 570;
      const { data } = context.getImageData(left, y, width, 50);
      const colorX: number[] = [];
      const whiteX: number[] = [];
      for (let offset = 0; offset < data.length; offset += 4) {
        const x = left + offset / 4 % width;
        if (color.every((channel, i) => Math.abs(data[offset + i]! - channel) <= 6)) colorX.push(x);
        if ([0, 1, 2].every((i) => data[offset + i]! >= 244)) whiteX.push(x);
      }
      return {
        colorCount: colorX.length, whiteCount: whiteX.length,
        colorLeft: Math.min(...colorX), colorRight: Math.max(...colorX),
        whiteLeft: Math.min(...whiteX), whiteRight: Math.max(...whiteX),
      };
    }
    const centered = colors(240, [255, 204, 0]);
    const textCenter = (Math.min(centered.colorLeft, centered.whiteLeft) + Math.max(centered.colorRight, centered.whiteRight)) / 2;
    return {
      exp: colors(60, [255, 204, 0]), killed: colors(120, [230, 255, 81]), wave: colors(180, [230, 255, 81]),
      centered, centerError: Math.abs(textCenter - centeredX - centeredWidth / 2),
      plain: colors(300, [230, 255, 81]),
    };
  }, { screen: screenshot.toString('base64'), ...fixture });
  expect(pixels.exp.colorCount).toBeGreaterThan(10);
  expect(pixels.exp.whiteCount).toBeGreaterThan(10);
  expect(pixels.exp.colorRight).toBeLessThan(pixels.exp.whiteLeft);
  expect(pixels.exp.whiteRight - pixels.exp.colorLeft).toBeLessThan(100);
  for (const field of [pixels.killed, pixels.wave]) {
    expect(field.colorCount).toBeGreaterThan(10);
    expect(field.whiteCount).toBeGreaterThan(10);
    expect(field.whiteRight).toBeLessThan(field.colorLeft);
    expect(field.colorRight - field.whiteLeft).toBeLessThan(120);
  }
  expect(pixels.centered.colorCount).toBeGreaterThan(10);
  expect(pixels.centerError).toBeLessThan(8);
  expect(pixels.plain.colorCount).toBe(0);
  expect(fixture.plainText).toBe(fixture.originalText);
  expect(fixture.renderedText).toEqual(['12/180', '击退：17', '第一关-2']);
});

import { expect, test } from '@playwright/test';
import type { UiTreeNode } from '../../runtime/ui/protocol';

const PACKAGE = '1hbjipo6';
const BOXES = {
  image: { x: 40, y: 50, width: 472, height: 150 },
  loader: { x: 580, y: 40, width: 472, height: 160 },
  nineSlice: { x: 100, y: 250, width: 256, height: 47 },
  nineSliceLoader: { x: 470, y: 250, width: 320, height: 54 },
  unrotatedNineSlice: { x: 900, y: 250, width: 150, height: 70 },
};

test('rotated atlas entries draw upright in images, loaders and nine-slices', async ({ page }) => {
  await (await import('./fixture')).openFixture(page);
  const view = await page.evaluate(async ({ boxes, packageId }) => {
    const { FguiRuntime } = await import(/* @vite-ignore */ new URL('assets/fgui-probe.js', document.baseURI).href);
    const parent = document.createElement('div');
    parent.style.cssText = 'position:fixed;inset:0;z-index:100';
    document.body.append(parent);
    const runtime = new FguiRuntime(parent, () => {});

    function node(id: number, name: string, objectType: string, componentId: string, box: typeof boxes.image): UiTreeNode {
      return {
        id, name, type: objectType, objectType, componentId, packageId, ...box,
        visible: true, touchable: false, children: [], controllers: {},
        source: { width: box.width, height: box.height }, clickHandlerCount: 0,
      };
    }

    const loader = node(3, 'loader', 'Loader', '', boxes.loader);
    loader.source = {
      width: boxes.loader.width, height: boxes.loader.height,
      fill: 'Scale', align: 'Center', verticalAlign: 'Middle',
    };
    const nineSliceLoader = node(5, 'nineSliceLoader', 'Loader', '', boxes.nineSliceLoader);
    nineSliceLoader.source = {
      width: boxes.nineSliceLoader.width, height: boxes.nineSliceLoader.height, fill: 'ScaleFree',
    };
    const root = node(1, 'root', 'Component', '', { x: 0, y: 0, width: 1334, height: 750 });
    root.children = [
      node(2, 'image', 'Image', 'gevl34', boxes.image),
      loader,
      node(4, 'nineSlice', 'Image', 'n602r', boxes.nineSlice),
      nineSliceLoader,
      node(6, 'unrotatedNineSlice', 'Image', 'n602a', boxes.unrotatedNineSlice),
    ];
    await runtime.showTree('rotation-test', root);
    runtime.setUrl('loader', `ui://${packageId}gevl34`);
    const nineSliceUrl = `ui://${packageId}n602r`;
    runtime.setUrl('nineSliceLoader', nineSliceUrl);
    const textures = runtime.find('image').container.scene.textures;
    const initialTextureCount = textures.getTextureKeys().length;
    for (let i = 0; i < 3; i++) runtime.setUrl('nineSliceLoader', nineSliceUrl);
    // Phaser's visible canvas has completed at least one render after the URL change.
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const readGeometry = (path: string) => {
      const object = runtime.find(path).content;
      return {
        x: object.x, y: object.y, rotation: object.rotation,
        width: object.displayWidth, height: object.displayHeight,
      };
    };
    return {
      renderer: runtime.find('image').container.scene.sys.renderer.type,
      image: readGeometry('image'),
      loader: readGeometry('loader'),
      nineSlice: readGeometry('nineSlice'),
      nineSliceLoader: readGeometry('nineSliceLoader'),
      remainingTextureGrowth: textures.getTextureKeys().length - initialTextureCount,
    };
  }, { boxes: BOXES, packageId: PACKAGE });

  const screenshot = (await page.screenshot()).toString('base64');
  const mismatches = await page.evaluate(async ({ boxes, renderer, screenshotBase64 }) => {
    async function image(url: string): Promise<HTMLImageElement> {
      const result = new Image();
      result.src = url;
      await result.decode();
      return result;
    }

    // These are independent split exports of the same atlas items, upright in their PNGs.
    const cut = (name: string) => image(new URL('assets/ui/battle/' + name + '.png', document.baseURI).href);
    const [screen, button, bar, unrotatedBar] = await Promise.all([
      image('data:image/png;base64,' + screenshotBase64), cut('gevl34'), cut('n602r'), cut('n602a'),
    ]);
    function compare(box: typeof boxes.image, draw: (context: CanvasRenderingContext2D) => void): number {
      const canvas = document.createElement('canvas');
      canvas.width = box.width;
      canvas.height = box.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(screen, -box.x, -box.y);
      const actual = context.getImageData(0, 0, box.width, box.height).data;
      context.fillStyle = '#000';
      context.fillRect(0, 0, box.width, box.height);
      context.imageSmoothingEnabled = false;
      draw(context);
      const expected = context.getImageData(0, 0, box.width, box.height).data;
      let differences = 0;
      for (let offset = 0; offset < expected.length; offset += 4) {
        if ([0, 1, 2].some((channel) => Math.abs(actual[offset + channel]! - expected[offset + channel]!) > 10)) differences++;
      }
      return differences / (box.width * box.height);
    }

    function drawButton(context: CanvasRenderingContext2D, width: number, height: number): void {
      // Phaser's Canvas roundPixels mode expands each source-space destination edge by half a pixel.
      const extra = renderer === 1 ? 0.5 : 0;
      context.scale(width / button.width, height / button.height);
      context.drawImage(button, 0, 0, button.width, button.height,
        0, 0, button.width + extra, button.height + extra);
    }

    function drawNineSlice(
      context: CanvasRenderingContext2D, source: HTMLImageElement, width: number, height: number,
      [left, top, middleWidth, middleHeight]: [number, number, number, number],
    ): void {
      const right = source.width - left - middleWidth;
      const bottom = source.height - top - middleHeight;
      const sourceX = [0, left, source.width - right, source.width];
      const sourceY = [0, top, source.height - bottom, source.height];
      const targetX = [0, left, width - right, width];
      const targetY = [0, top, height - bottom, height];
      for (let row = 0; row < 3; row++) {
        for (let column = 0; column < 3; column++) {
          context.drawImage(source,
            sourceX[column]!, sourceY[row]!, sourceX[column + 1]! - sourceX[column]!, sourceY[row + 1]! - sourceY[row]!,
            targetX[column]!, targetY[row]!, targetX[column + 1]! - targetX[column]!, targetY[row + 1]! - targetY[row]!);
        }
      }
    }

    return {
      image: compare(boxes.image, (context) => drawButton(context, boxes.image.width, boxes.image.height)),
      loader: compare({ ...boxes.loader, y: boxes.loader.y + 30, height: 100 },
        (context) => drawButton(context, boxes.loader.width, 100)),
      nineSlice: compare(boxes.nineSlice,
        (context) => drawNineSlice(context, bar, boxes.nineSlice.width, boxes.nineSlice.height, [41, 6, 82, 12])),
      nineSliceLoader: compare(boxes.nineSliceLoader,
        (context) => drawNineSlice(context, bar, boxes.nineSliceLoader.width, boxes.nineSliceLoader.height, [41, 6, 82, 12])),
      unrotatedNineSlice: compare(boxes.unrotatedNineSlice, (context) => drawNineSlice(
        context, unrotatedBar, boxes.unrotatedNineSlice.width, boxes.unrotatedNineSlice.height, [12, 3, 24, 6],
      )),
    };
  }, { boxes: BOXES, renderer: view.renderer, screenshotBase64: screenshot });

  expect.soft(view.image).toEqual({ x: 0, y: 0, rotation: 0, width: 472, height: 150 });
  expect.soft(view.loader).toEqual({ x: 0, y: 30, rotation: 0, width: 472, height: 100 });
  expect.soft(view.nineSlice).toEqual({ x: 0, y: 0, rotation: 0, width: 256, height: 47 });
  expect.soft(view.nineSliceLoader).toEqual({ x: 0, y: 0, rotation: 0, width: 320, height: expect.closeTo(54) });
  expect.soft(view.remainingTextureGrowth).toBe(0);
  expect.soft(mismatches.image).toBeLessThan(0.02);
  expect.soft(mismatches.loader).toBeLessThan(0.02);
  expect.soft(mismatches.nineSlice).toBeLessThan(0.02);
  expect.soft(mismatches.nineSliceLoader).toBeLessThan(0.02);
  expect(mismatches.unrotatedNineSlice).toBeLessThan(0.02);
});

import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import ts from 'typescript';

const DESIGN_WIDTH = 1334;
const DESIGN_HEIGHT = 750;
const RATIO = DESIGN_WIDTH / DESIGN_HEIGHT;
const targets = [
  { x: 245, y: 175, name: 'upper-left' },
  { x: 1090, y: 540, name: 'lower-right' },
];

async function mountHarness(page: Page): Promise<void> {
  const layout = readFileSync('src/styles/main.css', 'utf8').replace(/^@import .+;\s*$/gm, '');
  const rotation = readFileSync('src/styles/viewport.css', 'utf8');
  const viewport = ts.transpileModule(readFileSync('src/platform/viewport.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;

  await page.route('**/viewport-test-phaser.js', (route) => route.fulfill({
    path: 'node_modules/phaser/dist/phaser.min.js', contentType: 'text/javascript',
  }));
  await page.route('**/viewport-test-adapter.js', (route) => route.fulfill({
    body: viewport, contentType: 'text/javascript',
  }));
  await page.route('**/viewport-test.html', (route) => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html>
      <html><head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
        <style>${rotation}\n${layout}</style>
      </head><body>
        <main id="app" class="game-frame"><div id="canvas-host" class="screen"></div></main>
        <script src="./viewport-test-phaser.js"></script>
        <script type="module">
          import * as viewport from './viewport-test-adapter.js';
          viewport.installViewportTracking();
          window.viewportHits = [];
          new Phaser.Game({
            type: Phaser.CANVAS, parent: 'canvas-host', width: ${DESIGN_WIDTH}, height: ${DESIGN_HEIGHT},
            scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
            callbacks: { postBoot: game => viewport.installPhaserViewport?.(game) },
            input: { touch: true }, audio: { noAudio: true }, banner: false,
            scene: {
              create() {
                for (const target of ${JSON.stringify(targets)}) {
                  this.add.rectangle(target.x, target.y, 120, 100, 0x45c8af).setInteractive()
                    .on('pointerup', () => window.viewportHits.push(target.name));
                }
                document.body.dataset.ready = 'yes';
              },
            },
          });
        </script>
      </body></html>`,
  }));
  await page.goto('./viewport-test.html');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'yes');
}

test.use({ hasTouch: true, isMobile: true });

test('manual portrait mode releases on rotation and keeps touch aligned after the toolbar changes',async ({page}) => {
  await page.setViewportSize({width:390,height:844});
  await mountHarness(page);
  const root = page.locator('html');
  await expect(root).toHaveAttribute('data-frame-rotation','0');
  await page.getByRole('button',{name:'竖持横屏'}).click();
  await expect(root).toHaveAttribute('data-frame-rotation','90');
  await page.setViewportSize({width:844,height:390});
  await expect(root).toHaveAttribute('data-frame-rotation','0');
  await page.setViewportSize({width:844,height:315});
  await expect(page.locator('canvas')).toBeInViewport({ratio:0.99});
  const rect = (await page.locator('canvas').boundingBox())!;
  await page.touchscreen.tap(rect.x + rect.width * targets[1]!.x / DESIGN_WIDTH,rect.y + rect.height * targets[1]!.y / DESIGN_HEIGHT);
  await expect.poll(() => page.evaluate(() => (window as Window & {viewportHits?:string[]}).viewportHits)).toEqual(['lower-right']);
  await page.setViewportSize({width:390,height:844});
  await expect(root).toHaveAttribute('data-frame-rotation','90');
  await page.getByRole('button',{name:'恢复自然方向'}).click();
  await expect(root).toHaveAttribute('data-frame-rotation','0');
});

for (const size of [{ width: 390, height: 844 }, { width: 360, height: 640 }, { width: 844, height: 390 }, { width: 1920, height: 900 }]) {
  test(`fills the available landscape area and accepts real input at ${size.width}×${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await mountHarness(page);
    if (size.width < size.height) await page.getByRole('button',{name:'竖持横屏'}).click();
    const canvas = page.locator('canvas');
    await expect(canvas).toBeInViewport({ ratio: 0.99 });
    const bounds = (await canvas.boundingBox())!;
    const rotated = size.width < size.height;
    const landscapeWidth = Math.min(
      rotated ? size.height : size.width,
      (rotated ? size.width : size.height) * RATIO,
    );
    const landscapeHeight = landscapeWidth / RATIO;
    expect(Math.abs(bounds.width - (rotated ? landscapeHeight : landscapeWidth))).toBeLessThan(1);
    expect(Math.abs(bounds.height - (rotated ? landscapeWidth : landscapeHeight))).toBeLessThan(1);
    expect(Math.abs(bounds.x + bounds.width / 2 - size.width / 2)).toBeLessThan(1);
    expect(Math.abs(bounds.y + bounds.height / 2 - size.height / 2)).toBeLessThan(1);

    for (const { x, y } of targets) {
      const screenX = bounds.x + bounds.width * (rotated ? 1 - y / DESIGN_HEIGHT : x / DESIGN_WIDTH);
      const screenY = bounds.y + bounds.height * (rotated ? x / DESIGN_WIDTH : y / DESIGN_HEIGHT);
      if (rotated) await page.touchscreen.tap(screenX, screenY);
      else await page.mouse.click(screenX, screenY);
    }
    await expect.poll(() => page.evaluate(() => (window as Window & { viewportHits?: string[] }).viewportHits))
      .toEqual(targets.map(({ name }) => name));
  });
}

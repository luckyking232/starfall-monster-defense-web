import { expect, test } from '@playwright/test';
import type { UiClientRequest, UiHostMessage } from '../../runtime/ui/protocol';
import { openChooser, originalClick } from './navigation';

interface GraphicsProbe {
  starts: number;
  frame: number;
  clicks: number;
  heroes: number[];
  effects?: HTMLCanvasElement;
  contexts: Map<HTMLCanvasElement, WebGLRenderingContext | WebGL2RenderingContext>;
  draws: Map<HTMLCanvasElement, number>;
  extensions: WEBGL_lose_context[];
  awaitingPixels: Set<HTMLCanvasElement>;
  paintedPixels: Set<HTMLCanvasElement>;
}

declare global {
  interface Window { graphicsProbe: GraphicsProbe }
}

for (const renderer of ['canvas', 'webgl'] as const) {
  test(`${renderer}: restore real WebGL contexts during the same battle`, async ({page}, info) => {
    test.setTimeout(120000);
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.addInitScript(() => {
      for (const prefix of ['', 'starfall.web-test:']) {
        localStorage.setItem(prefix + 'starfall.monster-defense.progress/2/default/all-unlocked', '1');
      }
      const probe: GraphicsProbe = window.graphicsProbe = {starts:0, frame:0, clicks:0, heroes:[],
        contexts:new Map(), draws:new Map(), extensions:[], awaitingPixels:new Set(), paintedPixels:new Set()};
      function recordPixels(canvas: HTMLCanvasElement, gl: WebGLRenderingContext | WebGL2RenderingContext): void {
        if (!probe.awaitingPixels.has(canvas) || gl.isContextLost() || gl.getParameter(gl.FRAMEBUFFER_BINDING)) return;
        const {drawingBufferWidth:width, drawingBufferHeight:height} = gl;
        const pixels = new Uint8Array(width * height * 4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        for (let alpha = 3; alpha < pixels.length; alpha += 4) {
          if (!pixels[alpha]) continue;
          probe.awaitingPixels.delete(canvas);
          probe.paintedPixels.add(canvas);
          break;
        }
      }
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, options?: unknown) {
        const context = getContext.call(this, type, options);
        if (context instanceof WebGLRenderingContext || context instanceof WebGL2RenderingContext) probe.contexts.set(this, context);
        return context;
      } as typeof getContext;
      const drawImage = CanvasRenderingContext2D.prototype.drawImage as
        (this: CanvasRenderingContext2D, image: CanvasImageSource, ...coordinates: number[]) => void;
      CanvasRenderingContext2D.prototype.drawImage = function (image, ...coordinates: number[]) {
        drawImage.call(this, image, ...coordinates);
        if (this.canvas.getAttribute('aria-label') === '战场画面' && image instanceof HTMLCanvasElement) {
          const gl = probe.contexts.get(image);
          if (gl) {
            probe.effects = image;
            // Read the actual effect surface just copied to the visible Canvas.
            recordPixels(image, gl);
          }
        }
      };
      for (const prototype of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
        const { drawArrays, drawElements } = prototype;
        function count(gl: WebGLRenderingContext | WebGL2RenderingContext): void {
          const canvas = gl.canvas;
          if (canvas instanceof HTMLCanvasElement && !gl.isContextLost()) {
            probe.draws.set(canvas, (probe.draws.get(canvas) ?? 0) + 1);
            // Phaser need not preserve its drawing buffer after this task.
            if (canvas !== probe.effects) recordPixels(canvas, gl);
          }
        }
        prototype.drawArrays = function (this: WebGLRenderingContext, ...args) { drawArrays.apply(this, args); count(this); };
        prototype.drawElements = function (this: WebGLRenderingContext, ...args) { drawElements.apply(this, args); count(this); };
      }
      const Base = window.Worker;
      window.Worker = class extends Base {
        override postMessage(message: UiClientRequest, options?: StructuredSerializeOptions | Transferable[]) {
          if (message.type === 'click') probe.clicks++;
          super.postMessage(message, options as StructuredSerializeOptions);
        }
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options);
          this.addEventListener('message', ({data}: MessageEvent<UiHostMessage>) => {
            if (data.type !== 'event') return;
            const event = data.event;
            if (event.name === 'start-battle') {
              probe.starts++;
              probe.frame = 0;
            }
            if (event.name !== 'world') return;
            probe.frame = event.state.fixedFrame;
            probe.heroes = [...new Set(event.state.units
              .filter(u => u.cardId >= 78000101 && u.cardId <= 78000105).map(u => u.cardId))].sort();
          });
        }
      };
    });

    const save = () => page.evaluate(() => Object.keys(localStorage).filter(k => k.includes('progress')).sort()
      .map(k => [k, localStorage.getItem(k)]));
    const battle = page.getByRole('region', {name:'魔物抵御战战场'});
    const surface = page.getByLabel('战场画面');
    const observe = () => page.evaluate(() => {
      const probe = window.graphicsProbe;
      const world = document.querySelector<HTMLCanvasElement>('canvas[aria-label="战场画面"]');
      const hud = document.querySelector<HTMLCanvasElement>('section.screen canvas');
      const effects = world?.dataset['renderer'] === 'webgl' ? world : probe.effects;
      return {at:performance.now(), frame:probe.frame, starts:probe.starts, clicks:probe.clicks, heroes:probe.heroes,
        effects:effects && (probe.draws.get(effects) ?? 0), hud:hud && (probe.draws.get(hud) ?? 0),
        pixels: {effects:!!effects && probe.paintedPixels.has(effects), hud:!!hud && probe.paintedPixels.has(hud)},
        fatal:document.querySelector('.fatal-panel')?.textContent};
    });
    await page.goto(renderer === 'webgl' ? './?world=webgl' : './');
    await openChooser(page);
    const beforeSave = await save();
    expect(beforeSave.some(([, value]) => value === '1')).toBe(true);
    await page.getByRole('button', {name:'网页设置'}).click();
    await page.getByRole('button', {name:'压测', exact:true}).click();
    await page.getByLabel('压测渲染方式').selectOption(renderer);
    await page.getByRole('button', {name:'开始怪海压测'}).click();
    await expect(battle).toBeVisible({timeout:45000});
    await expect(surface).toHaveAttribute('data-renderer', renderer);
    await expect.poll(async () => (await observe()).effects ?? 0, {timeout:25000}).toBeGreaterThan(0);
    await expect.poll(async () => (await observe()).hud ?? 0).toBeGreaterThan(0);
    await expect.poll(async () => (await observe()).heroes.length).toBe(5);
    await expect.poll(async () => (await observe()).frame, {timeout:20000}).toBeGreaterThan(125);
    await expect(page.locator('.stress-live')).toBeVisible();
    const before = await observe();

    const lost = await page.evaluate(async () => {
      const probe = window.graphicsProbe;
      const world = document.querySelector<HTMLCanvasElement>('canvas[aria-label="战场画面"]')!;
      const hud = document.querySelector<HTMLCanvasElement>('section.screen canvas')!;
      const effects = world.dataset['renderer'] === 'webgl' ? world : probe.effects!;
      return Promise.all([effects,hud].map(canvas => {
        const gl = probe.contexts.get(canvas)!;
        const extension = gl.getExtension('WEBGL_lose_context')!;
        if (!extension) throw new Error('WEBGL_lose_context is unavailable');
        probe.extensions.push(extension);
        return new Promise<boolean>(resolve => {
          canvas.addEventListener('webglcontextlost', event => resolve(event.defaultPrevented && gl.isContextLost()), {once:true});
          extension.loseContext();
        });
      }));
    });
    const afterLoss = await observe();
    await info.attach('after-context-loss', {body:JSON.stringify({lost, before, afterLoss}), contentType:'application/json'});
    await expect.poll(async () => {
      const state = await observe();
      return {continued:state.frame > afterLoss.frame + 25, enoughTime:state.at - afterLoss.at >= 2100,
        fatal:state.fatal ?? null};
    }, {timeout:10000, message:'The same battle should advance while the rendering contexts are lost'})
      .toEqual({continued:true, enoughTime:true, fatal:null});
    await expect(battle).toBeVisible();
    expect(lost).toEqual([true, true]);
    const waiting = await observe();

    const wasCleared = await page.evaluate(() => {
      const probe = window.graphicsProbe;
      const world = document.querySelector<HTMLCanvasElement>('canvas[aria-label="战场画面"]')!;
      const hud = document.querySelector<HTMLCanvasElement>('section.screen canvas')!;
      const effects = world.dataset['renderer'] === 'webgl' ? world : probe.effects!;
      let cleared = true;
      if (world !== effects) {
        const context = world.getContext('2d')!;
        context.clearRect(0, 0, world.width, world.height);
        cleared = context.getImageData(Math.floor(world.width / 2), Math.floor(world.height / 2), 1, 1).data[3] === 0;
      }
      probe.awaitingPixels.add(effects);
      probe.awaitingPixels.add(hud);
      for (const extension of probe.extensions) extension.restoreContext();
      return cleared;
    });
    expect(wasCleared).toBe(true);
    await expect.poll(async () => (await observe()).effects ?? 0, {timeout:20000}).toBeGreaterThan(waiting.effects!);
    await expect.poll(async () => (await observe()).hud ?? 0).toBeGreaterThan(waiting.hud!);
    await expect.poll(async () => (await observe()).pixels, {timeout:20000}).toEqual({effects:true, hud:true});
    await expect.poll(() => surface.evaluate((canvas: HTMLCanvasElement) => {
      const gl = window.graphicsProbe.contexts.get(canvas);
      const x = Math.floor(canvas.width / 2), y = Math.floor(canvas.height / 2);
      if (!gl) return (canvas.getContext('2d')!.getImageData(x, y, 1, 1).data[3] ?? 0) > 0;
      const pixel = new Uint8Array(4);
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return !gl.isContextLost() && pixel[3]! > 0;
    })).toBe(true);
    expect((await observe()).frame).toBeGreaterThan(before.frame);
    expect((await observe()).heroes).toEqual(before.heroes);
    expect((await observe()).starts).toBe(1);

    await page.getByRole('button', {name:'网页设置'}).click();
    await page.getByRole('button', {name:'压测', exact:true}).click();
    const report = page.getByRole('region', {name:'压测统计'});
    await expect(report.getByText('最差一秒', {exact:true}).locator('..').locator('dd')).toHaveText('0 FPS');
    await page.getByRole('button', {name:'关闭', exact:true}).click();

    const exit = page.getByRole('region', {name:'确认退出战斗'});
    const clicks = (await observe()).clicks;
    await expect(async () => {
      if ((await observe()).clicks === clicks) await originalClick(page, 79, 47);
      expect((await observe()).clicks).toBe(clicks + 1);
    }).toPass({timeout:15000});
    await expect(exit).toBeVisible({timeout:20000});
    await originalClick(page, 977, 575);
    await expect(page.getByRole('region', {name:'选择关卡'})).toBeVisible({timeout:15000});
    expect(await save()).toEqual(beforeSave);

    await originalClick(page, 145, 274);
    await expect(battle).toBeVisible({timeout:45000});
    await expect(surface).toHaveAttribute('data-renderer', renderer);
    await expect.poll(async () => (await observe()).starts).toBe(2);
    await expect.poll(async () => (await observe()).frame).toBeGreaterThan(10);
    expect(await save()).toEqual(beforeSave);
    expect(pageErrors).toEqual([]);
  });
}

import { writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { UiHostMessage, UiTreeNode } from '../../runtime/ui/protocol';
import type { FguiPackage } from '../../src/fgui/package';
import { openChooser, originalClick } from './navigation';

interface Card { id: number; nameId?: number; name?: string; revealed: boolean }
interface Evidence {
  frame: number;
  level: number;
  choiceCount: number;
  list: number | undefined;
  cards: Card[];
  textures: { boulder: string; smoke: string };
  draws: { frame: number; x: number; age: number; angle: number; pixels: number }[];
  motion: { frame: number; x: number; y: number; age: number }[];
  smokeDraws: number;
  loadingPixels: number;
  issues: string[];
}

test('Dina draws the original rolling boulder after selecting 崩山巨岩', async ({ page }) => {
  test.setTimeout(160000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const manifest = await (await page.request.get('./assets/effects/mesh-effects.json')).json();
  const texture = (name: string) => (Object.values(manifest.textures) as { name: string; url: string }[])
    .find((item) => item.name === name)!.url;
  const textures = { boulder: texture('Minigame022_yunshi'), smoke: texture('hym_zj_smoke_005') };
  const loads: { path: string; status: number; type: string | undefined }[] = [];
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (Object.values(textures).some((file) => path.endsWith(file))) {
      loads.push({ path, status: response.status(), type: response.headers()['content-type'] });
    }
  });
  await page.addInitScript(({ boulder, smoke }) => {
    const evidence: Evidence = { frame: 0, level: 0, list: undefined, cards: [], choiceCount: 0, draws: [], motion: [],
      smokeDraws: 0, loadingPixels: 0,
      textures: { boulder, smoke }, issues: [] };
    Object.assign(window, { effectEvidence: evidence });
    const originalDrawImage = CanvasRenderingContext2D.prototype.drawImage;
    let loadingFrames = 0;
    CanvasRenderingContext2D.prototype.drawImage = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
      Reflect.apply(originalDrawImage, this, args);
      if (!this.canvas.classList.contains('loading-art') || ++loadingFrames % 4 !== 0 || evidence.loadingPixels > 100) return;
      const pixels = this.getImageData(0, 0, this.canvas.width, this.canvas.height).data;
      let visible = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3]! > 15 && Math.max(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!) > 12) visible++;
      }
      evidence.loadingPixels = Math.max(evidence.loadingPixels, visible);
    } as typeof originalDrawImage;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('message', ({ data }: MessageEvent<UiHostMessage>) => {
          if (data.type === 'error') evidence.issues.push(data.message);
          if (data.type === 'open' && data.window === 'MiniGameSkillChoiceWindow') {
            evidence.list = data.tree.children.find(({ name }) => name === 'Main')?.children.find(({ name }) => name === 'TipsList')?.id;
            evidence.cards = [];
            evidence.choiceCount++;
          }
          if (data.type === 'close' && data.window === 'MiniGameSkillChoiceWindow') {
            evidence.list = undefined;
            evidence.cards = [];
          }
          if (data.type === 'ops') for (const op of data.ops) {
            if (op.op === 'list-clear' && op.id === evidence.list) evidence.cards = [];
            if (op.op === 'list-add' && op.id === evidence.list) {
              const tips = op.item.children.find(({ name }: UiTreeNode) => name === 'Tips');
              const name = tips?.children.find((node) => node.name === 'NameTxt');
              evidence.cards.push({ id: op.item.id, ...(name ? { nameId: name.id } : {}), revealed: false });
            }
            if (op.op === 'set' && op.key === 'text') {
              const card = evidence.cards.find((item) => item.nameId === op.id);
              if (card) card.name = String(op.value);
            }
            if (op.op === 'transition-play' && op.name === 'up') {
              const card = evidence.cards.find((item) => item.id === op.id);
              if (card) card.revealed = true;
            }
          }
          if (data.type === 'event' && data.event.name === 'world') {
            const state = data.event.state;
            evidence.frame = state.fixedFrame;
            evidence.level = state.curLevel ?? 0;
            const model = state.bullets?.find((bullet) => bullet.path.endsWith('10000134_skill3_bullet.prefab'));
            if (model && !evidence.motion.some(({ frame }) => frame === state.fixedFrame)) {
              evidence.motion.push({ frame: state.fixedFrame, x: model.position.x, y: model.position.y, age: model.age ?? -1 });
            }
          }
        });
      }
    };
    const textureUrls = new WeakMap<WebGLTexture, string>();
    const prototype = WebGLRenderingContext.prototype;
    const upload = prototype.texImage2D;
    prototype.texImage2D = function (this: WebGLRenderingContext, ...args: unknown[]) {
      Reflect.apply(upload, this, args);
      const source = args.at(-1);
      const texture = this.getParameter(this.TEXTURE_BINDING_2D) as WebGLTexture | null;
      if (texture && source instanceof HTMLImageElement) textureUrls.set(texture, source.src);
    } as typeof upload;
    const draw = prototype.drawElements;
    prototype.drawElements = function (...args) {
      draw.apply(this, args);
      if (!evidence.motion.length) return;
      const program = this.getParameter(this.CURRENT_PROGRAM) as WebGLProgram | null;
      const uniform = program && this.getUniformLocation(program, '_MainTex');
      if (!uniform) return;
      const active = Number(this.getParameter(this.ACTIVE_TEXTURE));
      this.activeTexture(this.TEXTURE0 + Number(this.getUniform(program, uniform)));
      const texture = this.getParameter(this.TEXTURE_BINDING_2D) as WebGLTexture | null;
      this.activeTexture(active);
      const path = texture && textureUrls.get(texture);
      if (path && path.endsWith(smoke)) evidence.smokeDraws++;
      const motion = evidence.motion.at(-1)!;
      if (!path || !path.endsWith(boulder) || evidence.draws.length >= 40
        || evidence.draws.some(({ frame }) => frame === evidence.frame) || (motion.age > 0 && evidence.frame % 3 !== 0)) return;
      const matrix = this.getUniformLocation(program, 'hlslcc_mtx4x4unity_ObjectToWorld[0]');
      const values = matrix && this.getUniform(program, matrix) as Float32Array | null;
      if (!values) return;
      const rgba = new Uint8Array(this.drawingBufferWidth * this.drawingBufferHeight * 4);
      this.readPixels(0, 0, this.drawingBufferWidth, this.drawingBufferHeight, this.RGBA, this.UNSIGNED_BYTE, rgba);
      let pixels = 0;
      for (let i = 3; i < rgba.length; i += 4) if (rgba[i]! > 15) pixels++;
      evidence.draws.push({ frame: evidence.frame, x: motion.x, age: motion.age,
        angle: Math.atan2(values[1]!, values[0]!), pixels });
    };
  }, textures);

  const observed = () => page.evaluate(() =>
    (window as Window & { effectEvidence?: Evidence }).effectEvidence!);
  await page.goto('./');
  const choicePackage: FguiPackage = await (await page.request.get('./assets/fgui/ActivityDungeon1017Battle.json')).json();
  const list = choicePackage.components[choicePackage.componentIndex['SkillChoice']!]!.children!.find(({ name }) => name === 'TipsList')!;
  const item = choicePackage.components[list.defaultItem!.slice(13)]!;
  await openChooser(page);
  await originalClick(page, 145, 274);
  await expect.poll(async () => (await observed()).frame, { timeout: 40000 }).toBeGreaterThan(0);
  let selected = false;
  const picks: string[] = [];
  for (let i = 0; i < 18 && !selected; i++) {
    if (!(await observed()).list) {
      await page.getByRole('button', { name: '网页设置' }).click();
      await page.getByRole('button', { name: '调试', exact: true }).click();
      await page.getByRole('button', { name: '升一级', exact: true }).click();
    }
    await expect.poll(async () => {
      const { cards } = await observed();
      return cards.length > 0 && cards.every((card) => card.name && card.revealed);
    }, { timeout: 15000 }).toBe(true);
    const { cards } = await observed();
    const boulderIndex = cards.findIndex(({ name }) => name === '崩山巨岩');
    const preferred = boulderIndex !== -1 ? boulderIndex : cards.findIndex(({ name }) => name === '剑气毒泽');
    const choice = preferred < 0 ? 0 : preferred;
    const gap = list.columnGap ?? 0;
    const content = cards.length * item.width + (cards.length - 1) * gap;
    const x = list.x! + Math.floor((list.width! - content) / 2) + item.width / 2 + choice * (item.width + gap);
    await originalClick(page, x, list.y! + item.height / 2);
    await originalClick(page, 667, 654);
    picks.push(cards[choice]!.name!);
    selected = boulderIndex !== -1;
    await expect.poll(async () => (await observed()).list).toBeUndefined();
  }
  expect(selected, picks.join(', ')).toBe(true);
  await expect.poll(async () => {
    const { draws, motion, smokeDraws } = await observed();
    const late = draws.filter(({ age, pixels }) => age >= 1.2 && pixels > 100);
    return new Set(late.map(({ angle }) => angle)).size > 3 && motion.length > 15 && smokeDraws > 5;
  }, { timeout: 35000 }).toBe(true);
  await page.screenshot({ path: test.info().outputPath('dina-boulder.png') });
  const state = await observed();
  expect(state.motion[10]!.x).toBeGreaterThan(state.motion[0]!.x);
  expect(state.motion[10]!.y).toBe(state.motion[0]!.y);
  expect(state.loadingPixels).toBeGreaterThan(100);
  expect(state.issues).toEqual([]);
  expect(errors).toEqual([]);
  for (const file of Object.values(textures)) {
    expect(loads.some(({ path, status, type }) => path.endsWith(file) && status === 200 && type?.startsWith('image/png'))).toBe(true);
  }
  writeFileSync(test.info().outputPath('dina-boulder-evidence.json'), JSON.stringify({ picks, loads, ...state }, null, 2));
});

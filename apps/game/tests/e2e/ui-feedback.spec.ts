import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { openFixture } from './fixture';
import { openChooser, originalClick } from './navigation';

async function screenshot(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  await page.screenshot({ path: info.outputPath(name) });
}

test('skill previews retain the original words and show one percent sign', async ({ page }, info) => {
  await page.addInitScript(() => {
    const observed: string[] = [];
    Object.assign(window, { previewWords: observed });
    const NativeWorker = Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('message', ({ data }) => {
          if (data.type !== 'ops') return;
          for (const op of data.ops) {
            if (op.op === 'set' && op.key === 'text' && typeof op.value === 'string') observed.push(op.value);
          }
        });
      }
    };
  });
  await page.goto('./');
  await openChooser(page);
  await originalClick(page, 71, 681);
  const previewWords = () => page.evaluate(() => (window as unknown as { previewWords: string[] }).previewWords);
  await expect.poll(previewWords).toContain('[color=#e6ff51]安妮斯[/color]');
  await screenshot(page, info, 'unlocked-preview.png');
  const words = await previewWords();
  expect.soft(words).toContain('发射一道水波，对魔物造成100%当前攻击力的伤害。');
  expect.soft(words).toContain('安妮斯基础攻击力+30%。');
  expect.soft(words).toContain('水波命中魔物，会使魔物基础移动速度降低50%，持续10秒，最大可以叠加1层。');
  await originalClick(page, 1133, 78);
  await expect(page.getByRole('region', { name: '选择关卡', exact: true })).toBeVisible();
  await originalClick(page, 231, 681);
  await expect.poll(previewWords).toContainEqual(expect.stringMatching(/^第\d+关解锁\[color=#e6ff51\]/));
  await screenshot(page, info, 'locked-preview.png');
});

test('the original description fields wrap Chinese and resize their following content', async ({ page }) => {
  await page.goto('./');
  const result = await page.evaluate(async () => {
    const { FguiRuntime } = await import(/* @vite-ignore */ new URL('assets/fgui-probe.js', document.baseURI).href);
    const host = document.createElement('div');
    document.body.append(host);
    const runtime = new FguiRuntime(host, () => {});
    const description = '召唤一片半径为40的圆形冰冻区域，对区域内的魔物造成300%当前攻击力的伤害，并使受到攻击的敌方目标陷入冰冻状态，持续5秒。';
    await runtime.show('ActivityDungeon1017Battle', 'SkillChoice_Word');
    runtime.setText('WordTxt', description);
    const battle = runtime.find('WordTxt').content.getWrappedText();
    await runtime.show('ActivityDungeon1017', 'MiniGameChoice2_CardInfo1');
    const originalSeparation = runtime.find('n3').y - runtime.find('WordTxt').height;
    runtime.setText('WordTxt', description);
    const previewText = runtime.find('WordTxt');
    const preview = previewText.content.getWrappedText();
    const newSeparation = runtime.find('n3').y - previewText.height;
    const followsResizedText = runtime.find('n3').y !== 117;
    const percentageText = '发射一束冲击波，每秒对冲击波覆盖区域的魔物造成1600%当前攻击力的持续伤害，持续3秒。';
    runtime.setText('WordTxt', percentageText);
    const percentageLines = previewText.content.getWrappedText();
    runtime.dispose();
    return { description, battle, preview, originalSeparation, newSeparation, followsResizedText, percentageLines, percentageText };
  });
  for (const lines of [result.battle, result.preview]) {
    expect.soft(lines.length).toBeGreaterThan(3);
    expect.soft(lines.join('')).toBe(result.description);
  }
  expect.soft(result.newSeparation).toBe(result.originalSeparation);
  expect.soft(result.followsResizedText).toBe(true);
  expect.soft(result.percentageLines.join('')).toBe(result.percentageText);
  expect.soft(result.percentageLines).toContainEqual(expect.stringContaining('1600%'));
});

test('a real upgrade portrait is clipped by the scaled original rectangle on each URL change', async ({ page }) => {
  await page.goto('./');
  const result = await page.evaluate(async () => {
    const { FguiRuntime, PackageRegistry } = await import(/* @vite-ignore */ new URL('assets/fgui-probe.js', document.baseURI).href);
    const registry = await PackageRegistry.load();
    const pkg = 'ActivityDungeon1017Battle';
    const host = document.createElement('div');
    document.body.append(host);
    const runtime = new FguiRuntime(host, () => {});
    await runtime.show(pkg, 'SkillChoice_Card');
    const path = 'PartsCardBg/PicLoader';
    const mask = runtime.find('PartsCardBg/n3');
    const bounds = [mask.container.x, mask.container.y, mask.width * mask.container.scaleX, mask.height * mask.container.scaleY];
    const actual = ['B_10018', 'B_10034'].map((name) => {
      const item = registry.item(name, pkg);
      runtime.setUrl(path, `ui://${registry.package(pkg).package.id}${item.id}`);
      const loader = runtime.find(path);
      const image = loader.content;
      const crop = image._crop;
      const scaleX = loader.container.scaleX * image.scaleX;
      const scaleY = loader.container.scaleY * image.scaleY;
      const imageX = loader.container.x + image.x * loader.container.scaleX;
      const imageY = loader.container.y + image.y * loader.container.scaleY;
      const left = Math.max(bounds[0], imageX);
      const top = Math.max(bounds[1], imageY);
      const right = Math.min(bounds[0] + bounds[2], imageX + image.width * scaleX);
      const bottom = Math.min(bounds[1] + bounds[3], imageY + image.height * scaleY);
      return {
        crop: image.isCropped,
        bounds: [imageX + crop.x * scaleX, imageY + crop.y * scaleY, crop.width * scaleX, crop.height * scaleY],
        intersection: [left, top, right - left, bottom - top],
      };
    });
    const maskVisible = mask.container.visible;
    runtime.dispose();
    return { actual, maskVisible };
  });
  expect.soft(result.maskVisible).toBe(false);
  for (const portrait of result.actual) {
    expect.soft(portrait.crop).toBe(true);
    portrait.intersection.forEach((expected, i) => expect.soft(portrait.bounds[i]).toBeCloseTo(expected, 3));
  }
});

test('ordinary play draws the cropped character in the original upgrade window', async ({ page }, info) => {
  test.setTimeout(60000);
  await page.goto('./');
  await openChooser(page);
  await originalClick(page, 145, 274);
  const upgrade = page.getByRole('region', { name: '选择强化', exact: true });
  await expect(upgrade).toBeVisible({ timeout: 40000 });
  await page.waitForTimeout(650);
  await screenshot(page, info, 'battle-upgrade-cards.png');
  await originalClick(page, 365, 340);
  await originalClick(page, 667, 654);
  await expect(upgrade).toBeHidden();
});

test('the preview footer uses its original centered anchor and moving right decoration', async ({ page }) => {
  await page.goto('./');
  const result = await page.evaluate(async () => {
    const { FguiRuntime } = await import(/* @vite-ignore */ new URL('assets/fgui-probe.js', document.baseURI).href);
    const host = document.createElement('div');
    document.body.append(host);
    const runtime = new FguiRuntime(host, () => {});
    await runtime.show('ActivityDungeon1017', 'MiniGameChoice2_InfoRegion');
    const lock = runtime.find('Lock');
    const text = runtime.find('Lock/WordTxt');
    const end = runtime.find('Lock/n1');
    const separation = end.x - text.x - text.width;
    const outcomes = ['[color=#e6ff51]安妮斯[/color]', '第4关解锁[color=#e6ff51]艾莉亚[/color]'].map((value) => {
      runtime.setText('Lock/WordTxt', value);
      return { width: lock.width, groupCenter: lock.container.x + (end.x + end.width) / 2, rightGap: end.x - text.x - text.width };
    });
    const center = lock.x;
    runtime.dispose();
    return { outcomes, center, separation };
  });
  expect.soft(result.outcomes[1]?.width).toBeGreaterThan(result.outcomes[0]!.width);
  for (const outcome of result.outcomes) {
    expect.soft(outcome.groupCenter).toBeCloseTo(result.center);
    expect.soft(outcome.rightGap).toBeCloseTo(result.separation);
  }
});

test('the last descriptions are reachable in every original roster preview', async ({ page }, info) => {
  test.setTimeout(60000);
  await openFixture(page);
  await page.addStyleTag({ content: '@font-face{font-family:SourceHanSans;src:url("./assets/fonts/source-han-sans.otf")}' });
  const count = await page.evaluate(async () => {
    await document.fonts.load('18px SourceHanSans');
    const { OriginalUiClient, OriginalUiWindow } = await import(/* @vite-ignore */ new URL('assets/ui-client.js', document.baseURI).href);
    const view = new OriginalUiWindow(document.querySelector('#app'), new OriginalUiClient(), () => {}, (error: Error) => { throw error; });
    Object.assign(window, { previewView: view });
    await view.init({ activityStartStamp: 1700000000, serverNowStamp: 1764000000, gameplay: true });
    return view.runtime.find('Main/StartBtn').source.clickHandlerCount;
  });
  expect(count).toBeGreaterThan(0);
  await originalClick(page, 1147, 679);
  const rosterCount = () => page.evaluate(() => (window as any).previewView.runtime.views.get('Activity17MiniGameChoice2Window')?.nodes.get('Main/CardRegion/HeadList')?.list?.items.length ?? 0);
  await expect.poll(rosterCount).toBe(5);
  const previews = [];
  for (let i = 0; i < 5; i++) {
    await originalClick(page, 71 + i * 80, 681);
    const inspect = () => page.evaluate(() => {
      const nodes = (window as any).previewView.runtime.views.get('Activity17MiniGameChoice2_InfoSkillWindow')?.nodes;
      const footer = nodes?.get('Main/Info/Lock/WordTxt')?.content.text;
      if (!footer) return null;
      const columns = [0, 1, 2].map((index) => {
        const card = nodes.get(`Main/Info/InfoList/item${index}`);
        const viewport = card?.children.get('InfoList');
        const summary = viewport?.list?.items[0];
        const details = summary?.children.get('InfoList').list.items;
        const last = details?.at(-1)?.children.get('WordTxt');
        if (!last?.content.text) return null;
        const bottom = (node: any) => node.container.getWorldTransformMatrix().transformPoint(0, node.height).y;
        return { skill: card.children.get('NameTxt').content.text, last: last.content.text, gap: bottom(viewport) - bottom(last), scrollY: viewport.list.scrollY };
      });
      return columns.every(Boolean) ? { footer, columns } : null;
    });
    await expect.poll(inspect).not.toBeNull();
    const preview = (await inspect())!;
    await screenshot(page, info, `preview-${i + 1}.png`);
    const scrolled = [];
    for (const [index, column] of preview.columns.entries()) {
      if (column!.gap >= 0) continue;
      await page.mouse.move(366 + index * 295, 420);
      await page.mouse.wheel(0, 620);
      await expect.poll(async () => (await inspect())!.columns[index]!.scrollY).toBeLessThan(0);
      const visible = (await inspect())!.columns[index]!;
      expect.soft(visible.gap, `${preview.footer} ${visible.skill}`).toBeGreaterThanOrEqual(0);
      scrolled.push(visible);
      await screenshot(page, info, `preview-${i + 1}-scrolled-${index + 1}.png`);
    }
    previews.push({ ...preview, scrolled });
    await originalClick(page, 1133, 78);
    await expect.poll(inspect).toBeNull();
  }
  writeFileSync(info.outputPath('preview-layouts.json'), JSON.stringify(previews, null, 2));
});

test('dragging the real chooser shifts the stage route without starting a stage', async ({ page }, info) => {
  await page.goto('./');
  await openChooser(page);
  await page.mouse.move(525, 274);
  await page.mouse.down();
  await page.mouse.move(145, 274, { steps: 16 });
  await page.mouse.up();
  await expect(page.getByRole('region', { name: '选择关卡', exact: true })).toBeVisible();
  await expect(page.locator('.game-notice')).toHaveText('');
  await originalClick(page, 145, 274);
  await expect(page.getByRole('status')).toHaveText('前置关卡未通过', { timeout: 3000 });
  await screenshot(page, info, 'stage-route-after-drag.png');
});

test('the stage route connector and transparent corners never activate a sign', async ({ page }, info) => {
  await page.goto('./');
  await openChooser(page);
  for (const [x, y] of [[145, 369], [145, 340], [65, 340], [335, 367], [335, 405]] as const) {
    await originalClick(page, x, y);
  }
  await expect(page.getByRole('region', { name: '选择关卡', exact: true })).toBeVisible();
  await expect(page.locator('.game-notice')).toHaveText('');
  await originalClick(page, 525, 274);
  await expect(page.getByRole('status')).toHaveText('前置关卡未通过');
  await screenshot(page, info, 'stage-route-select-sign.png');
});

test.describe('mobile touch input', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('a finger drag scrolls the route on the rotated phone canvas', async ({ page }, info) => {
    await page.goto('./');
    await openChooser(page, 'touch');
    const canvas = await page.locator('#app canvas:visible').last().boundingBox();
    if (!canvas) throw new Error('Missing chooser canvas');
    const cdp = await page.context().newCDPSession(page);
    const at = (x: number) => ({ x: canvas.x + canvas.width * (1 - 274 / 750), y: canvas.y + canvas.height * x / 1334 });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at(525)] });
    for (let x = 501; x > 145; x -= 24) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [at(x)] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [at(145)] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.getByRole('region', { name: '选择关卡', exact: true })).toBeVisible();
    await expect(page.locator('.game-notice')).toHaveText('');
    await originalClick(page, 145, 274, 'touch');
    await expect(page.getByRole('status')).toHaveText('前置关卡未通过');
    await screenshot(page, info, 'stage-route-after-touch.png');
  });
});

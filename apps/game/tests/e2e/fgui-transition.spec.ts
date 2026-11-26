import { expect, test } from '@playwright/test';
import type { UiTreeNode } from '../../runtime/ui/protocol';
import type { FguiChild, PackageRegistry as FguiPackageRegistry } from '../../src/fgui/package';

test('original battle opening runs nested tracks and reports Sign once before completion', async ({ page }) => {
  await page.goto('./');
  const result = await page.evaluate(async () => {
    const { FguiRuntime, PackageRegistry } = await import(/* @vite-ignore */ new URL('assets/fgui-probe.js', document.baseURI).href);
    const parent = document.createElement('div');
    parent.style.cssText = 'position:fixed;inset:0;z-index:100';
    document.body.append(parent);
    const runtime = new FguiRuntime(parent, () => {});
    const registry: FguiPackageRegistry = await PackageRegistry.load();
    const pkg = registry.package('ActivityDungeon1017Battle');
    let id = 0;
    const build = (source: FguiChild, packageId: string): UiTreeNode => {
      packageId = source.packageId ?? packageId;
      const componentId = source.src ?? (source.children ? String(source.id) : '');
      const definition = registry.packageById(packageId).components[componentId];
      return {
        id: ++id, name: source.name, type: source.type ?? source.objectType,
        objectType: source.objectType, packageId, componentId,
        x: source.x ?? 0, y: source.y ?? 0,
        width: source.width ?? definition?.width ?? 0, height: source.height ?? definition?.height ?? 0,
        visible: source.visible ?? true, touchable: source.touchable ?? true,
        controllers: Object.fromEntries((definition?.controllers ?? []).map((c) => [c.name, { pages: c.pages, selected: 0 }])),
        children: (definition?.children ?? []).map((child) => build(child, packageId)),
        ...(definition?.transitions ? { transitions: definition.transitions } : {}),
        clickHandlerCount: 0, source,
      };
    };
    const hud = build(registry.component('BattleUIWindow', pkg.package.name), pkg.package.id);
    await runtime.showTree('battle-test', hud);
    const hudMain = hud.children[0]!;
    const banner = build(registry.component('BattleStart', pkg.package.name), pkg.package.id);
    runtime.addChild(hud.id, banner);
    const events: string[] = [];
    runtime.playTransition(banner.id, 'in', {
      onLabel: (name: string) => events.push(name),
      onComplete: () => events.push('banner-complete'),
    });
    const graph = runtime.find('BattleStart/BattleStartBg/n33');
    const background = runtime.find('BattleStart/BattleStartBg/n31');
    const title = runtime.find('BattleStart/NameTxt');
    const initial = { alpha: title.container.alpha, height: graph.height, backgroundVisible: background.content.visible };
    runtime.updateTransitions(150);
    const expanded = {
      height: graph.height, top: graph.y,
      titleAlpha: title.container.alpha, backgroundAlpha: background.container.alpha,
      backgroundCropped: background.content.isCropped, maskVisible: graph.container.visible,
    };
    runtime.setPaused(true);
    runtime.updateTransitions(2000);
    const frozen = { height: graph.height, events: [...events] };
    runtime.setPaused(false);
    runtime.updateTransitions(1200);
    const beforeSign = [...events];
    runtime.updateTransitions(100);
    runtime.removeChild(banner.id);
    const removed = !graph.container.scene;
    runtime.playTransition(hudMain.id, 'up', { onComplete: () => events.push('hud-complete') });
    const top = runtime.find('Main/Top');
    const slideStart = { y: top.y, alpha: top.container.alpha };
    runtime.updateTransitions(150);
    const slideMid = { y: top.y, alpha: top.container.alpha };
    runtime.updateTransitions(200);
    const slideEnd = { y: top.y, alpha: top.container.alpha };
    const damage = build(registry.component('NormalHitNumberTips', pkg.package.name), pkg.package.id);
    runtime.addChild(hud.id, damage);
    const numberPath = 'NormalHitNumberTips/NormalHitNumber/NumberTxt';
    runtime.setText(numberPath, 219);
    const numberFrames = runtime.find(numberPath).content.list.map((glyph: { frame: { name: string } }) => glyph.frame.name);
    runtime.setTransitionTimeScale(0);
    runtime.playTransition(damage.id, 'in', { scaled: true, onComplete: () => events.push('damage-complete') });
    const damageMotion = runtime.find('NormalHitNumberTips/NormalHitNumber');
    const damageStart = damageMotion.y;
    runtime.playTransition(hudMain.id, 'up', { onComplete: () => events.push('independent-complete') });
    runtime.updateTransitions(400);
    const damagePaused = damageMotion.y;
    const pausedEvents = [...events];
    runtime.setTransitionTimeScale(2);
    runtime.updateTransitions(400);
    const damageEnd = damageMotion.y;
    runtime.playTransition(hudMain.id, 'up', { onComplete: () => events.push('stale') });
    runtime.close('battle-test');
    runtime.updateTransitions(1000);
    runtime.dispose();
    return { initial, expanded, frozen, beforeSign, removed, slideStart, slideMid, slideEnd, numberFrames, damageStart, damagePaused, damageEnd, pausedEvents, events };
  });

  expect(result.initial).toEqual({ alpha: 0, height: 0, backgroundVisible: false });
  expect(result.expanded.height).toBeCloseTo(120);
  expect(result.expanded.top).toBeCloseTo(20);
  expect(result.expanded.titleAlpha).toBeGreaterThan(0);
  expect(result.expanded.backgroundAlpha).toBeCloseTo(0.84);
  expect(result.expanded.backgroundCropped).toBe(true);
  expect(result.expanded.maskVisible).toBe(false);
  expect(result.frozen.height).toBe(result.expanded.height);
  expect(result.frozen.events).toEqual([]);
  expect(result.beforeSign).toEqual([]);
  expect(result.removed).toBe(true);
  expect(result.slideStart).toEqual({ y: -100, alpha: 0 });
  expect(result.slideMid.y).toBeCloseTo(-25);
  expect(result.slideMid.alpha).toBeCloseTo(0.75);
  expect(result.slideEnd).toEqual({ y: 0, alpha: 1 });
  expect(result.numberFrames).toEqual(['gevl1q', 'gevl1p', 'gevl1x']);
  expect(result.damagePaused).toBe(result.damageStart);
  expect(result.damageEnd).not.toBe(result.damageStart);
  expect(result.pausedEvents).toEqual(['Sign', 'banner-complete', 'hud-complete', 'independent-complete']);
  expect(result.events).toEqual([...result.pausedEvents, 'damage-complete']);
});

test('the original skill card keeps its component and click while list and modal windows change', async ({ page }) => {
  await page.goto('./');
  const result = await page.evaluate(async () => {
    const { FguiRuntime, PackageRegistry } = await import(/* @vite-ignore */ new URL('assets/fgui-probe.js', document.baseURI).href);
    const parent = document.createElement('div');
    parent.style.cssText = 'position:fixed;inset:0;z-index:100';
    document.body.append(parent);
    const actions: number[] = [];
    const runtime = new FguiRuntime(parent, (action: { componentId?: number }) => {
      if (action.componentId !== undefined) actions.push(action.componentId);
    });
    await runtime.show('ActivityDungeon1017Battle', 'SkillChoiceWindow');
    const registry: FguiPackageRegistry = await PackageRegistry.load();
    const pkg = registry.package('ActivityDungeon1017Battle');
    const source = registry.component('SkillChoice_TipsAni', pkg.package.name);
    const list = 'Main/TipsList';
    const card = runtime.addListItem(list, { ...source, id: 1, packageId: pkg.package.id });
    const extraCard = runtime.addListItem(list, { ...source, id: 2, packageId: pkg.package.id });
    runtime.trimList(list, 1);
    const keptFirst = runtime.find(runtime.componentPath(1)) === card;
    const removedSecond = !extraCard.container.scene;
    runtime.setClickable(card.path, 1);
    runtime.playTransition(1, 'up');
    const tips = runtime.find(`${card.path}/Tips`);
    const start = { y: tips.y, alpha: tips.container.alpha };
    runtime.updateTransitions(150);
    const middle = { y: tips.y, alpha: tips.container.alpha };
    runtime.updateTransitions(200);
    const end = { y: tips.y, alpha: tips.container.alpha };
    const pause = registry.component('BattlePauseWindow', pkg.package.name);
    Object.assign(window, { __skillCardProbe: { runtime, actions, pause, packageName: pkg.package.name } });
    const point = card.container.getWorldTransformMatrix().transformPoint(card.width / 2, card.height / 2);
    return { start, middle, end, point: { x: point.x, y: point.y }, objectType: card.source.objectType, keptFirst, removedSecond };
  });
  expect(result.objectType).toBe('Component');
  expect(result.keptFirst).toBe(true);
  expect(result.removedSecond).toBe(true);
  expect(result.start).toEqual({ y: -50, alpha: 0 });
  expect(result.middle.y).toBeCloseTo(-12.5);
  expect(result.middle.alpha).toBeCloseTo(0.75);
  expect(result.end).toEqual({ y: 0, alpha: 1 });
  await page.mouse.click(result.point.x, result.point.y);
  await expect.poll(() => page.evaluate(() => (window as any).__skillCardProbe.actions)).toEqual([1]);
  await page.evaluate(() => {
    const { runtime, pause, packageName } = (window as any).__skillCardProbe;
    runtime.mount('pause', pause, packageName);
  });
  await page.mouse.click(result.point.x, result.point.y);
  await page.evaluate(() => (window as any).__skillCardProbe.runtime.close('pause'));
  await page.mouse.click(result.point.x, result.point.y);
  const actions = await page.evaluate(() => {
    const { runtime, actions } = (window as any).__skillCardProbe;
    runtime.dispose();
    return actions;
  });
  expect(actions).toEqual([1, 1]);
});

test('the original Loading package plays both authored EffectAni fades', async ({ page }) => {
  await page.goto('./');
  const result = await page.evaluate(async () => {
    const { FguiRuntime, PackageRegistry } = await import(/* @vite-ignore */ new URL('assets/fgui-probe.js', document.baseURI).href);
    const parent = document.createElement('div');
    parent.style.cssText = 'position:fixed;inset:0;z-index:100';
    document.body.append(parent);
    const runtime = new FguiRuntime(parent, () => {}, true);
    const registry: FguiPackageRegistry = await PackageRegistry.load();
    const original = registry.component('BattleLoadingWindow', 'Loading');
    await runtime.show('Loading', 'BattleLoadingWindow');
    runtime.mount('loading', { ...original, id: 1 }, 'Loading');
    const effect = runtime.find('EffectAni');
    const backdrop = runtime.find('PicImage');
    const times: number[] = [];
    const play = (name: string) => new Promise<number>((resolve) => {
      const start = performance.now();
      runtime.playTransition(1, name, { onComplete: () => {
        times.push(performance.now() - start);
        resolve(effect.container.alpha);
      } });
    });
    const entering = play('in1');
    const beforeEnter = effect.container.alpha;
    const entered = await entering;
    const leaving = play('out1');
    const beforeLeave = effect.container.alpha;
    const left = await leaving;
    const backdropAlpha = backdrop.container.alpha;
    runtime.close('loading');
    const released = !effect.container.scene;
    runtime.dispose();
    return { beforeEnter, entered, beforeLeave, left, backdropAlpha, released, times };
  });
  expect(result).toMatchObject({ beforeEnter: 0, entered: 1, beforeLeave: 1, left: 0, backdropAlpha: 0, released: true });
  expect(result.times).toHaveLength(2);
  for (const elapsed of result.times) expect(elapsed).toBeGreaterThan(680);
});

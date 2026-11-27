import { expect, test } from '@playwright/test';
import { openFixture } from './fixture';

test('damage numbers reuse their display tree and glyphs without retaining the old transition or ID', async ({ page }) => {
  await openFixture(page);
  const result = await page.evaluate(async () => {
    const { FguiRuntime } = await import(/* @vite-ignore */ new URL('assets/fgui-probe.js', document.baseURI).href);
    const pkg = await (await fetch('assets/fgui/ActivityDungeon1017Battle.json')).json();
    const runtime = new FguiRuntime(document.querySelector('#app'), () => {});
    const make = (id: number, source: any, children: any[] = [], componentId = source.id) => ({
      id, source, componentId, children, packageId: pkg.package.id,
      name: source.name, type: source.objectType, objectType: source.objectType,
      x: source.x ?? 0, y: source.y ?? 0, width: source.width ?? 0, height: source.height ?? 0,
      visible: true, touchable: true, controllers: {}, clickHandlerCount: 0, text: source.text,
      transitions: source.transitions,
    });
    const type = pkg.components[pkg.componentIndex.NormalHitNumberTips];
    const number = type.children[0];
    const label = pkg.components[number.src].children[0];
    const popup = (id: number, text: string) => make(id, type, [make(id + 1, number,
      [make(id + 2, { ...label, text }, [], '')], number.src)]);
    await runtime.showTree('MiniGameBattleUIWindow', make(1, {name:'HUD',objectType:'Component',width:1334,height:750}));
    let oldCompleted = 0;
    const first = runtime.addChild(1, popup(10, '132'));
    const firstNumber = first.children.get('NormalHitNumber');
    const firstLabel = firstNumber.children.get('NumberTxt');
    const glyph = firstLabel.content.list[0];
    const priorFrame = glyph.frame.name;
    runtime.playTransition(10, 'in', { onComplete: () => oldCompleted++ });
    runtime.removeChild(10);
    const detached = first.container.parentContainer === null && !first.container.displayList;
    let oldIdRegistered = true;
    try { runtime.componentPath(12); } catch { oldIdRegistered = false; }
    const second = runtime.addChild(1, popup(20, '8'));
    const secondNumber = second.children.get('NormalHitNumber');
    const secondLabel = secondNumber.children.get('NumberTxt');
    const properties = [secondNumber.container.alpha, secondNumber.container.scaleX, secondNumber.container.scaleY];
    const reusedGlyph = secondLabel.content.list[0] === glyph;
    const changedFrame = secondLabel.content.list[0].frame.name !== priorFrame;
    const visibleGlyphs = secondLabel.content.list.filter((item: {visible: boolean}) => item.visible).length;
    let newCompleted = 0;
    runtime.playTransition(20, 'in', { onComplete: () => newCompleted++ });
    const deadline = performance.now() + 2500;
    while (!newCompleted && performance.now() < deadline) await new Promise(requestAnimationFrame);
    const observed = { detached, oldIdRegistered, reusedGlyph, changedFrame, visibleGlyphs, oldCompleted, newCompleted,
      reusedContainer: first.container === second.container, properties };
    runtime.dispose();
    return observed;
  });
  expect(result).toEqual({ detached: true, oldIdRegistered: false, reusedGlyph: true, changedFrame: true, visibleGlyphs: 1,
    oldCompleted: 0, newCompleted: 1, reusedContainer: true, properties: [1, 1, 1] });
});

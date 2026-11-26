import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { UiHostMessage } from '../../runtime/ui/protocol';
import type { FguiPackage } from '../../src/fgui/package';
import { openChooser, originalClick } from './navigation';

interface Stage18World {
  stage: number;
  frame: number;
  wave: number;
  kills: number;
  exp: number | null;
  level: number | null;
  hp: number | null;
  maxHp: number | null;
  map: string | null;
  cast: { id: number; x: number; y: number; model: string }[];
  enemies: number;
  enemyIds: number[];
  projectiles: number;
}

interface Observation {
  startStages: number[];
  chooserScroll?: number;
  world?: Stage18World;
  choiceListId?: number;
  choiceCards: { id: number; revealed: boolean }[];
  choiceRevision: number;
  workerErrors: string[];
}

async function observeStage(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const schema = 'starfall.monster-defense.progress/1';
    for (let stageId = 78000001; stageId < 78000018; stageId++) {
      localStorage.setItem(`${schema}/${stageId}`, JSON.stringify({ schema, stageId, settlement: 'confirmed_natural_win' }));
    }
    const state: Observation = { startStages: [], choiceRevision: 0, choiceCards: [], workerErrors: [] };
    Object.assign(window, { stage18Observation: state });
    let chooserListId: number | undefined;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('message', ({ data }: MessageEvent<UiHostMessage>) => {
          if (data.type === 'error') state.workerErrors.push(`${data.code}: ${data.message}`);
          if (data.type === 'open' && data.window === 'Activity17MiniGameChoice2Window') {
            chooserListId = data.tree.children.find((node) => node.name === 'Main')?.children.find((node) => node.name === 'TipsList')?.id;
          }
          if (data.type === 'open' && data.window === 'MiniGameSkillChoiceWindow') {
            const list = data.tree.children.find((node) => node.name === 'Main')?.children.find((node) => node.name === 'TipsList');
            if (list) state.choiceListId = list.id;
            state.choiceCards = [];
            state.choiceRevision++;
          }
          if (data.type === 'close' && data.window === 'MiniGameSkillChoiceWindow') {
            delete state.choiceListId;
            state.choiceCards = [];
            state.choiceRevision++;
          }
          if (data.type === 'ops') {
            for (const op of data.ops) {
              if (op.op === 'scroll' && op.id === chooserListId) state.chooserScroll = op.x;
              if (op.op === 'list-clear' && op.id === state.choiceListId) {
                state.choiceCards = [];
                state.choiceRevision++;
              }
              if (op.op === 'list-add' && op.id === state.choiceListId) state.choiceCards.push({ id: op.item.id, revealed: false });
              if (op.op === 'transition-play' && op.name === 'up') {
                const card = state.choiceCards.find((entry) => entry.id === op.id);
                if (card) card.revealed = true;
              }
            }
          }
          if (data.type !== 'event') return;
          if (data.event.name === 'start-battle') state.startStages.push(data.event.stageId);
          if (data.event.name !== 'world') return;
          const world = data.event.state;
          if (world.stageId !== 78000018) return;
          const cast = world.units.filter((unit) => unit.cardId >= 78000101 && unit.cardId <= 78000105 && unit.model);
          const enemies = cast.length ? world.units.filter((unit) => unit.camp !== cast[0]!.camp && unit.model) : [];
          state.world = {
            stage: world.stageId, frame: world.fixedFrame, wave: world.curMonsterWave, kills: world.killEnemyCount,
            exp: world.curExp, level: world.curLevel, hp: world.selfHp, maxHp: world.selfMaxHp, map: world.background?.path ?? null,
            cast: cast.map((unit) => ({ id: unit.cardId, x: unit.x, y: unit.y, model: unit.model!.path })),
            enemies: enemies.length, enemyIds: [...new Set(enemies.map((unit) => unit.cardId))], projectiles: world.bullets?.length ?? 0,
          };
        });
      }
    };
  });
}

function observed(page: Page): Promise<Observation> {
  return page.evaluate(() => (window as Window & { stage18Observation?: Observation }).stage18Observation!);
}

async function completedRender(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

test('ordinary entry starts original stage 18 with its five defenders, enemies and upgrades', async ({ page }) => {
  test.setTimeout(120000);
  const info = test.info();
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await observeStage(page);
  await page.goto('./');
  const choicePkg: FguiPackage = await (await page.request.get('./assets/fgui/ActivityDungeon1017.json')).json();
  const battlePkg: FguiPackage = await (await page.request.get('./assets/fgui/ActivityDungeon1017Battle.json')).json();
  const mapList = choicePkg.components[choicePkg.componentIndex['MiniGameChoice2']!]!.children!.find((node) => node.name === 'TipsList')!;
  const map = choicePkg.components[mapList.defaultItem!.slice(13)]!;
  const stage = map.children!.find((node) => node.name === 'Tips18Btn')!;
  const button = choicePkg.components[stage.src!]!;
  const offers = battlePkg.components[battlePkg.componentIndex['SkillChoice']!]!.children!.find((node) => node.name === 'TipsList')!;
  const offerCard = battlePkg.components[offers.defaultItem!.slice(13)]!;
  const chooserRole = page.getByRole('region', { name: '选择关卡', exact: true });
  const battlefieldRole = page.getByRole('region', { name: '魔物抵御战战场', exact: true });
  const skillRole = page.getByRole('region', { name: '选择强化', exact: true });
  await openChooser(page);
  await expect(chooserRole).toBeVisible();
  await expect.poll(async () => (await observed(page)).chooserScroll).toBe(-3230);
  const scrollX = Math.max(-(map.width - mapList.width!), (await observed(page)).chooserScroll!);
  const tap = { x: mapList.x! + scrollX + stage.x! + button.width / 2, y: mapList.y! + stage.y! + button.height / 2 };
  await completedRender(page);
  await page.screenshot({ path: info.outputPath('stage18-stage-select.png') });
  await originalClick(page, tap.x, tap.y);
  await expect.poll(async () => (await observed(page)).startStages, { timeout: 30000 }).toEqual([78000018]);
  await expect(battlefieldRole).toBeVisible({ timeout: 25000 });
  await expect.poll(async () => (await observed(page)).world?.frame ?? 0, { intervals: [50], timeout: 25000 }).toBeGreaterThan(0);
  const opening = (await observed(page)).world!;
  expect(opening.cast.map((unit) => unit.id).sort()).toEqual([78000101, 78000102, 78000103, 78000104, 78000105]);
  expect(opening.map).toMatch(/minigame022_map3\.prefab$/i);
  expect(opening.maxHp).toBe(6000);
  await completedRender(page);
  await page.screenshot({ path: info.outputPath('stage18-opening.png') });

  await expect.poll(async () => (await observed(page)).world?.enemies ?? 0, { intervals: [50], timeout: 30000 }).toBeGreaterThanOrEqual(5);
  const crowd = (await observed(page)).world!;
  await completedRender(page);
  await page.screenshot({ path: info.outputPath('stage18-first-enemies.png') });

  const picks: { frame: number; optionCount: number }[] = [];
  let referenceWindow: Stage18World | undefined;
  // Compare at the reference's displayed 0:23 without constraining the RNG or comparing combat results.
  while (!referenceWindow) {
    await expect.poll(async () => {
      const { world, choiceListId, choiceCards } = await observed(page);
      return (choiceListId === undefined && (world?.frame ?? 0) >= 690)
        || (choiceCards.length > 0 && choiceCards.every((card) => card.revealed));
    }, { intervals: [100], timeout: 35000 }).toBe(true);
    const state = await observed(page);
    if (state.choiceListId === undefined && state.world!.frame >= 690) {
      referenceWindow = state.world;
      await completedRender(page);
      await page.screenshot({ path: info.outputPath('stage18-at-reference-time.png') });
      break;
    }
    const count = state.choiceCards.length;
    if (count === 0 || !state.choiceCards.every((card) => card.revealed)) continue;
    await expect(skillRole).toBeVisible();
    await completedRender(page);
    if (picks.length === 0) await page.screenshot({ path: info.outputPath('stage18-first-upgrade.png') });
    const contentWidth = count * offerCard.width + (count - 1) * offers.columnGap!;
    const choiceX = offers.x! + Math.floor((offers.width! - contentWidth) / 2) + offerCard.width / 2;
    await originalClick(page, choiceX, offers.y! + offerCard.height / 2);
    await originalClick(page, 667, 654);
    picks.push({ frame: state.world!.frame, optionCount: count });
    await expect.poll(async () => (await observed(page)).choiceRevision).toBeGreaterThan(state.choiceRevision);
  }
  expect(picks.length).toBeGreaterThan(0);
  expect(referenceWindow?.stage).toBe(78000018);
  expect((await observed(page)).workerErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  writeFileSync(info.outputPath('stage18-evidence.json'), JSON.stringify({ seededProgress: 'stages 1–17', tap, scrollX, opening, crowd, picks, referenceWindow }, null, 2));
});

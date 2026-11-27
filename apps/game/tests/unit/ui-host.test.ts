import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  createOriginalUiHost,
  type LuaEngineLike,
  type OriginalUiHost,
  type UiHostIo,
} from '../../runtime/ui/host';
import { UI_PRELUDE_LUA } from '../../runtime/ui/prelude';
import { STRESS_LOADOUT_LUA } from '../../runtime/ui/stress-loadout';
import { stressMonsterTarget } from '../../src/content/stress-stage';
import type { RuleState } from '../../src/engine/protocol';
import { UI_TIMERS_LUA } from '../../runtime/ui/timers';
import type {
  UiEvent,
  UiOpenMessage,
  UiOp,
  UiTreeNode,
} from '../../runtime/ui/protocol';
import { UI_PROTOCOL, type UiHostMessage } from '../../runtime/ui/protocol';
import stageOracle from '../support/stage-outcomes.json';

// 显式测试时间（仅测试用，不代表产品排期）：活动开始于 2023-11-14T22:13:20Z，
// “服务器现在”为 2025-11-25T09:20:00Z，相对开始时间的全部 unlock_day(0..10) 均已到期。
const TEST_ACTIVITY_START = 1_700_000_000;
const TEST_SERVER_NOW = 1_764_000_000;

const PUBLIC_DIR = path.resolve(import.meta.dirname, '../../public');
const PLAYER_ASSETS = process.env['STARFALL_TEST_PLAYER_ASSETS'];

function nodeIo(): UiHostIo {
  return {
    async loadBytes(filePath: string): Promise<Uint8Array> {
      const file = PLAYER_ASSETS
        ? path.join(PLAYER_ASSETS, filePath.slice('assets/'.length))
        : path.join(PUBLIC_DIR, filePath);
      const bytes = readFileSync(file);
      return new Uint8Array(filePath.endsWith('.gz') ? gunzipSync(bytes) : bytes);
    },
    async createLuaEngine(vendor: Uint8Array, wasm: Uint8Array): Promise<LuaEngineLike> {
      const dir = mkdtempSync(path.join(tmpdir(), 'ui-host-lua-'));
      try {
        writeFileSync(path.join(dir, 'vendor.cjs'), vendor);
        writeFileSync(path.join(dir, 'glue.wasm'), wasm);
        const require = createRequire(import.meta.url);
        const { LuaFactory } = require(path.join(dir, 'vendor.cjs')) as {
          LuaFactory: new (wasmUri: string) => { createEngine(options: object): Promise<LuaEngineLike> };
        };
        const factory = new LuaFactory(path.join(dir, 'glue.wasm'));
        return await factory.createEngine({
          openStandardLibs: true,
          injectObjects: false,
          enableProxy: false,
          functionTimeout: 30000,
        });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

class Collector {
  readonly messages: UiHostMessage[] = [];
  readonly post = (message: UiHostMessage): void => {
    this.messages.push(message);
  };
  byType<T extends UiHostMessage['type']>(type: T): Extract<UiHostMessage, { type: T }>[] {
    return this.messages.filter((message) => message.type === type) as Extract<UiHostMessage, { type: T }>[];
  }
  events(): UiEvent[] {
    return this.byType('event').map((message) => message.event);
  }
  ops(): UiOp[] {
    return this.byType('ops').flatMap((message) => message.ops);
  }
  lastOpen(window: string): UiOpenMessage {
    const opens = this.byType('open').filter((message) => message.window === window);
    const last = opens[opens.length - 1];
    if (!last) throw new Error(`no open message for ${window}`);
    return last;
  }
  lastListItems(listId: number): UiTreeNode[] {
    const ops = this.ops().filter((op) => op.op === 'list-items' && op.id === listId);
    const last = ops[ops.length - 1];
    if (!last || last.op !== 'list-items') throw new Error(`no list-items for ${listId}`);
    return last.items;
  }
  setOps(id: number): Extract<UiOp, { op: 'set' }>[] {
    return this.ops().filter((op): op is Extract<UiOp, { op: 'set' }> => op.op === 'set' && op.id === id);
  }
  controllerOps(id: number, name: string): Extract<UiOp, { op: 'controller' }>[] {
    return this.ops().filter(
      (op): op is Extract<UiOp, { op: 'controller' }> => op.op === 'controller' && op.id === id && op.name === name,
    );
  }
  clickCount(id: number): number {
    const ops = this.ops().filter((op) => op.op === 'click-handlers' && op.id === id);
    const last = ops[ops.length - 1];
    if (!last || last.op !== 'click-handlers') return 0;
    return last.count;
  }
}

function child(node: UiTreeNode, name: string): UiTreeNode {
  const found = node.children.find((entry) => entry.name === name);
  if (!found) throw new Error(`missing child ${name} under ${node.name}`);
  return found;
}

function pathOf(root: UiTreeNode, ...names: string[]): UiTreeNode {
  let node = root;
  for (const name of names) node = child(node, name);
  return node;
}

async function makeHost(collector: Collector, overrides: Partial<Parameters<typeof createOriginalUiHost>[0]> = {}) {
  const host = createOriginalUiHost({
    postMessage: collector.post,
    runtimeBase: 'https://ui-host.test/',
    activityStartStamp: TEST_ACTIVITY_START,
    serverNowStamp: TEST_SERVER_NOW,
    io: nodeIo(),
    ...overrides,
  });
  await host.init(1);
  return host;
}

test('mounted list resizes keep the common prefix and release discarded nodes and their Lua work', async () => {
  const collector = new Collector();
  const io = nodeIo();
  const { createLuaEngine } = io;
  let engine!: LuaEngineLike;
  io.createLuaEngine = async (vendor, wasm) => {
    engine = await createLuaEngine(vendor, wasm);
    return {
      global: engine.global,
      doString: (source) => engine.doString(source === UI_PRELUDE_LUA ? source + `
        function __TestListState(listId)
          local list = __GetProxy(listId)
          local rows = {}
          list.itemRenderer = function(index, item) rows[index + 1] = item end
          local keptId = __HostCall('list.itemAt', listId, 0)
          local kept = __GetProxy(keptId)
          list.numItems = list.numItems
          assert(rows[1] == kept, 'refresh replaced the first row')
          local removed = rows[#rows]
          local removedId = removed.__id
          assert(removed:GetController('lock') ~= nil, 'fixture row has no controller')
          local clicked = 0
          removed.onClick:Set(function() clicked = clicked + 1 end)
          removed.itemRenderer = function() end
          PlayUITrans(removed, 'test', function() clicked = clicked + 1 end)
          removed:TweenValue(10, 0.1)
          list.numItems = 2
          __HostDispatch('click', removedId)
          assert(clicked == 0, 'click closure survived row release')
          assert(__Proxies[removedId] == nil and __CtrlProxies[removedId] == nil and __ListRenderers[removedId] == nil,
            'Lua caches retained the removed row')
          for _, play in pairs(__Animations) do assert(play.owner ~= removedId, 'transition retained the removed row') end
          __UiAdvanceTimers(100, 1)
          list.numItems = 3
          assert(rows[1] == kept and rows[3] ~= removed, 'resize did not preserve only the common prefix')
          list:RemoveChildrenToPool()
          assert(list.numItems == 0 and __Proxies[keptId] == nil, 'clear retained list items')
        end

        function __TestWindowRelease(rootId, window)
          __UiSetTimerContext(function() return rootId end, function(_, callback, ...) callback(...) end)
          LeanTween.delayedCall(0.1, function() error('callback survived window close') end)
          __GetProxy(rootId).onClick:Set(function() UIMgr:CloseWindow(window) end)
        end
      ` : source),
    };
  };
  const host = await makeHost(collector, { io });
  try {
    const main = child(collector.lastOpen('Activity17MiniGame2MainWindow').tree, 'Main');
    await host.click(2, host.session, child(main, 'StartBtn').id);
    const chooser = collector.lastOpen('Activity17MiniGameChoice2Window');
    const listId = pathOf(chooser.tree, 'Main', 'CardRegion', 'HeadList').id;
    const rows = collector.lastListItems(listId);
    const initialOps = collector.ops().length;
    await engine.doString(UI_TIMERS_LUA);
    await engine.doString(`__TestListState(${listId})`);
    await host.present(3, host.session, { kind: 'shown', rootId: chooser.rootId });

    const listOps = collector.ops().slice(initialOps).filter((op) => op.id === listId);
    expect(listOps.map((op) => op.op)).toEqual(['list-trim', 'list-add', 'list-clear']);
    expect(listOps[0]).toEqual({ op: 'list-trim', id: listId, count: 2 });
    await expect(host.click(4, host.session, rows[4]!.id)).rejects.toThrow(/unknown-component/);
    await engine.doString(`__TestWindowRelease(${chooser.rootId}, ${JSON.stringify(chooser.window)})`);
    await host.click(5, host.session, chooser.rootId);
    await engine.doString('__UiAdvanceTimers(100, 1)');
  } finally {
    await host.dispose();
  }
});

async function completeOriginalTransition(host:OriginalUiHost, collector:Collector, name:string) {
  const op=collector.ops().filter(o=>o.op==='transition-play' && o.name===name).at(-1);
  if(op?.op!=='transition-play') throw new Error('Missing original transition '+name+': '+JSON.stringify(collector.byType('error')));
  await host.present(880,host.session,{kind:'transition',playId:op.playId});
}
test('gameplay opens the original HUD and registers the fixed clock only after Sign and up', async () => {
  const collector = new Collector();
  const host = await makeHost(collector, { gameplay: true });
  try {
    expect(collector.byType('error')).toEqual([]);
    await host.click(2, host.session, pathOf(collector.lastOpen('Activity17MiniGame2MainWindow').tree, 'Main','StartBtn').id);
    expect(collector.byType('error')).toEqual([]);
    const chooser = pathOf(collector.lastOpen('Activity17MiniGameChoice2Window').tree,'Main','TipsList');
    const map = collector.lastListItems(chooser.id)[0]!;
    await host.click(3, host.session, child(map,'Tips1Btn').id);
    expect(collector.byType('error')).toEqual([]);
    await completeOriginalTransition(host,collector,'in1');
    const hud = collector.lastOpen('MiniGameBattleUIWindow');
    await host.present(4, host.session, {kind:'shown',rootId:hud.rootId});
    await completeOriginalTransition(host,collector,'out1');
    const intro = collector.ops().find((op) => op.op === 'transition-play' && op.name === 'in');
    if (intro?.op !== 'transition-play') throw new Error('No original intro');
    expect(intro.labels).toEqual(['Sign']);
    await host.present(5,host.session,{kind:'tick',ms:200});
    const lastWorld = () => collector.events().filter((e) => e.name === 'world').at(-1);
    expect(lastWorld()?.state.fixedFrame).toBe(0);
    await host.present(6,host.session,{kind:'transition',playId:intro.playId,label:'Sign'});
    await host.present(7,host.session,{kind:'transition',playId:intro.playId});
    const rise = collector.ops().find((op) => op.op === 'transition-play' && op.name === 'up');
    if (rise?.op !== 'transition-play') throw new Error('No HUD up transition');
    await host.present(8,host.session,{kind:'transition',playId:rise.playId});
    await host.present(9,host.session,{kind:'tick',ms:200});
    expect(collector.byType('error')).toEqual([]);
    expect(lastWorld()?.state.fixedFrame).toBe(6);
    expect(lastWorld()?.state.units.length).toBeGreaterThanOrEqual(3);
  } finally { await host.dispose(); }
},120000);

async function enterGameplay(collector: Collector, stage: number, io = nodeIo()) {
  const host = await makeHost(collector, {gameplay:true, io:{...io,randomSeed:()=>70441022},
    clearedStageIds:Array.from({length:stage-1},(_,i)=>78000001+i)});
  const session = host.session;
  await host.click(2,session,pathOf(collector.lastOpen('Activity17MiniGame2MainWindow').tree,'Main','StartBtn').id);
  const list=pathOf(collector.lastOpen('Activity17MiniGameChoice2Window').tree,'Main','TipsList');
  await host.click(3,session,child(collector.lastListItems(list.id)[0]!,stage===21?'SpecialBtn':'Tips'+stage+'Btn').id);
  await finishIntro(collector, host);
  return host;
}

test('a bounded tick yields between fixed steps, advances timers and display once, and resumes precisely', async () => {
  async function sample(bounded:boolean) {
    const collector=new Collector();
    const io=nodeIo();
    let engine!:LuaEngineLike;
    const host=await enterGameplay(collector,1,{...io,async createLuaEngine(vendor,wasm){
      engine=await io.createLuaEngine(vendor,wasm); return engine;
    }});
    try {
      await engine.doString(`
        local timer,display=__UiAdvanceTimers,MiniGameBattleSceneMgr.UpdateDisplay
        TimerCalls,DisplayCalls=0,0
        __UiAdvanceTimers=function(...) TimerCalls=TimerCalls+1; return timer(...) end
        MiniGameBattleSceneMgr.UpdateDisplay=function(...) DisplayCalls=DisplayCalls+1; return display(...) end
      `);
      const send=(id:number,ms:number,resume=false)=>host.present(id,host.session,
        {kind:'tick',ms,...(bounded?{stepBudget:2,resume}:{})});
      await send(810,250);
      if(bounded) {
        expect(collector.byType('settled').at(-1)).toMatchObject({moreSteps:true});
        expect(await engine.doString('return MiniGameBattleControl.curFixedFrame')).toBe(2);
        for(let id=811;collector.byType('settled').at(-1)?.moreSteps;id++) {
          expect(id).toBeLessThan(820);
          await send(id,0,true);
        }
      }
      const world=collector.events().filter(event=>event.name==='world').at(-1)?.state;
      expect(world?.fixedFrame).toBe(7);
      expect(await engine.doString('return TimerCalls*10+DisplayCalls')).toBe(11);
      await send(822,17);
      expect(collector.events().filter(event=>event.name==='world').at(-1)?.state.fixedFrame).toBe(8);
      return world;
    } finally { await host.dispose(); }
  }
  expect(await sample(true)).toEqual(await sample(false));
},30000);

test('a native pause takes effect between slices and no suspended battle steps run while paused', async () => {
  const collector = new Collector();
  const host = await enterGameplay(collector,1);
  try {
    const hud = collector.lastOpen('MiniGameBattleUIWindow').tree;
    await host.present(901,host.session,{kind:'tick',ms:250,stepBudget:2});
    expect(collector.byType('settled').at(-1)?.moreSteps).toBe(true);
    await host.click(902,host.session,pathOf(hud,'Main','Top','PauseBtn').id);
    const pause = collector.lastOpen('MiniGameBattlePauseWindow').tree;
    await host.present(903,host.session,{kind:'tick',ms:0,stepBudget:2,resume:true});
    const world = () => collector.events().filter(event=>event.name==='world').at(-1)?.state;
    expect(world()).toMatchObject({fixedFrame:2,paused:true});
    expect(collector.byType('settled').at(-1)?.moreSteps).toBeUndefined();
    await host.present(904,host.session,{kind:'tick',ms:500,stepBudget:2});
    expect(world()?.fixedFrame).toBe(2);
    await host.click(905,host.session,pathOf(pause,'Main','TouchScreenBtn').id);
    await host.present(906,host.session,{kind:'tick',ms:34,stepBudget:2});
    expect(world()).toMatchObject({fixedFrame:3,paused:false});
  } finally { await host.dispose(); }
},30000);

test('interrupting a sliced tick displays the already performed movement before pausing', async () => {
  const collector = new Collector();
  const io = nodeIo();
  let engine!: LuaEngineLike;
  const host = await enterGameplay(collector, 1, { ...io, async createLuaEngine(vendor, wasm) {
    engine = await io.createLuaEngine(vendor, wasm);
    return engine;
  } });
  try {
    const uid = await engine.doString(`
      MiniGameBattleSceneMgr.AddMonster(78000201, 2005, 0, 0)
      local moving = MiniGameBattleScene.aliveMonsterList[1]
      moving:SetState(BATTLE_STATE_ENUM.MOVE)
      return moving.uid
    `);
    const world = () => collector.events().filter(event => event.name === 'world').at(-1)!.state;
    const moving = () => world().units.find(unit => unit.uid === uid)!;
    const hud = collector.lastOpen('MiniGameBattleUIWindow').tree;
    await host.present(921,host.session,{kind:'tick',ms:0,stepBudget:2});
    const initial = moving();
    await host.present(922,host.session,{kind:'tick',ms:100,stepBudget:2});
    expect(collector.byType('settled').at(-1)?.moreSteps).toBe(true);
    await host.click(923,host.session,pathOf(hud,'Main','Top','PauseBtn').id);
    await host.present(924,host.session,{kind:'tick',ms:0,stepBudget:2,resume:true});
    expect(world()).toMatchObject({fixedFrame:2,paused:true});
    expect(moving().x).toBeLessThan(initial.x);
    expect(moving().model!.position.x).toBeCloseTo(moving().x / 75);
    expect(moving().model!.time - initial.model!.time).toBeCloseTo(2/30);
  } finally { await host.dispose(); }
},30000);

test('a rapid pause and continue discards only the unfinished tail, even before the continuation acknowledges it', async () => {
  const collector = new Collector();
  const host = await enterGameplay(collector, 1);
  try {
    const hud = collector.lastOpen('MiniGameBattleUIWindow').tree;
    const world = () => collector.events().filter(event => event.name === 'world').at(-1)!.state;
    await host.present(925,host.session,{kind:'tick',ms:250,stepBudget:2});
    await host.click(926,host.session,pathOf(hud,'Main','Top','PauseBtn').id);
    const pause = collector.lastOpen('MiniGameBattlePauseWindow').tree;
    await host.click(927,host.session,pathOf(pause,'Main','TouchScreenBtn').id);
    await host.present(928,host.session,{kind:'tick',ms:0,stepBudget:2,resume:true});
    expect(world()).toMatchObject({fixedFrame:2,paused:false});
    expect(collector.byType('settled').at(-1)?.moreSteps).toBeUndefined();
    await host.present(929,host.session,{kind:'tick',ms:34,stepBudget:2});
    expect(world()).toMatchObject({fixedFrame:3,paused:false});
  } finally { await host.dispose(); }
},30000);

test('changing speeds between slices leaves the admitted batch and its animation on the original clock', async () => {
  const collector = new Collector();
  const host = await enterGameplay(collector, 1);
  try {
    const world = () => collector.events().filter(event => event.name === 'world').at(-1)!.state;
    const idleCard = () => world().units.find(unit => unit.cardId === 78000101)!;
    const hud = collector.lastOpen('MiniGameBattleUIWindow').tree;
    const speed = pathOf(hud,'Main','Top','SpeedBtn').id;
    await host.present(931,host.session,{kind:'tick',ms:100});
    const initial = idleCard().model!;
    const initialFrame = world().fixedFrame;
    await host.click(932,host.session,speed);
    await host.present(933,host.session,{kind:'tick',ms:200/3,stepBudget:2});
    expect(collector.byType('settled').at(-1)?.moreSteps).toBe(true);
    await host.click(934,host.session,speed);
    await host.present(935,host.session,{kind:'tick',ms:0,stepBudget:2,resume:true});
    expect(world()).toMatchObject({fixedFrame:initialFrame+4,speedIndex:1});
    expect(idleCard().model!.time - initial.time).toBeCloseTo(4/30);
    await host.present(936,host.session,{kind:'tick',ms:34,stepBudget:2});
    expect(world().fixedFrame).toBe(initialFrame+5);
  } finally { await host.dispose(); }
},30000);

test('settling an old foreground batch preserves its scaled time and the native pause still uses zero', async () => {
  const collector = new Collector();
  const io = nodeIo();
  let engine!: LuaEngineLike;
  const host = await enterGameplay(collector, 1, { ...io, async createLuaEngine(vendor, wasm) {
    engine = await io.createLuaEngine(vendor, wasm);
    return engine;
  } });
  try {
    await engine.doString(`
      local advance=__UiAdvanceTimers
      __UiAdvanceTimers=function(ms,scale)
        LastClockInput=tostring(ms)..':'..tostring(scale)
        return advance(ms,scale)
      end
    `);
    const world = () => collector.events().filter(event => event.name === 'world').at(-1)!.state;
    const idleCard = () => world().units.find(unit => unit.cardId === 78000101)!;
    const top = pathOf(collector.lastOpen('MiniGameBattleUIWindow').tree,'Main','Top');
    await host.present(941,host.session,{kind:'tick',ms:100});
    const initial = idleCard().model!;
    const initialFrame = world().fixedFrame;
    await host.present(942,host.session,{kind:'tick',ms:50,stepBudget:2,timeScale:2});
    expect(collector.byType('settled').at(-1)?.moreSteps).toBe(true);
    await host.present(943,host.session,{kind:'tick',ms:0,stepBudget:2,resume:true});
    expect(world()).toMatchObject({fixedFrame:initialFrame+3,speedIndex:1});
    expect(await engine.doString('return LastClockInput')).toBe('50:2');
    expect(idleCard().model!.time - initial.time).toBeCloseTo(.1);
    await host.click(944,host.session,child(top,'PauseBtn').id);
    await host.present(945,host.session,{kind:'tick',ms:100,stepBudget:2,timeScale:2});
    expect(await engine.doString('return LastClockInput')).toBe('100:0');
    expect(world()).toMatchObject({fixedFrame:initialFrame+3,paused:true});
  } finally { await host.dispose(); }
},30000);

async function finishIntro(collector: Collector, host: OriginalUiHost): Promise<void> {
  const session = host.session;
  expect(collector.byType('error')).toEqual([]);
  await completeOriginalTransition(host,collector,'in1');
  const hud=collector.lastOpen('MiniGameBattleUIWindow');
  await host.present(4,session,{kind:'shown',rootId:hud.rootId});
  const latest=(name:string)=>{
    const op=collector.ops().filter(op=>op.op==='transition-play' && op.name===name).at(-1);
    if(op?.op!=='transition-play') throw new Error('Missing transition '+name);
    return op.playId;
  };
  await completeOriginalTransition(host,collector,'out1');
  const intro=latest('in');
  await host.present(5,session,{kind:'transition',playId:intro,label:'Sign'});
  await host.present(6,session,{kind:'transition',playId:intro});
  await host.present(7,session,{kind:'transition',playId:latest('up')});
}

test('the stress loadout applies all 135 original enhancements and their combat effects before the first tick', async () => {
  const collector = new Collector();
  const io = nodeIo(), create = io.createLuaEngine;
  let engine!: LuaEngineLike;
  io.createLuaEngine = async (vendor, wasm) => engine = await create(vendor, wasm);
  const host = await enterGameplay(collector, 21, io);
  try {
    await engine.doString(STRESS_LOADOUT_LUA);
    const result = await engine.doString(`
      local scene = MiniGameBattleScene
      local buffs = MiniGameBattleBuffMgr
      local function assertLiveBuffs(unit, skillId, level)
        for _, spec in ipairs(BaseShootSkill[skillId].active_buff_list or {}) do
          local buffId, targetId = spec:match('^(%d+):(%d+):10000$')
          local buff = BaseShootSkillBuff[tonumber(buffId)]
          if buff.deduce_type ~= MINI_GAME_BUFF_DEDUCE_TYPE.NOW then
            local targets = MiniGameBattleChoose.GetBuffTargetUnitList({unitUid=unit.uid}, nil, tonumber(targetId), buff)
            assert(#targets > 0, 'no live targets for skill ' .. skillId)
            for _, target in ipairs(targets) do
              local liveTarget = MiniGameBattleSceneMgr.GetUnitByUid(target.uid)
              assert(buffs.GetSettledBuffByUnitAndId(liveTarget, buff.id) == level,
                'settled combat buff stack mismatch: ' .. skillId)
            end
          end
        end
      end
      assert(#scene.cardList == 5 and MiniGameBattleControl.curFixedFrame == 0)
      for _, unit in ipairs(scene.cardList) do
        assert(unit:GetTotalSkillLevel() == 1, 'the original Endless battle should start with the normal skill')
      end
      local wall = scene.wallUnit
      local maxHp = wall:GetAttr(ATTR_ENUM.max_hp)
      wall:ChangeAttr(ATTR_ENUM.hp, -math.floor(maxHp / 2))
      local hpBefore = wall:GetHp()
      local report = StressLoadoutApply()
      local expected = {{16,2,1},{1,2,1},{1,1,2}}
      local expectedHud = {20,5,5}
      for i, unit in ipairs(scene.cardList) do
        assert(unit.id == 78000100 + i and report.cards[i].id == unit.id)
        assert(unit:GetTotalSkillLevel() == 30, 'the three base skill unlocks count separately')
        local hud = unit:GetSkillListForUI()
        for j, skill in ipairs(report.cards[i].skills) do
          local config = BaseShootSkill[skill.id]
          assert(skill.unlocked and unit:GetSkillLevel(skill.id) == 1)
          assert(hud[j].id == skill.id and hud[j].level == expectedHud[j])
          assertLiveBuffs(unit, skill.id, 1)
          for _, condition in ipairs(config.trigger_condition or {}) do
            local registered = false
            for _, trigger in ipairs(unit.skillTriggerTable[condition] or {}) do
              if trigger.skillId == skill.id and trigger.enable then registered = true end
            end
            assert(registered, 'base skill trigger was not registered: ' .. skill.id)
          end
          for k, option in ipairs(skill.options) do
            local level = expected[j][k]
            assert(option.level == level and unit:GetSkillLevel(option.id) == level)
            assertLiveBuffs(unit, option.id, level)
          end
        end
        assert(unit:GetAttr(ATTR_ENUM.atk) == unit:GetBaseAttr(ATTR_ENUM.atk) + 480,
          '16 uncapped upgrades should each add 30% of the original 100 ATK')
        assert(unit:GetAttr(ATTR_ENUM.crt) == unit:GetBaseAttr(ATTR_ENUM.crt) + 1500,
          'talent team critical chance should apply to all five heroes')
      end
      assert(wall:GetHp() - hpBefore == math.ceil(maxHp * 2000 / 10000), 'instant wall heal did not apply')
      return report.upgrades
    `);
    expect(result).toBe(135);
  } finally {
    await host.dispose();
  }
}, 30000);

test('the original chooser advances through all twenty ordinary victories and exposes the loop', async () => {
  const collector = new Collector();
  const io = nodeIo(), create = io.createLuaEngine;
  let engine: LuaEngineLike | undefined;
  io.createLuaEngine = async (vendor, wasm) => engine = await create(vendor, wasm);
  const host = await makeHost(collector, { gameplay: true, io });
  try {
    await host.click(2, host.session, pathOf(collector.lastOpen('Activity17MiniGame2MainWindow').tree, 'Main', 'StartBtn').id);
    const list = pathOf(collector.lastOpen('Activity17MiniGameChoice2Window').tree, 'Main', 'TipsList');
    const map = collector.lastListItems(list.id)[0]!;
    for (let stage = 1; stage <= 20; stage += 1) {
      const stageId = 78000000 + stage;
      const button = child(map, 'Tips' + stage + 'Btn');
      const next = child(map, stage === 20 ? 'SpecialBtn' : 'Tips' + (stage + 1) + 'Btn');
      expect(collector.controllerOps(button.id, 'lock').at(-1)?.index).toBe(0);
      expect(collector.controllerOps(next.id, 'lock').at(-1)?.index).toBe(1);
      collector.messages.length = 0;
      await host.click(3, host.session, button.id);
      expect(collector.events()).toContainEqual({ name: 'start-battle', stageId });
      await finishIntro(collector, host);
      // Exercise every real Lua settlement and selector path with a scripted terminal state.
      await engine!.doString('MiniGameBattleScene.isBattleWin = true; MiniGameBattleControl.Stop()');
      await host.present(8, host.session, { kind: 'tick', ms: 0 });
      expect(collector.events().filter(event => event.name === 'clear-earned')).toEqual([{ name: 'clear-earned', stageId }]);
      const result = collector.lastOpen('MiniGameBattleEndWindow');
      await host.click(9, host.session, pathOf(result.tree, 'Main', 'EndBtn').id);
      expect(collector.controllerOps(button.id, 'c2').at(-1)?.index).toBe(1);
      expect(collector.controllerOps(next.id, 'lock').at(-1)?.index).toBe(0);
      expect(collector.ops().filter(op => op.op === 'scroll' && op.id === list.id).at(-1)).toMatchObject({ x: -190 * stage });
      expect(collector.byType('error')).toEqual([]);
    }
    await host.click(10, host.session, child(map, 'SpecialBtn').id);
    expect(collector.events()).toContainEqual({ name: 'start-battle', stageId: 78000021 });
  } finally {
    await host.dispose();
  }
}, 120000);

test('an original stage-two victory after LEVELUP still opens stage three', async () => {
  const collector = new Collector();
  const io = nodeIo(), create = io.createLuaEngine;
  let engine: LuaEngineLike | undefined;
  io.createLuaEngine = async (vendor, wasm) => engine = await create(vendor, wasm);
  const host = await enterGameplay(collector, 2, io);
  try {
    const chooser = pathOf(collector.lastOpen('Activity17MiniGameChoice2Window').tree, 'Main', 'TipsList');
    const next = child(collector.lastListItems(chooser.id)[0]!, 'Tips3Btn');
    await host.present(8, host.session, { kind: 'debug-level' });
    expect(collector.events()).toContainEqual({ name: 'warn-tips', text: '已升一级' });
    await engine!.doString('MiniGameBattleScene.isBattleWin = true; MiniGameBattleControl.Stop()');
    await host.present(9, host.session, { kind: 'tick', ms: 0 });
    expect(collector.events().filter(event => event.name === 'settlement')).toMatchObject([{ stageId: 78000002, win: true }]);
    const result = collector.lastOpen('MiniGameBattleEndWindow');
    await host.click(10, host.session, pathOf(result.tree, 'Main', 'EndBtn').id);
    expect(collector.events().filter(event => event.name === 'clear-earned')).toEqual([{ name: 'clear-earned', stageId: 78000002, assisted: true }]);
    expect(collector.controllerOps(next.id, 'lock').at(-1)?.index).toBe(0);
    await host.click(11, host.session, next.id);
    expect(collector.events()).toContainEqual({ name: 'start-battle', stageId: 78000003 });
    await finishIntro(collector, host);
    await engine!.doString('MiniGameBattleScene.isBattleWin = true; MiniGameBattleControl.Stop()');
    await host.present(12, host.session, { kind: 'tick', ms: 0 });
    expect(collector.events().filter(event => event.name === 'clear-earned')).toEqual([
      { name: 'clear-earned', stageId: 78000002, assisted: true },
      { name: 'clear-earned', stageId: 78000003 },
    ]);
  } finally {
    await host.dispose();
  }
}, 30000);

test('stress starts on a fresh save, respects pause and exit, and leaves the normal chooser intact', async () => {
  const collector = new Collector();
  const io = nodeIo(), create = io.createLuaEngine;
  let engine!: LuaEngineLike;
  io.createLuaEngine = async (vendor, wasm) => engine = await create(vendor, wasm);
  const host = await makeHost(collector, { gameplay: true, io });
  const present = (signal: Parameters<OriginalUiHost['present']>[2]) => host.present(9, host.session, signal);
  let requestId = 10;
  const click = (node: UiTreeNode) => host.click(requestId++, host.session, node.id);
  // The worker queues commands in posting order even if the renderer still shows the old window.
  const queueClicks = (...targets: UiTreeNode[]) =>
    targets.reduce((pending, target) => pending.then(() => click(target)), Promise.resolve());
  try {
    const start = pathOf(collector.lastOpen('Activity17MiniGame2MainWindow').tree, 'Main', 'StartBtn');
    await present({ kind: 'start-stress' });
    expect(collector.events()).toContainEqual({ name: 'start-battle', stageId: 78000021, stress: true });
    await finishIntro(collector, host);
    expect(collector.events().find(event => event.name === 'stress-loadout')).toMatchObject({
      name: 'stress-loadout',
      report: { upgrades: 135, cards: [78000101, 78000102, 78000103, 78000104, 78000105].map(id => ({ id })) },
    });
    await present({ kind: 'tick', ms: 200 });
    const latest = () => collector.events().filter(event => event.name === 'world').at(-1)!.state;
    const entrants = () => latest().units.filter(unit => unit.camp === 2).map(({ cardId, x, y }) => [cardId, x, y]);
    expect(latest()).toMatchObject({ fixedFrame: 12, speedIndex: 2, curLevel: 0 });
    const firstEntrants = entrants();
    expect(firstEntrants.length).toBeGreaterThan(40);
    expect(await engine.doString(`
      local wall = MiniGameBattleScene.wallUnit
      MiniGameBattleAction.DealHurt(MiniGameBattleScene.aliveMonsterList[1], wall, wall:GetHp() + 100)
      return wall:GetHp() == wall:GetAttr(ATTR_ENUM.max_hp)
    `)).toBe(true);
    const hud = collector.lastOpen('MiniGameBattleUIWindow').tree;
    await click(start);
    expect(collector.byType('open').some(message => message.window === 'Activity17MiniGameChoice2Window')).toBe(false);
    await expect(present({ kind: 'start-stress' })).rejects.toThrow(/stress-unavailable/);
    await present({ kind: 'debug-level' });
    expect(collector.byType('settled').at(-1)?.levelUp?.applied).toBe(false);

    const hudExit = pathOf(hud, 'Main', 'Top', 'ReturnBtn');
    const speed = pathOf(hud, 'Main', 'Top', 'SpeedBtn');
    await queueClicks(hudExit, hudExit, speed);
    expect(collector.byType('open').filter(message => message.window === 'MiniGameBattleExitWindow')).toHaveLength(1);
    await present({ kind: 'tick', ms: 200 });
    expect(latest()).toMatchObject({ fixedFrame: 12, paused: true, speedIndex: 2 });
    const cancel = pathOf(collector.lastOpen('MiniGameBattleExitWindow').tree, 'Main', 'CancelBtn');
    await queueClicks(cancel, cancel);
    await present({ kind: 'tick', ms: 200 });
    expect(latest()).toMatchObject({ fixedFrame: 24, paused: false });

    // The speed control remains available, with an independent preference.
    await click(speed);
    await present({ kind: 'tick', ms: 200 });
    expect(latest()).toMatchObject({ fixedFrame: 30, speedIndex: 1 });
    await click(speed);
    await click(hudExit);
    const confirm = pathOf(collector.lastOpen('MiniGameBattleExitWindow').tree, 'Main', 'ExitBtn');
    await queueClicks(confirm, confirm, speed);
    expect(collector.events().filter(event => event.name === 'battle-close')).toHaveLength(1);
    expect(collector.events().filter(event => event.name === 'settlement' || event.name === 'clear-earned')).toEqual([]);
    expect(collector.byType('open').some(message => message.window === 'MiniGameBattleEndWindow')).toBe(false);

    await click(start);
    const chooser = pathOf(collector.lastOpen('Activity17MiniGameChoice2Window').tree, 'Main', 'TipsList');
    const map = collector.lastListItems(chooser.id)[0]!;
    expect(collector.controllerOps(child(map, 'SpecialBtn').id, 'lock').at(-1)?.index).toBe(1);
    await present({ kind: 'start-stress' });
    await finishIntro(collector, host);
    await present({ kind: 'tick', ms: 200 });
    expect(entrants()).toEqual(firstEntrants);
    await present({ kind: 'finish-stress' });
    await click(child(map, 'Tips1Btn'));
    expect(collector.events().filter(event => event.name === 'start-battle').at(-1)).toEqual({
      name: 'start-battle', stageId: 78000001,
    });
    await finishIntro(collector, host);
    await present({ kind: 'tick', ms: 200 });
    expect(latest()).toMatchObject({ fixedFrame: 6, speedIndex: 1 });
    expect(latest().units.filter(unit => unit.camp === 1)).toHaveLength(3);
    expect(collector.byType('error')).toEqual([]);
  } finally {
    await host.dispose();
  }
}, 120000);

test('stress from the chooser fills, replenishes and caps native active monsters while attacks continue', async () => {
  const collector = new Collector();
  const io = nodeIo(), create = io.createLuaEngine;
  let engine!: LuaEngineLike;
  io.createLuaEngine = async (vendor, wasm) => engine = await create(vendor, wasm);
  const host = await makeHost(collector, { gameplay: true, io });
  const present = (signal: Parameters<OriginalUiHost['present']>[2]) => host.present(9, host.session, signal);
  try {
    await engine.doString(`
      local paths, instantiate = {}, ResourceManager.Instantiate
      local enemyHits, dealHurt = 0, MiniGameBattleAction.DealHurt
      function ResourceManager.Instantiate(path)
        local key = path:lower()
        if key:find('minigame022_10000', 1, true) then paths[key] = true end
        return instantiate(path)
      end
      function MiniGameBattleAction.DealHurt(from, target, ...)
        local hurt = dealHurt(from, target, ...)
        if from and from.camp == BATTLE_CAMP_FLAG.RIGHT and target == MiniGameBattleScene.wallUnit and hurt > 0 then
          enemyHits = enemyHits + 1
        end
        return hurt
      end
      function __TestStressModels() return __JsonEncode(paths) end
      function __TestStressEnemyHits() return enemyHits end
    `);
    await host.click(2, host.session, pathOf(collector.lastOpen('Activity17MiniGame2MainWindow').tree, 'Main', 'StartBtn').id);
    await present({ kind: 'start-stress' });
    await finishIntro(collector, host);
    const states: RuleState[] = [];
    const counts: number[] = [];
    for (let i = 0; i < 13; i += 1) {
      await present({ kind: 'tick', ms: 1000 });
      states.push(collector.events().filter(event => event.name === 'world').at(-1)!.state);
      counts.push(Number(await engine.doString('return #MiniGameBattleScene.aliveMonsterList')));
      expect(collector.byType('error')).toEqual([]);
      expect(collector.byType('open').some(message => message.window === 'MiniGameSkillChoiceWindow')).toBe(false);
      collector.messages.length = 0;
    }
    expect(counts[0]).toBe(100);
    expect(counts.every((count, index) => count <= stressMonsterTarget(states[index]!.fixedFrame)), String(counts)).toBe(true);
    expect(counts.slice(4, 7).every(count => count >= 190), String(counts)).toBe(true);
    expect(counts.slice(8).every(count => count >= 200), String(counts)).toBe(true);
    expect(counts.slice(8).filter(count => count >= 285).length, String(counts)).toBeGreaterThanOrEqual(3);
    const peak = states[8]!;
    expect(peak.units.filter(unit => unit.camp === 2 && unit.model && Math.abs(unit.x) < 600 && Math.abs(unit.y) < 350).length)
      .toBeGreaterThanOrEqual(280);
    const earlyMaxUid = Math.max(...peak.units.map(unit => unit.uid));
    const last = states.at(-1)!;
    expect(last.killEnemyCount).toBeGreaterThan(peak.killEnemyCount);
    expect(last.units.some(unit => unit.camp === 2 && unit.uid > earlyMaxUid)).toBe(true);
    expect(await engine.doString('return __TestStressEnemyHits()')).toBeGreaterThan(0);
    expect(states.some(state => (state.bullets?.length ?? 0) > 0)).toBe(true);
    expect(states.some(state => (state.effects?.length ?? 0) > 0)).toBe(true);
    const paths = Object.keys(JSON.parse(String(await engine.doString('return __TestStressModels()'))));
    const skills = effectRoles.flatMap(({ normal, passive, talent }) => [normal, passive, talent]);
    expect(skills.filter(skill => !paths.some(path => path.endsWith(`minigame022_${skill}.prefab`)))).toEqual([]);
    expect(states.some(state => (state.selfHp ?? 0) < (state.selfMaxHp ?? 0))).toBe(true);
    expect(last.selfHp).toBeGreaterThan(0);
    expect(last.curLevel).toBe(0);
    expect(last.fixedFrame).toBe(780);
    await present({ kind: 'finish-stress' });
    await present({ kind: 'finish-stress' });
    expect(collector.events().filter(event => event.name === 'battle-close')).toHaveLength(1);
    expect(collector.events().filter(event => event.name === 'settlement' || event.name === 'clear-earned')).toEqual([]);
    expect(collector.byType('close').map(message => message.window)).toContain('MiniGameBattleUIWindow');
    expect(collector.byType('close').map(message => message.window)).not.toContain('Activity17MiniGameChoice2Window');
  } finally {
    await host.dispose();
  }
}, 120000);

test('endless classifies a real debug level as practice and distinguishes cancelling, exiting and a natural end', async () => {
  const collector = new Collector();
  const io = nodeIo(), create = io.createLuaEngine;
  let engine!: LuaEngineLike;
  io.createLuaEngine = async (vendor, wasm) => engine = await create(vendor, wasm);
  const host = await enterGameplay(collector, 21, io);
  try {
    const hud = collector.lastOpen('MiniGameBattleUIWindow');
    const hudExit = pathOf(hud.tree, 'Main', 'Top', 'ReturnBtn');
    const clickExit = () => host.click(20, host.session, hudExit.id);
    const settlement = () => collector.events().filter(event => event.name === 'settlement');
    await clickExit();
    await host.present(21, host.session, {kind: 'debug-level'});
    const firstPrompt = collector.lastOpen('MiniGameBattleExitWindow');
    await host.click(22, host.session, pathOf(firstPrompt.tree, 'Main', 'CancelBtn').id);
    expect(settlement()).toEqual([]);
    await clickExit();
    const secondPrompt = collector.lastOpen('MiniGameBattleExitWindow');
    await host.click(23, host.session, pathOf(secondPrompt.tree, 'Main', 'ExitBtn').id);
    expect(settlement()).toMatchObject([{ stageId: 78000021, endless: {source: 'natural', endedBy: 'exit'}, wave: 1 }]);

    await host.click(24, host.session, pathOf(collector.lastOpen('MiniGameBattleEndWindow').tree, 'Main', 'EndBtn').id);
    const list = pathOf(collector.lastOpen('Activity17MiniGameChoice2Window').tree, 'Main', 'TipsList');
    await host.click(25, host.session, child(collector.lastListItems(list.id)[0]!, 'SpecialBtn').id);
    await finishIntro(collector, host);
    await host.present(26, host.session, {kind: 'debug-level'});
    expect(collector.events()).toContainEqual({ name: 'warn-tips', text: '已升一级' });
    await engine.doString('MiniGameBattleData.killEnemyCount=45; MiniGameBattleScene.curMonsterWave=4; MiniGameBattleControl.Continue(); MiniGameBattleScene.isBattleLoss=true');
    await host.present(27, host.session, {kind: 'tick', ms: 34});
    expect(settlement()).toMatchObject([
      { endless: {source: 'natural', endedBy: 'exit'} },
      { stageId: 78000021, endless: {source: 'practice', endedBy: 'natural'}, kills: 45, wave: 4 },
    ]);
  } finally {
    await host.dispose();
  }
}, 120000);

test('the original audio bridge supplies the fixed rule frame and emitting model', async () => {
  const collector = new Collector();
  const io = nodeIo(), create = io.createLuaEngine;
  let engine!: LuaEngineLike;
  io.createLuaEngine = async (vendor, wasm) => engine = await create(vendor, wasm);
  const host = await enterGameplay(collector, 1, io);
  try {
    await host.present(8, host.session, {kind: 'tick', ms: 34});
    const fixedFrame = collector.events().filter(event => event.name === 'world').at(-1)?.state.fixedFrame;
    await engine.doString(`
      local model = {instance=729}
      MiniGameBattleActionDisplay.PlaySound(70940032, model)
    `);
    expect(collector.events().filter(event => event.name === 'audio-play' && event.kind === 'sfx').at(-1))
      .toMatchObject({ frame: fixedFrame, emitter: 729 });
  } finally {
    await host.dispose();
  }
}, 30000);

test('battle effect snapshots follow the parent and fixed clock and release completed effects', async () => {
  const collector = new Collector();
  const io = nodeIo();
  const { createLuaEngine, loadBytes } = io;
  const path = 'effects/test.one-shot.prefab';
  io.loadBytes = async (file) => {
    const bytes = await loadBytes(file);
    if (file !== 'assets/effects/manifest.json') return bytes;
    const manifest = JSON.parse(new TextDecoder().decode(bytes));
    manifest.lifetimes = { ...manifest.lifetimes, [path]: { seconds: 0.2, loop: false } };
    return new TextEncoder().encode(JSON.stringify(manifest));
  };
  let lua!: LuaEngineLike;
  io.createLuaEngine = async (vendor, wasm) => (lua = await createLuaEngine(vendor, wasm));
  const host = await enterGameplay(collector, 1, io);
  const tick = async (ms: number) => {
    await host.present(100, host.session, { kind: 'tick', ms });
    return collector.events().filter((event) => event.name === 'world').at(-1)!.state;
  };
  try {
    await lua.doString(`
      local scene = MiniGameBattleScene
      local card
      for _, unit in ipairs(scene.allUnit) do
        if unit.id == MINI_GAME_SPECIAL_CARD.DINA then card = unit; break end
      end
      __TestParent = card.model
      __TestAttached = card:CreateEffect('effects/test.attached.prefab', 2)
      __TestFree = MiniGameBattleActionDisplay.PlayEffect('${path}', {x=150,y=75,z=0}, 1.75)
      SortingHelper.SetOrderInLayer(__TestFree, 22)
      __TestFinished = false
      local destroy = __TestFree.onComplete
      EffectUtil.SetAutoDestroyCallback(__TestFree, function() __TestFinished = true; destroy() end)
    `);
    const initial = await tick(0);
    expect(initial.effects?.filter((effect) => effect.path.startsWith('effects/test.'))).toHaveLength(2);
    const detached = initial.effects!.find((effect) => effect.path === path)!;
    expect(detached).toMatchObject({ scale: {x: 1.75, y: 1.75, z: 1}, order: 22, age: 0 });
    const parent = initial.units.find((unit) => unit.cardId === 78000102)!.model!;
    const attached = initial.effects!.find((effect) => effect.path === 'effects/test.attached.prefab')!;
    expect(attached.position).toEqual(parent.position);
    expect(attached.scale.x).toBeCloseTo(parent.scale.x * 2);
    expect(attached.order).toBe(parent.order + 1);

    await lua.doString(`
      MiniGameBattleControl.Pause()
      LuaUtil.SetLocalPos(__TestParent, 3, 4, 0)
      LuaUtil.SetScale(__TestParent, -2, 3, 1)
      __TestParent.transform.right = Vector3(0, 1, 0)
      LuaUtil.SetLocalPos(__TestAttached, 1, 2, 0)
    `);
    const paused = await tick(700);
    expect(paused.effects?.find((effect) => effect.instance === detached.instance)?.age).toBe(0);
    expect(paused.effects?.find((effect) => effect.instance === attached.instance)).toMatchObject({
      position: {x: -3, y: 2, z: 0}, scale: {x: -4, y: 6, z: 1}, right: {x: 0, y: 1, z: 0}, age: 0,
    });

    await lua.doString('MiniGameBattleControl.Continue()');
    expect((await tick(100)).effects?.find((effect) => effect.instance === detached.instance)?.age).toBe(0.1);
    expect((await tick(100)).effects?.some((effect) => effect.instance === detached.instance)).toBe(false);
    expect(await lua.doString('return __TestFinished')).toBe(true);
    await lua.doString('ResourceManager.DestroyGameObject(__TestAttached)');
    expect((await tick(0)).effects?.some((effect) => effect.instance === attached.instance)).toBe(false);
  } finally {
    await host.dispose();
  }
}, 20000);

const effectRoles = [
  { name: '安妮斯', card: 78000101, normal: '10000118_skill1_bullet', passive: '10000118_skill2_bullet', talent: '10000118_skill3' },
  { name: '蒂娜', card: 78000102, normal: '10000134_skill1_bullet', passive: '10000134_skill2_summon', talent: '10000134_skill3_bullet' },
  { name: '尼莉莎', card: 78000103, normal: '10000104_skill1_bullet', passive: '10000104_skill2_bullet', talent: '10000104_skill3_summon' },
  { name: '菲尼斯', card: 78000104, normal: '10000101_skill1_bullet', passive: '10000101_skill2_buff', talent: '10000101_skill3_summon' },
  { name: '列蒂西雅', card: 78000105, normal: '10000198_skill1_bullet', passive: '10000198_skill2', talent: '10000198_skill3_buff' },
] as const;

test.each(effectRoles)('$name sends its three original combat effects into the world', async ({card, normal, passive, talent}) => {
  const collector = new Collector();
  const io = nodeIo();
  const createLuaEngine = io.createLuaEngine;
  let lua!: LuaEngineLike;
  io.createLuaEngine = async (vendor, wasm) => (lua = await createLuaEngine(vendor, wasm));
  const host = await enterGameplay(collector, 18, io);
  const frame = async (script: string, ms = 0) => {
    await lua.doString(script);
    await host.present(100, host.session, { kind: 'tick', ms });
    expect(collector.byType('error')).toEqual([]);
    return collector.events().filter((event) => event.name === 'world').at(-1)!.state;
  };
  type World = Awaited<ReturnType<typeof frame>>;
  const models = (state: World, suffix: string) => [
    ...(state.bullets ?? []), ...(state.effects ?? []), ...state.units.flatMap((unit) => unit.model ? [unit.model] : []),
  ].filter((model) => model.path.endsWith(`minigame022_${suffix}.prefab`));
  try {
    const spawn = await frame(`
    local scene=MiniGameBattleScene
    for _,card in ipairs(scene.cardList) do
      if card.id == ${card} then __TestCard=card; break end
    end
    local function spawn(id,x,y)
      local monster=MiniGameBattleSceneMgr.AddUnit({id=id, position={x=x,y=y,z=0},
        camp=BATTLE_CAMP_FLAG.RIGHT, state=BATTLE_STATE_ENUM.START})
      table.insert(scene.aliveMonsterList,monster)
      return monster
    end
    __TestTarget=spawn(78000201,100,0)
    spawn(78000201,180,50)
    spawn(78000201,270,-50)
    assert(__TestTarget.childModel)
    local twinkle=SkeletonAnimationUtil.TwinkleColor
    SkeletonAnimationUtil.TwinkleColor=function(model,value)
      if model==__TestTarget.childModel then __TestHurtTwinkle=value end
      return twinkle(model,value)
    end
    MiniGameBattleMgr.GetRandom=function() return 1 end
    function __TestFire()
      __TestCard.curSkillFrame=__TestCard.curSkillHurtPointFrame-1
      MiniGameBattleAction.DealAttack(__TestCard)
    end
    function __TestImpact()
      while #scene.allBullet>0 do scene.allBullet[1]:Destroy() end
      __TestFire()
      local shot=scene.allBullet[1]
      local target=__TestTarget.position
      shot.position={x=target.x-shot.speedV3.x,y=target.y-shot.speedV3.y,z=0}
      shot:DealMove()
    end
    function __TestTalent()
      MiniGameBattleAction.DealUnitSkill(__TestCard,__TestCard.talentSkillId)
    end
    `);
    expect(models(spawn, 'monster_appear')).toHaveLength(3);
    const base = await frame('__TestFire()');
    const normalShots = models(base, normal);
    expect(normalShots.length).toBeGreaterThan(0);
    expect(normalShots[0]!.right!.x).toBeGreaterThan(0);
    const passiveState = await frame('__TestCard:SaveSkill(__TestCard.passiveSkillId); __TestImpact()');
    expect(await lua.doString('return __TestHurtTwinkle')).toBe(20);
    const passiveModels = models(passiveState, passive);
    expect(passiveModels.length).toBeGreaterThan(0);
    const talentState = await frame('__TestCard:SaveSkill(__TestCard.talentSkillId); __TestTalent()');
    const talentModels = models(talentState, talent);
    expect(talentModels.length).toBeGreaterThan(0);

    switch (card) {
      case 78000101: {
        expect(models(talentState, '10000118_frost')[0]!.scale.x).toBeCloseTo(-1);
        expect(passiveModels[0]!.scale.x).toBeCloseTo(0.5);
        expect(talentModels[0]!.scale.x).toBeCloseTo(0.4);
        const immobilized = await frame('__TestCard:SaveSkill(78010113); __TestImpact()');
        expect(models(immobilized, 'slowmotion_buff')).toHaveLength(1);
        const upgraded = await frame('__TestCard:SaveSkill(78010132); __TestCard:SaveSkill(78010133); __TestTalent()');
        const double = models(upgraded, talent).filter((effect) => effect.scale.x > 0.7);
        expect(double).toHaveLength(2);
        const final = await frame('__TestCard:SaveSkill(78010133); __TestTalent()');
        expect(models(final, talent).filter((effect) => effect.scale.x > 0.7 && !double.some((seen) => seen.instance === effect.instance))).toHaveLength(3);
        break;
      }
      case 78000102: {
        expect(talentModels[0]!.scale.x).toBeCloseTo(0.4);
        const upgraded = await frame('__TestCard:SaveSkill(78010231); __TestCard:SaveSkill(78010233); __TestTalent()');
        const double = models(upgraded, talent).filter((effect) => effect.scale.x > 0.5);
        expect(double).toHaveLength(2);
        const final = await frame('__TestCard:SaveSkill(78010233); __TestTalent()');
        const boulders = models(final, talent).filter((effect) => effect.scale.x > 0.5 && !double.some((seen) => seen.instance === effect.instance));
        expect(boulders).toHaveLength(3);
        const moving = await frame('', 100);
        for (const first of boulders) {
          const second = models(moving, talent).find((effect) => effect.instance === first.instance)!;
          expect(second.position.x).toBeGreaterThan(first.position.x);
          expect(second.position.y).toBe(first.position.y);
          expect(second.scale.x).toBeCloseTo(0.6);
          expect(second.age).toBe(0.1);
        }
        break;
      }
      case 78000103: {
        const summon = talentState.units.find((unit) => unit.cardId === 78000302)!;
        const farthest = talentState.units.filter((unit) => unit.cardId === 78000201)
          .reduce((previous, unit) => unit.x > previous.x ? unit : previous);
        expect(summon.model!.right).toEqual({ x: farthest.x-summon.x, y: farthest.y-summon.y, z: 0 });
        expect(summon.model!.scale.x).toBeGreaterThan(0);
        const second = await frame('__TestCard:SaveSkill(78010333); __TestTalent()');
        const third = await frame('__TestCard:SaveSkill(78010333); __TestTalent()');
        expect(models(second, talent)[0]!.scale.x).toBeCloseTo(talentModels[0]!.scale.x);
        expect(models(second, talent)[0]!.scale.y).toBeGreaterThan(talentModels[0]!.scale.y);
        expect(models(third, talent)[0]!.scale.y).toBeGreaterThan(models(second, talent)[0]!.scale.y);
        break;
      }
      case 78000104: {
        expect(passiveModels[0]!.scale.x).toBeCloseTo(-1);
        const larger = await frame('__TestCard:SaveSkill(78010432); __TestTalent()');
        expect(models(larger, talent)[0]!.scale.x).toBeCloseTo(talentModels[0]!.scale.x * 1.6);
        break;
      }
      case 78000105: {
        expect(talentModels).toHaveLength(5);
        const heal = await frame('__TestCard:SaveSkill(78010531)');
        expect(models(heal, '10000198_skill3_heal')).toHaveLength(1);
        const expanded = await frame('__TestCard:SaveSkill(78010522); __TestCard:SaveSkill(78010522); __TestImpact()');
        expect(models(expanded, passive).some((effect) => Math.abs(effect.scale.x - 50/30) < 0.001)).toBe(true);
        break;
      }
    }
  } finally {
    await host.dispose();
  }
}, 20000);

test('the four ranged enemies fire their distinct world projectiles toward the wall', async () => {
  const collector = new Collector();
  const io = nodeIo();
  const createLuaEngine = io.createLuaEngine;
  let lua!: LuaEngineLike;
  io.createLuaEngine = async (vendor, wasm) => (lua = await createLuaEngine(vendor, wasm));
  const host = await enterGameplay(collector, 18, io);
  const frame = async (ms: number) => {
    await host.present(100, host.session, { kind: 'tick', ms });
    return collector.events().filter((event) => event.name === 'world').at(-1)!.state;
  };
  try {
    await lua.doString(`
      local scene=MiniGameBattleScene
      for i,id in ipairs({78000203,78000204,78000206,78000207}) do
        local monster=MiniGameBattleSceneMgr.AddUnit({id=id,position={x=250,y=i*40,z=0},
          camp=BATTLE_CAMP_FLAG.RIGHT,state=BATTLE_STATE_ENUM.START})
        table.insert(scene.aliveMonsterList,monster)
        monster.curSkillFrame=monster.curSkillHurtPointFrame-1
        MiniGameBattleAction.DealAttack(monster)
      end
    `);
    const initial = await frame(0);
    const spawns = initial.effects!.map((effect) => effect.instance);
    expect(spawns).toHaveLength(4);
    const projectiles = initial.bullets!;
    expect(projectiles.map((bullet) => bullet.path.match(/_(\d+)_skill1_bullet/)?.[1]).sort()).toEqual([
      '20010', '20108', '20306', '20411',
    ]);
    const moved = await frame(100);
    for (const bullet of projectiles) {
      expect(bullet.right!.x).toBeLessThan(0);
      const next = moved.bullets!.find((model) => model.instance === bullet.instance)!;
      expect(next.position.x).toBeLessThan(bullet.position.x);
      expect(next.age).toBe(0.1);
    }
    await frame(1000);
    const tail = await frame(700);
    expect(tail.effects!.filter((effect) => spawns.includes(effect.instance))).toHaveLength(4);
    const expired = await frame(100);
    expect(expired.effects!.some((effect) => spawns.includes(effect.instance))).toBe(false);
    expect(collector.byType('error')).toEqual([]);
  } finally {
    await host.dispose();
  }
}, 20000);

test.each(Array.from({length:21},(_,i)=>i+1))('original stage %i opens its own map, roster and first spawn',async(stage)=>{
  const collector=new Collector();
  const host=await enterGameplay(collector,stage);
  try {
    for(let i=0;i<4;i++) await host.present(10+i,host.session,{kind:'tick',ms:1000});
    expect(collector.byType('error')).toEqual([]);
    const latest=collector.events().filter(e=>e.name==='world').at(-1)!.state;
    expect(latest.stageId).toBe(78000000+stage);
    expect(latest.background?.path).toMatch(/map[123]\.prefab$/);
    expect(latest.fixedFrame).toBe(120);
    expect(latest.units.some(u=>u.cardId>=78000200)).toBe(true);
  } finally {await host.dispose();}
},20000);

// Extended rule matrix, opt in with STARFALL_FULL_MATRIX=1. The limit belongs to this test.
test.runIf(process.env['STARFALL_FULL_MATRIX']==='1').each(Array.from({length:21},(_,i)=>i+1))(
  'extended matrix stage %i reaches a natural result or the endless observation horizon',async(stage)=>{
  const collector=new Collector();
  const host=await enterGameplay(collector,stage);
  const session=host.session;
  let choices=0,frame=0,kills=0,wave=0;
  try {
    const hud = collector.lastOpen('MiniGameBattleUIWindow');
    await host.click(9,session,pathOf(hud.tree,'Main','Top','SpeedBtn').id);
    for(let turn=0; turn<900; turn++) {
      collector.messages.length=0;
      await host.present(10+turn,session,{kind:'tick',ms:1000});
      expect(collector.byType('error')).toEqual([]);
      const state=collector.events().find(e=>e.name==='world')?.state;
      if(state) {frame=state.fixedFrame;kills=state.killEnemyCount;wave=state.curMonsterWave;}
      const opens=collector.byType('open');
      const close=opens.find(w=>w.window==='MiniGameBattleEndWindow');
      if(close) {
        frame=collector.events().find(e=>e.name==='settlement')!.frame;
        const main=child(close.tree,'Main');
        const outcome=collector.setOps(child(main,'TitleTxt').id).at(-1)?.value;
        wave=Number(collector.setOps(pathOf(main,'Info1','NumberTxt').id).at(-1)?.value);
        kills=Number(collector.setOps(pathOf(main,'Info2','NumberTxt').id).at(-1)?.value);
        await host.click(3000,session,child(main,'EndBtn').id);
        expect(collector.byType('error')).toEqual([]);
        expect(collector.events().some(e=>e.name==='clear-earned')).toBe(outcome==='胜利' && stage!==21);
        expect({stage,frame,wave,kills,choices,outcome}).toEqual(stageOracle.results[stage-1]);
        return;
      }
      const choice=opens.find(w=>w.window==='MiniGameSkillChoiceWindow');
      if(choice){
        const list=pathOf(choice.tree,'Main','TipsList');
        const cards=collector.ops().filter(op=>op.op==='list-add' && op.id===list.id);
        const pick=cards[0];
        expect(pick?.op).toBe('list-add');
        await host.present(2001,session,{kind:'tick',ms:701});
        if(pick?.op==='list-add') await host.click(2002,session,pick.item.id);
        await host.click(2003,session,pathOf(choice.tree,'Main','Time','SureBtn').id);
        expect(collector.byType('error')).toEqual([]);
        choices++;
      }
      if(stage===21 && frame>=15000) {
        expect(wave).toBeGreaterThan(1);
        expect({stage,frame,wave,kills,choices,outcome:'endless-observation'}).toEqual(stageOracle.results[stage-1]);
        return;
      }
    }
    throw new Error('test observation horizon without outcome at frame '+frame);
  }finally{await host.dispose();}
},180000);

test('one VM reaches the original deterministic settlement via all eleven choice windows',async()=>{
  const collector=new Collector();
  const io=nodeIo(),create=io.createLuaEngine;
  io.createLuaEngine=async(v,w)=>{
    const lua=await create(v,w);
    const run=lua.doString.bind(lua);
    lua.doString=async source=>{
      await run(source);
      if(source.includes('function __WebBattleTick(milliseconds)')) await run(`
        local init=MiniGameBattleMgr.InitBattle
        MiniGameBattleMgr.InitBattle=function(args)
          local random, seed=math.random,math.randomseed
          local draws=0
          math.randomseed=function() return seed(70441022,78000001) end
          math.random=function(a,b)
            if draws<50 then assert(a==1 and b==10000);draws=draws+1;return 5000 end
            return random(a,b)
          end
          init(args)
          math.random,math.randomseed=random,seed
        end`);
    };
    return lua;
  };
  const host=await enterGameplay(collector,1,io);
  const session=host.session;
  try {
    const chooser = child(collector.lastOpen('Activity17MiniGameChoice2Window').tree, 'Main');
    const map = collector.lastListItems(child(chooser, 'TipsList').id)[0]!;
    const picks=[0,0,0,1,0,1,1,1,1,1,1], frames:number[]=[];
    let frame=0;
    let result: UiOpenMessage | undefined;
    for(let i=0;i<250 && !result;i++) {
      collector.messages.length=0;
      await host.present(100+i,session,{kind:'tick',ms:1000});
      expect(collector.byType('error')).toEqual([]);
      const open=collector.byType('open');
      const state=collector.events().find(e=>e.name==='world')?.state;
      if(state) frame=state.fixedFrame;
      result=open.find(w=>w.window==='MiniGameBattleEndWindow');
      const choice=open.find(w=>w.window==='MiniGameSkillChoiceWindow');
      if(choice){
        const list=pathOf(choice.tree,'Main','TipsList');
        const cards=collector.ops().filter(op=>op.op==='list-add' && op.id===list.id);
        const pick=cards[picks[frames.length]!];
        expect(pick?.op).toBe('list-add');
        frames.push(frame);
        await host.present(501,session,{kind:'tick',ms:701});
        if(pick?.op==='list-add') await host.click(502,session,pick.item.id);
        await host.click(503,session,pathOf(choice.tree,'Main','Time','SureBtn').id);
        expect(collector.byType('error')).toEqual([]);
      }
    }
    expect(frames).toEqual([344,654,1052,1660,1842,2022,2308,2645,3042,3423,3822]);
    expect(result).toBeDefined();
    expect(collector.events()).toContainEqual({name:'settlement',stageId:78000001,frame:4181,
      win:true,loss:false,wave:2,kills:205});
    const main=child(result!.tree,'Main');
    expect(collector.setOps(pathOf(main,'Info1','NumberTxt').id).at(-1)?.value).toBe('2');
    expect(collector.setOps(pathOf(main,'Info2','NumberTxt').id).at(-1)?.value).toBe('205');
    expect(collector.events().filter((event) => event.name === 'clear-earned')).toEqual([{name:'clear-earned',stageId:78000001}]);
    await host.click(504,session,child(main,'EndBtn').id);
    expect(collector.events().filter((event) => event.name === 'clear-earned')).toHaveLength(1);
    expect(collector.controllerOps(child(map, 'Tips1Btn').id, 'c2').at(-1)?.index).toBe(1);
    expect(collector.controllerOps(child(map, 'Tips2Btn').id, 'lock').at(-1)?.index).toBe(0);
    await host.click(505,session,child(map,'Tips2Btn').id);
    expect(collector.events()).toContainEqual({name:'start-battle',stageId:78000002});
    expect(collector.byType('error')).toEqual([]);
  }finally{await host.dispose();}
},120000);

describe('settled local progress in the original Lua windows', () => {
  test('retains the original day boundary for stage three when stage two was already passed', async () => {
    const collector = new Collector();
    const host = await makeHost(collector, { clearedStageIds: [78000001, 78000002], serverNowStamp: TEST_ACTIVITY_START });
    try {
      const start = pathOf(collector.lastOpen('Activity17MiniGame2MainWindow').tree, 'Main', 'StartBtn');
      await host.click(2, host.session, start.id);
      const list = pathOf(collector.lastOpen('Activity17MiniGameChoice2Window').tree, 'Main', 'TipsList');
      const third = child(collector.lastListItems(list.id)[0]!, 'Tips3Btn');
      expect(collector.controllerOps(third.id, 'lock').at(-1)?.index).toBe(1);
      await host.click(3, host.session, third.id);
      expect(collector.events()).toContainEqual({ name: 'warn-tips', text: '1天后解锁' });
      expect(collector.events().filter(event => event.name === 'start-battle')).toEqual([]);
    } finally {
      await host.dispose();
    }
  });

  test('all-unlocked opens the original stages and roster while showing only real clears', async () => {
    const collector = new Collector();
    const host = await makeHost(collector, { allUnlocked: true, clearedStageIds: [78000001, 78000013], serverNowStamp: TEST_ACTIVITY_START });
    try {
      const main = child(collector.lastOpen('Activity17MiniGame2MainWindow').tree, 'Main');
      expect(collector.setOps(pathOf(main, 'Top', 'Integral', 'NumberTxt').id).at(-1)?.value).toBe('1');
      await host.click(2, host.session, child(main, 'StartBtn').id);
      const chooser = child(collector.lastOpen('Activity17MiniGameChoice2Window').tree, 'Main');
      const map = collector.lastListItems(child(chooser, 'TipsList').id)[0]!;
      for (const index of [1, 2, 13, 20, 21]) {
        const button = child(map, index === 21 ? 'SpecialBtn' : 'Tips' + index + 'Btn');
        expect(collector.controllerOps(button.id, 'lock').at(-1)?.index).toBe(0);
        if (index !== 21) expect(collector.controllerOps(button.id, 'c2').at(-1)?.index).toBe([1, 13].includes(index) ? 1 : 0);
        await host.click(3 + index, host.session, button.id);
        expect(collector.events()).toContainEqual({ name: 'start-battle', stageId: 78000000 + index });
      }
      const heads = collector.lastListItems(pathOf(chooser, 'CardRegion', 'HeadList').id);
      expect(heads).toHaveLength(5);
      for (const head of heads) expect(collector.controllerOps(head.id, 'lock').at(-1)?.index).toBe(0);
    } finally {
      await host.dispose();
    }
  });

  test.each([
    { clearedStageIds: [78000002], highScore: '0', entry: 'Tips1Btn', expectedStage: 78000001 },
    { clearedStageIds: [78000001, 78000003], highScore: '1', entry: 'Tips2Btn', expectedStage: 78000002 },
    {
      clearedStageIds: Array.from({ length: 21 }, (_, index) => 78000001 + index),
      highScore: '20',
      entry: 'SpecialBtn',
      expectedStage: 78000021,
    },
  ])('opens $entry at a high score of $highScore', async ({ clearedStageIds, highScore, entry, expectedStage }) => {
    const collector = new Collector();
    // Pass a named input so this regression can exercise the old host, which ignored saved clears.
    const initOptions = { activityStartStamp: TEST_ACTIVITY_START, clearedStageIds };
    const host = await makeHost(collector, initOptions);
    try {
      const main = child(collector.lastOpen('Activity17MiniGame2MainWindow').tree, 'Main');
      const score = pathOf(main, 'Top', 'Integral', 'NumberTxt');
      expect(collector.setOps(score.id).at(-1)?.value).toBe(highScore);

      await host.click(2, host.session, child(main, 'StartBtn').id);
      const chooser = child(collector.lastOpen('Activity17MiniGameChoice2Window').tree, 'Main');
      const map = collector.lastListItems(child(chooser, 'TipsList').id)[0]!;
      if (highScore === '1') {
        const first = child(map, 'Tips1Btn');
        expect(collector.controllerOps(first.id, 'c2').at(-1)?.index).toBe(1);
        await host.click(3, host.session, first.id);
        expect(collector.events()).toContainEqual({ name: 'warn-tips', text: '已通关' });

        const third = child(map, 'Tips3Btn');
        expect(collector.controllerOps(third.id, 'lock').at(-1)?.index).toBe(1);
        await host.click(4, host.session, third.id);
        expect(collector.events()).toContainEqual({ name: 'warn-tips', text: '前置关卡未通过' });
        expect(collector.events()).not.toContainEqual(expect.objectContaining({ name: 'start-battle' }));
      }

      const next = child(map, entry);
      expect(collector.controllerOps(next.id, 'lock').at(-1)?.index).toBe(0);
      await host.click(5, host.session, next.id);
      expect(collector.events()).toContainEqual({ name: 'start-battle', stageId: expectedStage });
    } finally {
      await host.dispose(999);
    }
  }, 180000);
});

describe('original Lua window host (real Lua engine + original FGUI data)', () => {
  const collector = new Collector();
  let host: OriginalUiHost;
  let session: string;

  beforeAll(async () => {
    host = await makeHost(collector);
    const ready = collector.byType('ready')[0];
    if (!ready) throw new Error('missing ready message');
    session = ready.session;
  }, 180000);

  afterAll(async () => {
    await host.dispose(999);
  });

  test('init executes the original main window OnInit against the real FGUI tree', () => {
    const ready = collector.byType('ready')[0]!;
    expect(ready.protocol).toBe(UI_PROTOCOL);
    expect(ready.entryPoint).toBe('Activity17MiniGame2MainWindow');
    for (const name of [
      'Activity17MiniGame2MainWindow',
      'Activity17MiniGameChoice2Window',
      'Activity17MiniGameChoice2_InfoSkillWindow',
      'MiniGameBattleUIWindow',
    ]) {
      expect(ready.windows).toContain(name);
    }
    for (const capability of ['red-dot', 'task-system', 'daily-reward', 'battle', 'item-icon', 'account-save']) {
      expect(ready.excludedCapabilities).toContain(capability);
    }

    const open = collector.lastOpen('Activity17MiniGame2MainWindow');
    expect(open.tree.name).toBe('MiniGame2Window');
    const main = child(open.tree, 'Main');
    const startBtn = child(main, 'StartBtn');
    expect(startBtn.objectType).toBe('Button');
    expect(startBtn.refName).toBe('MiniMain2_StartBtn');

    // 原 InitBtn 通过 onClick:Add 注册（host 回报 click-handlers 操作）
    expect(collector.clickCount(startBtn.id)).toBe(1);
    expect(collector.clickCount(child(main, 'ReturnBtn').id)).toBe(1);
    expect(collector.clickCount(child(main, 'Botton').children.find((c) => c.name === 'TaskBtn')!.id)).toBe(1);

    // 原 RefreshPanelInfo 设置的真实文本（T 来自原 BaseWord_cn）
    const startWord = child(startBtn, 'WordTxt');
    expect(collector.setOps(startWord.id).map((op) => op.value)).toContain('前往'); // T(11918)
    const integral = pathOf(main, 'Top', 'Integral');
    expect(collector.setOps(child(integral, 'WordTxt').id).map((op) => op.value)).toContain('最高关卡数'); // T(1981)
    expect(collector.setOps(child(integral, 'NumberTxt').id).map((op) => op.value)).toContain('0'); // miniHighScore=0
    const todayTask = pathOf(main, 'Botton', 'TodayTask');
    expect(collector.setOps(child(todayTask, 'WordTxt').id).map((op) => op.value)).toContain('前往参与1次  0/1'); // T(1982,0)
    expect(collector.controllerOps(todayTask.id, 'c1').map((op) => op.index)).toContain(0);

    // UIMgr:GetItemUrl 返回真实 FGUI 包项 url
    const bgLoader = pathOf(main, 'BackGround', 'BackGroundLoader');
    expect(collector.setOps(bgLoader.id).map((op) => op.value)).toContain('ui://aonql508q3oheq');

    // 红点按批准范围显式排除（不静默伪造）
    const redDots = collector.events().filter((event) => event.name === 'unsupported' && event.capability === 'red-dot');
    expect(redDots.length).toBeGreaterThanOrEqual(2);
  });

  test('clicking the original start button runs the original choice window OnInit', async () => {
    const main = child(collector.lastOpen('Activity17MiniGame2MainWindow').tree, 'Main');
    const startBtn = child(main, 'StartBtn');
    await host.click(2, session, startBtn.id);

    const open = collector.lastOpen('Activity17MiniGameChoice2Window');
    expect(open.tree.name).toBe('MiniGameChoice2Window');
    const choiceMain = child(open.tree, 'Main');

    // TipsList 生成 1 个地图项，含 21 个关卡入口（Tips1..Tips20 + SpecialBtn）
    const tipsList = child(choiceMain, 'TipsList');
    expect(tipsList.list?.defaultItem).toBe('ui://aonql508q3ohh5');
    const mapItems = collector.lastListItems(tipsList.id);
    expect(mapItems).toHaveLength(1);
    const map = mapItems[0]!;
    const stageButtons: UiTreeNode[] = [];
    for (let index = 1; index <= 20; index += 1) stageButtons.push(child(map, `Tips${index}Btn`));
    stageButtons.push(child(map, 'SpecialBtn'));
    expect(stageButtons).toHaveLength(21);

    // 关卡 1：pre=0 且时间已到 → 解锁；其余关 pre 未满足 → 锁定（全部来自原逻辑）
    expect(collector.controllerOps(stageButtons[0]!.id, 'lock').map((op) => op.index)).toContain(0);
    for (const button of stageButtons.slice(1)) {
      expect(collector.controllerOps(button.id, 'lock').map((op) => op.index)).toContain(1);
    }
    // 原 NumberTxt 文本 T(11917, n) = 第n关
    const numberTxt1 = child(stageButtons[0]!, 'NumberTxt');
    expect(collector.setOps(numberTxt1.id).map((op) => op.value)).toContain('第1关');
    const numberTxt20 = child(stageButtons[19]!, 'NumberTxt');
    expect(collector.setOps(numberTxt20.id).map((op) => op.value)).toContain('第20关');
    // 原 scrollPane:SetPosX(-190 * (78000001 % 100 - 1)) = 0
    const scrollOps = collector.ops().filter((op) => op.op === 'scroll' && op.id === tipsList.id);
    expect(scrollOps.map((op) => (op.op === 'scroll' ? op.x : null))).toContain(0);

    // HeadList 生成 5 个头像；cardList={78000110,78000101,78000102} → 锁 [0,0,1,1,1]
    const headList = pathOf(choiceMain, 'CardRegion', 'HeadList');
    const heads = collector.lastListItems(headList.id);
    expect(heads).toHaveLength(5);
    const expectedLocks = [0, 0, 1, 1, 1];
    heads.forEach((head, index) => {
      expect(collector.controllerOps(head.id, 'lock').map((op) => op.index)).toContain(expectedLocks[index]);
    });
    // 头像 url 来自 UIUtil.GetResUrl(cardConfig.head_icon_ui) 的真实包项
    const picLoader = pathOf(heads[0]!, 'Bg', 'PicLoader');
    expect(collector.setOps(picLoader.id).map((op) => op.value)).toContain('ui://aonql508spxeid');
  });

  test('clicking a locked stage warns through the original branch and never starts a battle', async () => {
    const map = collector.lastListItems(child(child(collector.lastOpen('Activity17MiniGameChoice2Window').tree, 'Main'), 'TipsList').id)[0]!;
    const stage2 = child(map, 'Tips2Btn');
    const battlesBefore = collector.events().filter((event) => event.name === 'start-battle').length;
    await host.click(3, session, stage2.id);
    const events = collector.events();
    const warns = events.filter((event) => event.name === 'warn-tips');
    expect(warns.map((event) => (event.name === 'warn-tips' ? event.text : ''))).toContain('前置关卡未通过'); // T(11926)
    expect(events.filter((event) => event.name === 'start-battle')).toHaveLength(battlesBefore);
  });

  test('clicking stage one crosses the original InitBattle boundary as a start-battle event', async () => {
    const map = collector.lastListItems(child(child(collector.lastOpen('Activity17MiniGameChoice2Window').tree, 'Main'), 'TipsList').id)[0]!;
    const stage1 = child(map, 'Tips1Btn');
    await host.click(4, session, stage1.id);
    const events = collector.events();
    expect(events).toContainEqual({ name: 'module-group', group: 'MiniGameBattle' });
    expect(events).toContainEqual({ name: 'start-battle', stageId: 78000001 });
  });

  test('head click reaches the original info window and fails loudly on the missing skill table', async () => {
    const headListId = pathOf(
      child(collector.lastOpen('Activity17MiniGameChoice2Window').tree, 'Main'),
      'CardRegion',
      'HeadList',
    ).id;
    const heads = collector.lastListItems(headListId);
    await host.click(5, session, heads[0]!.id);
    const failures = collector
      .byType('error')
      .filter((message) => message.requestId === undefined && /BaseShootSkill/.test(message.message));
    expect(failures.length).toBeGreaterThanOrEqual(1);
    // 半开的 InfoSkill 窗口被显式关闭，不留残骸
    expect(collector.byType('close').map((message) => message.window)).toContain(
      'Activity17MiniGameChoice2_InfoSkillWindow',
    );
    // 选择状态仍按原逻辑更新（UpdateCardHead 重渲染后 c1 选中第 1 个头像）
    const headsAfter = collector.lastListItems(headListId);
    expect(collector.controllerOps(headsAfter[0]!.id, 'c1').map((op) => op.index)).toContain(1);
  });

  test('task window is explicitly unsupported instead of silently faked', async () => {
    const main = child(collector.lastOpen('Activity17MiniGame2MainWindow').tree, 'Main');
    const taskBtn = child(child(main, 'Botton'), 'TaskBtn');
    await host.click(6, session, taskBtn.id);
    const failures = collector
      .byType('error')
      .filter((message) => message.requestId === undefined && /Activity17MiniTask2Window/.test(message.message));
    expect(failures.length).toBeGreaterThanOrEqual(1);
  });

  test('clicking an unknown component rejects the request', async () => {
    await expect(host.click(7, session, 999999)).rejects.toThrow(/unknown-component/);
  });

  test('closing the main window invalidates its components and callbacks', async () => {
    const main = child(collector.lastOpen('Activity17MiniGame2MainWindow').tree, 'Main');
    const returnBtn = child(main, 'ReturnBtn');
    const startBtn = child(main, 'StartBtn');
    await host.click(8, session, returnBtn.id);
    expect(collector.byType('close').map((message) => message.window)).toContain('Activity17MiniGame2MainWindow');
    await expect(host.click(9, session, startBtn.id)).rejects.toThrow(/unknown-component/);
  });

  test('re-init starts a clean session and drops stale-session clicks', { timeout: 180000 }, async () => {
    const second = new Collector();
    const hostB = await makeHost(second);
    const readyB = second.byType('ready')[0]!;
    expect(readyB.session).not.toBe(session);
    const startBtn = child(child(second.lastOpen('Activity17MiniGame2MainWindow').tree, 'Main'), 'StartBtn');
    await expect(hostB.click(10, session, startBtn.id)).rejects.toThrow(/stale-session/);
    await hostB.click(11, readyB.session, startBtn.id);
    expect(second.lastOpen('Activity17MiniGameChoice2Window').tree.name).toBe('MiniGameChoice2Window');
    await hostB.dispose(12);
    await expect(hostB.click(13, readyB.session, startBtn.id)).rejects.toThrow(/disposed/);
    const countAfterDispose = second.messages.length;
    await expect(hostB.click(14, readyB.session, startBtn.id)).rejects.toThrow();
    expect(second.messages.length).toBe(countAfterDispose);
  });

  test(
    'time-locked stages show the original countdown branch (and the original nil-stage edge)',
    { timeout: 180000 },
    async () => {
    // 显式测试时间：活动 3 天后才开始 → 第 1 关 pre 满足但时间未到
    const timeCollector = new Collector();
    const hostC = await makeHost(timeCollector, { activityStartStamp: TEST_SERVER_NOW + 3 * 86400 });
    const readyC = timeCollector.byType('ready')[0]!;
    const main = child(timeCollector.lastOpen('Activity17MiniGame2MainWindow').tree, 'Main');
    await hostC.click(20, readyC.session, child(main, 'StartBtn').id);
    const map = timeCollector.lastListItems(
      child(child(timeCollector.lastOpen('Activity17MiniGameChoice2Window').tree, 'Main'), 'TipsList').id,
    )[0]!;
    const stage1 = child(map, 'Tips1Btn');
    expect(timeCollector.controllerOps(stage1.id, 'lock').map((op) => op.index)).toContain(1);
    expect(timeCollector.controllerOps(stage1.id, 'c1').map((op) => op.index)).toContain(1);
    const timeWord = child(child(stage1, 'Time'), 'WordTxt');
    const timeTexts = timeCollector.setOps(timeWord.id).map((op) => op.value);
    expect(timeTexts.some((value) => typeof value === 'string' && /天后解锁$/.test(value))).toBe(true); // T(11925)
    // 原 GetCurUnlockStage 在首关时间未到时取 stageTable[0] → 原逻辑自身的 nil 边界，显式上报并关闭窗口
    expect(
      timeCollector.byType('error').some((message) => message.requestId === undefined && /nil/.test(message.message)),
    ).toBe(true);
    expect(timeCollector.events().filter((event) => event.name === 'start-battle')).toHaveLength(0);
    await hostC.dispose(21);
    },
  );

  test('missing platform or activity time is an explicit error, never a fabricated default', async () => {
    type HostOptions = Parameters<typeof createOriginalUiHost>[0];
    const badCollector = new Collector();
    const base = {
      postMessage: badCollector.post,
      runtimeBase: 'https://ui-host.test/',
      io: nodeIo(),
    };
    const noServer = createOriginalUiHost({ ...base, activityStartStamp: TEST_ACTIVITY_START } as unknown as HostOptions);
    await expect(noServer.init(1)).rejects.toThrow(/serverNowStamp/);
    const noActivity = createOriginalUiHost({ ...base, serverNowStamp: TEST_SERVER_NOW } as unknown as HostOptions);
    await expect(noActivity.init(1)).rejects.toThrow(/activityStartStamp/);
  });
});

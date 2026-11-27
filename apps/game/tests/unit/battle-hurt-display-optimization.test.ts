import { copyFileSync, mkdtempSync, readFileSync, rmdirSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { adaptHurtNumberDisplay, bufferedTransition, shiftHurtNumberStack } from '../../runtime/ui/battle-hurt-display-optimization';
import type { LuaEngineLike } from '../../runtime/ui/host';
import type { UiOp } from '../../runtime/ui/protocol';

const runtime = resolve(import.meta.dirname, '../../public/assets/runtime');
const originalShow = readFileSync(join(runtime, 'ui/original/MiniGameBattleHurtNum.lua'), 'utf8');
const fixture = String.raw`
local placed, active, log, stackBatchCount = {}, {}, {}, 0
local function note(...) log[#log+1] = table.concat({...}, ':') end
function __HostCall(op, ids)
  assert(op == 'battle.hurt.shiftStack')
  stackBatchCount = stackBatchCount + 1
  for id in ids:gmatch('%d+') do
    local tip = placed[tonumber(id)]
    tip.y = tip.y - tip.height / 2
  end
end

local nextId = 0
local function makeTips(url)
  nextId = nextId + 1
  local id = nextId
  local position = {x=0,y=0,height=27}
  local tip = setmetatable({ __id = id }, {
    __index = position,
    __newindex = function(_, key, value)
      note('position', id, key, value)
      position[key] = value
    end,
  })
  local text = setmetatable({}, {__newindex=function(_, key, value) note('text',id,key,value) end})
  position.GetChild = function(_, name)
    note('child', id, name)
    return { GetChild = function(_, childName) note('child', id, childName); return text end }
  end
  position.RemoveFromParent = function() note('remove',id) end
  position.Dispose = function() note('dispose',id) end
  position.SetXY = function(self, x, y) self.x=x; self.y=y end
  position.GetTransition = function(_, name)
    return setmetatable({ Play = function(_, complete)
      note('play', id, name)
      active[id] = complete
    end }, {__newindex = function(_, key, scaled) note('transition',id,key,tostring(scaled)) end})
  end
  placed[id] = tip
  note('allocate',id,url)
  return tip
end

CS = { Launch = { Singleton = { transform = {} } } }
FairyGUI = { GObjectPool = function()
  return {GetObject=function(_, url) return makeTips(url) end,
    ReturnObject=function(_, object) note('return',object.__id) end,
    Clear=function() note('clear') end}
end }
UIMgr = {GetItemUrl=function(_, package, name) return package .. '/' .. name end,
  GetLayerRoot=function() return {AddChild=function(_, child) note('add',child.__id) end} end}

function CompareHurtDisplay()
  local a = { UIPosition = {x = 10.2, y = 83.6}, cachedDisplayHurtTips = {} }
  local b = { UIPosition = {x = -11.9, y = -17.6}, cachedDisplayHurtTips = {} }
  MiniGameBattleHurtNum.Init()
  MiniGameBattleHurtNum.ShowHurtNum('NOR_HURT', 16.7, a)
  MiniGameBattleHurtNum.ShowHurtNum('CRI_HURT', 211.9, a)
  MiniGameBattleHurtNum.ShowHurtNum('NOR_TREATMENT', -51.2, b)
  active[1]()
  MiniGameBattleHurtNum.ShowHurtNum('NOR_HURT', 31.3, a)
  MiniGameBattleHurtNum.ShowHurtNum('NOR_HURT', 999, {})
  active[4]()
  active[2]()
  assert(#a.cachedDisplayHurtTips == 0 and #b.cachedDisplayHurtTips == 1)
  MiniGameBattleHurtNum.ClearHurtNum()
  active[3]()
  return table.concat(log, '|') .. ';' .. stackBatchCount
end`;

let scratch: string;
let vendor: string;
let factory: { createEngine(options: object): Promise<LuaEngineLike> };

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'battle-hurt-display-'));
  vendor = join(scratch, 'vendor.cjs');
  const vendorDir = join(runtime, 'core-worker/inputs/vendor');
  copyFileSync(join(vendorDir, 'index.js'), vendor);
  const { LuaFactory } = createRequire(import.meta.url)(vendor) as {
    LuaFactory: new (wasmPath: string) => typeof factory;
  };
  factory = new LuaFactory(join(vendorDir, 'glue.wasm'));
});

afterAll(() => {
  unlinkSync(vendor);
  rmdirSync(scratch);
});

test('batches the original Lua stack adjustment with identical number and playback operations', async () => {
  async function run(source: string): Promise<string> {
    const engine = await factory.createEngine({ enableProxy: false, functionTimeout: 5000 });
    try {
      await engine.doString(fixture);
      await engine.doString(source);
      return String(await engine.doString('return CompareHurtDisplay()'));
    } finally { engine.global.close(); }
  }

  const expected = await run(originalShow);
  expect(expected).toMatch(/;0$/);
  const actual = await run(adaptHurtNumberDisplay(originalShow));
  expect(actual).toBe(expected.replace(/;0$/, ';4'));
});

test('keeps exact numeric offsets and order when pushing the same HUD operations', () => {
  const first = { id: 7, y: -12.25, height: 29 };
  const second = { id: 3, y: 71, height: 26 };
  const nodes = new Map([[first.id, first], [second.id, second]]);
  const ops: UiOp[] = [];
  shiftHurtNumberStack('7,3,7', id => nodes.get(id)!, op => { ops.push(op); });
  expect(ops).toEqual([
    { op: 'set', id: 7, key: 'y', value: -26.75 },
    { op: 'set', id: 3, key: 'y', value: 58 },
    { op: 'set', id: 7, key: 'y', value: -41.25 },
  ]);
});

test('finds an immediate transition and preserves lookup after later operations', () => {
  const earlier = { op: 'transition-play', id: 24, name: 'in', playId: 21 } as const;
  const recent = { op: 'transition-play', id: 24, name: 'out', playId: 22 } as const;
  const queued: UiOp[] = [{ op: 'set', id: 10, key: 'y', value: 21 }, earlier, recent];
  expect(bufferedTransition(queued, 22)).toBe(recent);
  expect(bufferedTransition(queued, 21)).toBe(earlier);
  expect(bufferedTransition(queued, 20)).toBeUndefined();
});

import { copyFileSync, mkdtempSync, readFileSync, rmdirSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { BATTLE_PROJECTILE_OPTIMIZATION } from '../../runtime/ui/battle-projectile-optimization';
import type { LuaEngineLike } from '../../runtime/ui/host';

const runtime = resolve(import.meta.dirname, '../../public/assets/runtime/core-worker');
const inputs = resolve(runtime, 'combat-prefix/inputs');
const originalMath = readFileSync(join(inputs, 'MathUtil.lua'), 'utf8');
const originalBullet = readFileSync(join(inputs, 'MiniGameBattleBullet.lua'), 'utf8');
const originalChoose = readFileSync(join(inputs, 'MiniGameBattleChoose.lua'), 'utf8');
const originalHelpers = readFileSync(join(inputs, 'source-derived-helpers.lua'), 'utf8');
const originalScene = readFileSync(join(runtime, 'inputs/lua/MiniGameBattleScene.lua'), 'utf8');

const fixtures = String.raw`
MiniGameBattleControl = {curFixedFrame = 1}
MiniGameBattleBuffMgr = {UpdateAllBuff = function() end}
MiniGameBattleDataMgr = {DealExpAdd = function() end}
MiniGameBattleAction = {DealDying = function() end}
BATTLE_CAMP_FLAG = {RIGHT = 2}
MiniGameBattleUnit = {NewUnit = function(data)
  local pos = data.position
  if data.summonFromUnitId then pos.x = data.clampedX end
  return {
    uid = data.uid, camp = data.camp or BATTLE_CAMP_FLAG.RIGHT, coverRadiusR = data.radius, position = pos,
    Update = function() end, DealBasicBuff = function() end,
    IsDead = function() return data.dead or false end, IsDestroy = function() return false end,
    SavePosition = function(self, x, y, z) self.position = {x=x, y=y, z=z} end,
  }
end}

local newOriginalBullet = MiniGameBattleBullet.NewBullet
OriginalNearest = MiniGameBattleChoose.GetNearestMonsterForCenterUnit
local module = MathUtil.GetVector3Module
MathUtil.GetVector3Module = function(vector)
  ExactChecks = ExactChecks + 1
  return module(vector)
end

function Monster(uid, x, y, z, radius, dead)
  return MiniGameBattleUnit.NewUnit({uid=uid, position={x=x, y=y, z=z}, radius=radius, dead=dead})
end

function MakeBattle(monsters, action)
  ClearMiniGameBattleScene()
  local scene = MiniGameBattleScene
  scene.aliveMonsterList = monsters
  for i = 1, 19 do scene.allBullet[i] = {Update = function() end} end
  scene.allBullet[20] = {Update = action}
  return scene
end

function DenseMonsters()
  local monsters = {}
  for i = 1, 80 do monsters[i] = Monster(i, 960 + i * 3, 550, 0, 20) end
  return monsters
end

function Compare(x, y, z, radius, hits)
  local position = {x=x, y=y, z=z}
  local original = newOriginalBullet({}, {}, {}, {delayFrame=1})
  local candidate = MiniGameBattleBullet.NewBullet({}, {}, {}, {delayFrame=1})
  original.position, original.coverRadiusR, original.hurtUidList = position, radius, hits or {}
  candidate.position, candidate.coverRadiusR, candidate.hurtUidList = position, radius, hits or {}

  local function uids(bullet)
    local uids = {}
    for i, unit in ipairs(bullet:GetHurtMonsterList()) do uids[i] = unit.uid end
    return table.concat(uids, ',')
  end
  ExactChecks = 0
  local expected = uids(original)
  ExactChecks = 0
  local actual = uids(candidate)
  assert(actual == expected, 'Reordered or changed native hits: expected ' .. expected .. ', got ' .. actual)
  return actual, ExactChecks
end`;

describe('original projectile collision', () => {
  let scratch: string;
  let vendor: string;
  let factory: { createEngine(options: object): Promise<LuaEngineLike> };
  let lua: LuaEngineLike;

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'battle-projectile-lua-'));
    vendor = join(scratch, 'vendor.cjs');
    const vendorDir = join(runtime, 'inputs/vendor');
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

  beforeEach(async () => {
    lua = await factory.createEngine({ enableProxy: false, functionTimeout: 5000 });
    await lua.doString(`MathUtil=(function()\n${originalMath}\nend)()`);
    await lua.doString(originalBullet);
    await lua.doString(originalScene);
    await lua.doString(originalChoose);
    await lua.doString(originalHelpers);
    await lua.doString(fixtures);
    await lua.doString(BATTLE_PROJECTILE_OPTIMIZATION);
  });

  afterEach(() => lua?.global.close());

  test('reduces exact checks while preserving negative cell boundaries, truncation, Z distance and list order', async () => {
    const result = await lua.doString(`
      local monsters = DenseMonsters()
      monsters[12] = Monster(12, -53.99995, -64, 0, 0)
      monsters[14] = Monster(14, -64, -74, 0, 0)
      monsters[15] = Monster(15, -64, -53.9997, 0, 0)
      monsters[20] = Monster(20, -64, -64, 10.00005, 0)
      monsters[21] = Monster(21, -64, -64, 10.0002, 0)
      monsters[34] = Monster(34, -110, -64, 0, 60)
      monsters[55] = Monster(55, -64, -64, 0, 20, true)
      monsters[64] = Monster(64, -64, -64, 0, 20)
      monsters[70] = Monster(70, -64.00005, -128, 0, 0)
      monsters[71] = Monster(71, -64.0002, -128, 0, 0)
      local hits, exact
      MakeBattle(monsters, function()
        hits, exact = Compare(-64, -64, 0, 10, {[64]=1})
        assert(Compare(-54, -128, 0, 10) == '70', 'Native rounding crosses into an adjacent cell')
      end)
      MiniGameBattleSceneMgr.UpdateProcess()
      assert(hits == '55,34,20,14,12', 'Fixture must contain all edge hits')
      return exact
    `);
    expect(result).toBeLessThan(12);
  });

  test('uses the current list and coordinates after motion, a summon clamp and a same-frame append', async () => {
    const compared = await lua.doString(`
      local monsters = DenseMonsters()
      monsters[8] = Monster(8, 0, 0, 0, 10)
      local hits = {}
      MakeBattle(monsters, function()
        hits[1] = Compare(0, 0, 0, 10)
        monsters[8]:SavePosition(-129, 0, 0)
        hits[2] = Compare(-129, 0, 0, 10)
        hits[3] = Compare(0, 0, 0, 10)
        local summon = MiniGameBattleSceneMgr.AddUnit({position=monsters[8].position,
          camp=BATTLE_CAMP_FLAG.RIGHT, summonFromUnitId=1, clampedX=0, radius=20})
        -- The original summon code inserts at the beginning of the live list.
        table.insert(monsters, 1, summon)
        hits[4] = Compare(0, 0, 0, 10)
        hits[5] = Compare(-129, 0, 0, 10)
      end)
      MiniGameBattleSceneMgr.UpdateProcess()
      return table.concat(hits, ';')
    `);
    expect(compared).toBe('8;8;;8,10001;');
  });

  test('keeps lightweight battles on the original scan', async () => {
    expect(await lua.doString(`
      local monsters = {Monster(2, 80, 0, 0, 0), Monster(1, 15, 0, 0, 0)}
      MakeBattle(monsters, function()
        local hits, exact = Compare(0, 0, 0, 16)
        assert(hits == '1' and exact == 2, 'Lightweight native scan')
      end)
      MiniGameBattleSceneMgr.UpdateProcess()
      return true
    `)).toBe(true);
  });

  test('handles a wider boulder query and falls back for a radius wider than the grid allows', async () => {
    expect(await lua.doString(`
      local monsters = DenseMonsters()
      monsters[3] = Monster(3, 15, 0, 0, 0)
      monsters[5] = Monster(5, 80, 0, 0, 0)
      MakeBattle(monsters, function()
        assert(Compare(0, 0, 0, 10) == '', 'Smaller projectile radius')
        local hits, exact = Compare(0, 0, 0, 32)
        assert(hits == '3' and exact < 10, 'Widened boulder radius')
        hits, exact = Compare(0, 0, 0, 100)
        assert(hits == '5,3' and exact == #monsters, 'Native scan collects both targets')
      end)
      MiniGameBattleSceneMgr.UpdateProcess()
      return true
    `)).toBe(true);
  });

  test('preserves native catapult order and independent snapshots while computing each distance once', async () => {
    const exact = await lua.doString(`
      local monsters = DenseMonsters()
      monsters[2] = Monster(2, 0, 10.00005, 0, 20)
      monsters[5] = Monster(5, 0, 10, 0, 20)
      monsters[10] = Monster(10, 0, -10, 0, 20)
      monsters[11] = Monster(11, -3, 0, 4, 20)
      monsters[12] = Monster(12, 3, 0, 4, 20)
      monsters[16] = Monster(16, -2, 3, 0, 20)
      MakeBattle(monsters, function() end)
      local center = {position={x=0,y=0,z=0}}
      local excluded = {lastBounce=16, [1]=2}
      ExactChecks = 0
      local expected = OriginalNearest(center, 20, excluded)
      ExactChecks = 0
      local actual = MiniGameBattleChoose.GetNearestMonsterForCenterUnit(center, 20, excluded)
      assert(#expected == 20 and #actual == 20, 'Twenty catapult candidates')
      assert(actual[1].uid == 11 and actual[2].uid == 12, 'Distance ties consider X')
      for i, enemy in ipairs(actual) do assert(enemy.uid == expected[i].uid, 'Native tie order') end
      assert(actual[1] ~= monsters[11] and actual[1].position ~= monsters[11].position, 'Deep copies')
      actual[1].position.x = -100
      assert(monsters[11].position.x == -3, 'Original position survives copy mutation')
      return ExactChecks
    `);
    expect(exact).toBe(80);
  });
});

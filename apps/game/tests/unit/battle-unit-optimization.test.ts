import { copyFileSync, mkdtempSync, readFileSync, rmdirSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'vitest';
import { BATTLE_UNIT_HP_LISTENERS } from '../../runtime/ui/battle-unit-hp-listeners';
import { BATTLE_UNIT_OPTIMIZATION } from '../../runtime/ui/battle-unit-optimization';
import type { LuaEngineLike } from '../../runtime/ui/host';

const runtime = resolve(import.meta.dirname, '../../public/assets/runtime/core-worker');
const originalSources = [
  'inputs/lua/BattleConst.lua',
  'inputs/lua/MiniGameBattleConst.lua',
  'inputs/lua/MiniGameBattleScene.lua',
  'combat-prefix/inputs/source-derived-helpers.lua',
  'combat-prefix/inputs/MiniGameBattleUnit.lua',
  'combat-prefix/inputs/MiniGameBattleChoose.lua',
  'combat-prefix/inputs/MiniGameBattleBuffMgr.lua',
].map(file => readFileSync(join(runtime, file), 'utf8'));
const mathSource = readFileSync(join(runtime, 'combat-prefix/inputs/MathUtil.lua'), 'utf8');

const fixtures = String.raw`
local noop = function() end
Application = {platform='WebGLPlayer'}
RuntimePlatform = {}
CS = {UnityEngine={Animator='Animator'}}
typeof = function(value) return value end
MiniGameBattleAction = {ForceChangeState=function(unit, state) unit:SetState(state) end}
MiniGameBattleActionDisplay = {PlaySound=noop}
MiniGameBattleData = {killEnemyCount=0}
ATTR_ENUM = {max_hp='max_hp', hp='hp', atk='atk', crt='crt', spd_atk='spd_atk', range_atk='range_atk'}
print_battle = noop
ResourceManager = {Instantiate=function()
  local animator = {}
  return {Get3DPositionToUIPosition=function() return {} end,GetComponentInChildren=function() return animator end}
end}
BattleResourceManager = {AddGameObject=noop}
LuaUtil = {SetLocalPos=noop}
SortingHelper = {SetOrderInLayer=noop}
UIMgr = {GetLayerRoot=function() return {} end}
ClearMiniGameBattleScene()

local sourceCopy, sourceSort = SimpleCopy, table.sort
CopyCount, SortCount = 0, 0
function SimpleCopy(value)
  if value == MiniGameBattleScene.aliveMonsterList then
    CopyCount = CopyCount + #value
  else
    CopyCount = CopyCount + 1
  end
  return sourceCopy(value)
end
function table.sort(...)
  SortCount = SortCount + 1
  return sourceSort(...)
end
OriginalNewUnit = MiniGameBattleUnit.NewUnit
OriginalNearest = MiniGameBattleChoose.GetNearestMonster
OriginalFarthest = MiniGameBattleChoose.GetOneFarthestMonster

function Unit(uid, kind, x, y, z, original)
  local create = original and OriginalNewUnit or MiniGameBattleUnit.NewUnit
  local unit = create({uid=uid,isGrid=true,position={x=x,y=y,z=z}})
  unit.isGrid, unit.battleUnitType = false, kind
  unit.coverRadiusR, unit.tempRangeAtk = 5, 20
  return unit
end
function Card(uid, original)
  local create = original and OriginalNewUnit or MiniGameBattleUnit.NewUnit
  local previous = ResourceManager.Instantiate
  ResourceManager.Instantiate = function()
    return {transform={localScale={x=1}},
      Get3DPositionToUIPosition=function() return {} end,
      GetComponentInChildren=function() end}
  end
  local config = {type=MINI_GAME_BATTLE_UNIT_TYPE.CARD,spd='card.prefab',spd_scale=10000,range=5,max_hp=10}
  TableData = {GetConfig=function() return config end,GetTable=function() return {} end}
  LuaUtil.ChangeLayer, LuaUtil.FindChild, LuaUtil.PlayAnimator = noop, noop, noop
  local card = create({uid=uid,position={x=0,y=0,z=0},camp=BATTLE_CAMP_FLAG.LEFT})
  card.tempRangeAtk = 20
  ResourceManager.Instantiate = previous
  return card
end
function Enemy(uid, x, y, z)
  local unit = Unit(uid, MINI_GAME_BATTLE_UNIT_TYPE.NORMAL_ENEMY, x, y, z or 0)
  unit.isMonster = true
  return unit
end
function Populate(monsters)
  local scene = MiniGameBattleScene
  scene.aliveMonsterList = monsters
  for _, monster in ipairs(monsters) do
    scene.unitByUid[monster.uid] = monster
  end
end
function ResetWork()
  CopyCount, SortCount = 0, 0
end

local getDeduceList = MiniGameBattleBuffMgr.GetListenerDeduceList
DeduceSearches = 0
function MiniGameBattleBuffMgr.GetListenerDeduceList(...)
  DeduceSearches = DeduceSearches + 1
  return getDeduceList(...)
end
HpDeduce = MINI_GAME_BUFF_DEDUCE_TYPE.SETTLE_HP_LESS
function RegisterHp(uid, unit, onDeduce, onRemove)
  local mgr = MiniGameBattleBuffMgr
  local buff = {uid=uid,toUnitUid=unit.uid,deduceType=HpDeduce,Deduce=onDeduce}
  function buff:Remove()
    mgr.UnRegisterDeduceListener(self.uid, self.deduceType)
    mgr.RemoveFromBuffList(self.uid)
    local owner = MiniGameBattleSceneMgr.GetUnitByUid(self.toUnitUid)
    owner.buffUidList[self.uid] = nil
    if onRemove then onRemove() end
  end
  mgr.AddToBuffList(buff)
  mgr.RegisterDeduceListener(buff)
  unit.buffUidList[uid] = 1
  return buff
end`;

let scratch: string;
let vendor: string;
let factory: { createEngine(options: object): Promise<LuaEngineLike> };
let lua: LuaEngineLike;

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'battle-unit-lua-'));
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
  for (const source of originalSources) await lua.doString(source);
  await lua.doString(`MathUtil=(function()\n${mathSource}\nend)()`);
  await lua.doString(fixtures);
  await lua.doString(BATTLE_UNIT_OPTIMIZATION);
  await lua.doString(BATTLE_UNIT_HP_LISTENERS);
});

afterEach(() => lua.global.close());

test('reselects the lowest X then highest Y while copying only the selected unit', async () => {
  const work = await lua.doString(`
    local card, reference = Card(1), Card(2,true)
    local monsters = {Enemy(31,22,10), Enemy(32,12,5), Enemy(33,12,12), Enemy(34,19,8)}
    Populate(monsters)
    assert(reference:GetAttackTarget().uid == 33)
    ResetWork()
    local target = card:GetAttackTarget()
    assert(target.uid == 33 and target ~= monsters[3])
    assert(target.position ~= monsters[3].position and target.hitPosition ~= monsters[3].hitPosition)
    target.position.x = -500
    assert(monsters[3].position.x == 12 and monsters[1].uid == 31)
    return CopyCount .. ':' .. SortCount
  `);
  expect(work).toBe('1:0');
});

test('uses original Lua sort ordering for equal positions while copying only the winner', async () => {
  const work = await lua.doString(`
    local card, reference = Card(1), Card(2,true)
    Populate({Enemy(35,5,12,4),Enemy(36,5,12,3),Enemy(37,7,15),Enemy(38,5,12,2),Enemy(39,5,12,1)})
    local original = reference:GetAttackTarget()
    ResetWork()
    local target = card:GetAttackTarget()
    assert(target.uid == original.uid and target.position.z == original.position.z)
    return CopyCount .. ':' .. SortCount
  `);
  expect(work).toBe('1:1');
});

test('rechecks the bound target at the exact range, after movement and on death or removal', async () => {
  await expect(lua.doString(`
    local card, reference = Card(1), Card(2,true)
    local scene = MiniGameBattleScene
    local far, near = Enemy(31,25,0), Enemy(32,18,0)
    Populate({far,near})
    scene.allAliveUnit = {card,reference,far,near}
    local function check(uid)
      local actual, expected = card:GetAttackTarget(), reference:GetAttackTarget()
      assert((actual and actual.uid) == uid and (expected and expected.uid) == uid)
      assert(card.attackTargetUid == reference.attackTargetUid)
    end
    local function bind(unit)
      card:SetAttackTargetUid(unit.uid)
      reference:SetAttackTargetUid(unit.uid)
    end
    bind(far)
    check(nil) -- Preserve the original no-result branch when already bound and in range.
    far:SavePosition(25.0001,0,0)
    check(32)
    assert(card.attackTargetUid == nil)
    bind(far)
    far:SetState(BATTLE_STATE_ENUM.DEAD)
    table.remove(scene.aliveMonsterList,1)
    check(32)
    bind(near)
    MiniGameBattleSceneMgr.RemoveFromAliveList(near)
    MiniGameBattleSceneMgr.DealClearTarget(near)
    MiniGameBattleSceneMgr.RemoveUnit(near)
    table.remove(scene.aliveMonsterList,1)
    check(nil)
    scene.wallUnit = Unit(3,MINI_GAME_BATTLE_UNIT_TYPE.WALL,-320,0,0)
    assert(far:GetAttackTarget() == scene.wallUnit)
    return true
  `)).resolves.toBe(true);
});

test('finds single nearest and farthest choices with native exclusions and tie ordering', async () => {
  const work = await lua.doString(`
    Populate({Enemy(41,5,8),Enemy(42,5,8),Enemy(43,7,8),Enemy(44,9,9),Enemy(45,9,10)})
    local choose = MiniGameBattleChoose
    local excluded = {first=41,second=42}
    local standardNearest = OriginalNearest(1,excluded)[1]
    local standardTied = OriginalNearest()[1]
    local standardFarthest = OriginalFarthest()
    local standardMany = OriginalNearest(2,excluded)
    ResetWork()
    assert(choose.GetNearestMonster(1,excluded)[1].uid == standardNearest.uid)
    assert(choose.GetNearestMonster()[1].uid == standardTied.uid)
    assert(choose.GetOneFarthestMonster().uid == standardFarthest.uid)
    local work = CopyCount .. ':' .. SortCount
    local many = choose.GetNearestMonster(2,excluded)
    assert(many[1].uid == standardMany[1].uid and many[2].uid == standardMany[2].uid)
    assert(#choose.GetNearestMonster(1,{41,42,43,44,45}) == 0)
    Populate({})
    assert(#choose.GetNearestMonster() == 0 and choose.GetOneFarthestMonster() == nil)
    return work
  `);
  expect(work).toBe('3:1');
});

test('skips native HP listener scans for unsubscribed units and reuses the ordered list for subscribed units', async () => {
  const searches = await lua.doString(`
    local subscribed, empty = Enemy(31,0,0), Enemy(32,0,0)
    Populate({subscribed,empty})
    MiniGameBattleBuffMgr.Init()
    local hits = 0
    RegisterHp(1, subscribed, function() hits = hits + 1 end)
    for i = 1, 4 do
      empty:Update()
      subscribed:Update()
    end
    assert(hits == 4)
    return DeduceSearches
  `);
  expect(searches).toBe(1);
});

test('HP listener changes during a callback take effect in the next dispatch in registration order', async () => {
  const order = await lua.doString(`
    local owner, other = Enemy(31,0,0), Enemy(32,0,0)
    local mgr, events = MiniGameBattleBuffMgr, {}
    Populate({owner,other})
    mgr.Init()
    local removed, moving
    RegisterHp(1, owner, function(self)
      events[#events+1] = 'first'
      self:Remove()
      removed:Remove()
      RegisterHp(4, owner, function() events[#events+1] = 'new' end)
      other.buffUidList[moving.uid] = nil
      owner.buffUidList[moving.uid] = 1
      moving.toUnitUid = owner.uid
      mgr.RefreshRegisterDeduceListener(moving)
      mgr.TriggerUnitListener(owner, HpDeduce)
    end)
    removed = RegisterHp(2, owner, function() error('removed buff was called') end)
    moving = RegisterHp(3, other, function() events[#events+1] = 'moved' end)
    other:SetFreeze(true)
    other:Update()
    owner:Update()
    assert(table.concat(events,',') == 'first,moved,new')
    other:SetFreeze(false)
    other:Update()
    owner:Update()
    return table.concat(events,',')
  `);
  expect(order).toBe('first,moved,new,moved,new');
});

test('a thawed unit gets its last HP callback and death clears its remaining registrations', async () => {
  const order = await lua.doString(`
    local owner = Enemy(31,0,0)
    local mgr, events = MiniGameBattleBuffMgr, {}
    Populate({owner})
    mgr.Init()
    RegisterHp(1, owner, function(self)
      events[#events+1] = 'last'
      self:Remove()
    end)
    RegisterHp(2, owner, function() events[#events+1] = 'remaining' end,
      function() events[#events+1] = 'death removal' end)
    owner:SetFreeze(true)
    owner:Update()
    owner:SetFreeze(false)
    owner:Update()
    owner:SetStateToDead()
    owner:Update()
    assert(MiniGameBattleData.killEnemyCount == 1)
    mgr.Init()
    owner:Update()
    return table.concat(events,',')
  `);
  expect(order).toBe('last,remaining,death removal');
});

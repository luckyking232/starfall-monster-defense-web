-- Installed in the diagnostic Wasmoon instance after the player host initializes.
local events, battleRngIndex, luaRngIndex = {}, 0, 0
local stage1Draws

local function record(kind, object, details)
  details = details or {}
  details.type = kind
  details.object = object
  details.frame = MiniGameBattleControl.curFixedFrame or 0
  events[#events + 1] = details
  return details
end

-- Preserve enough digits to distinguish adjacent floating-point values. The
-- presentation bridge's JSON encoder rounds some rule coordinates.
local function encode(value)
  if type(value) == 'number' then
    assert(value == value and value < math.huge and value > -math.huge, 'non-finite rule state')
    if math.type(value) == 'integer' then return tostring(value) end
    return string.format('%.17g', value)
  end
  if type(value) ~= 'table' then return __JsonEncode(value) end
  local parts = {}
  if #value > 0 or next(value) == nil then
    for i, item in ipairs(value) do parts[i] = encode(item) end
    return '[' .. table.concat(parts, ',') .. ']'
  end
  local keys = {}
  for key in pairs(value) do keys[#keys + 1] = key end
  table.sort(keys)
  for i, key in ipairs(keys) do parts[i] = __JsonEncode(key) .. ':' .. encode(value[key]) end
  return '{' .. table.concat(parts, ',') .. '}'
end

local function uidOrder(a, b) return a.uid < b.uid end
local function vector(position)
  if not position then return false end
  return {position.x, position.y, position.z or 0}
end
local function sortedIds(map)
  local ids = {}
  for uid in pairs(map or {}) do ids[#ids + 1] = uid end
  table.sort(ids)
  return ids
end

local casters = setmetatable({}, {__mode = 'k'})
local function state()
  local control, data, scene = MiniGameBattleControl, MiniGameBattleData, MiniGameBattleScene
  local units, bullets, buffs = {}, {}, {}
  for _, unit in ipairs(scene.allUnit or {}) do
    if unit.id and not unit:IsDestroy() then
      units[#units + 1] = {uid = unit.uid, id = unit.id, position = vector(unit.position), hp = unit:GetHp(),
        target = unit.attackTargetUid, state = unit.curState, buffs = sortedIds(unit.buffUidList), camp = unit.camp,
        nextAttackFrame = unit.nextAttackFrame, lastSkillFrame = unit.lastSkillFrame,
        frozen = unit.isFreeze, stopped = unit.isTimePause}
    end
  end
  for _, bullet in ipairs(scene.allBullet or {}) do
    bullets[#bullets + 1] = {uid = bullet.uid, skill = bullet.skillId, caster = casters[bullet],
      position = vector(bullet.position), destination = vector(bullet.endPosition),
      radius = bullet.coverRadiusR, buffs = sortedIds(bullet.buffUidList), struck = sortedIds(bullet.hurtUidList),
      hitCount = bullet.hurtIndex, delay = bullet.delayFrame}
  end
  for _, buff in pairs(MiniGameBattleBuffMgr.GetSavedBuffList()) do
    buffs[#buffs + 1] = {uid = buff.uid, id = buff.id, source = buff.fromUnitUid, target = buff.toUnitUid,
      bullet = buff.toBulletUid, state = buff.curState, stacks = buff.overlayNum, remaining = buff.remainFrames,
      settleFrame = buff.settleFrame, lastDeduceFrame = buff.lastDeduceFrame, deduceCount = buff.deduceCount}
  end
  table.sort(units, uidOrder)
  table.sort(bullets, uidOrder)
  table.sort(buffs, uidOrder)
  return {units = units, bullets = bullets, buffs = buffs, stage = data.stageId, wave = scene.curMonsterWave,
    aliveMonsters = #scene.aliveMonsterList, kills = data.killEnemyCount, wallHp = data.selfHp, level = data.curLevel,
    exp = data.curExp, randomIndex = data.curRandomIndex, paused = control.isPause, over = control.isOver,
    speed = data.speedIndex}
end

local function emit(kind, snapshot)
  __RuleTraceEmit(encode({kind = kind, frame = MiniGameBattleControl.curFixedFrame or 0,
    events = events, state = snapshot}))
  events = {}
end

function __RuleTraceDrain()
  if #events ~= 0 then emit('events') end
end

local mathRandom, mathSeed = math.random, math.randomseed
function math.randomseed(...)
  local first, second = mathSeed(...)
  battleRngIndex, luaRngIndex = 0, 0
  record('seed', 'lua-rng', {value = first, stream = second})
  return first, second
end
function math.random(...)
  local value
  if stage1Draws and stage1Draws < 50 then
    local first, second = ...
    assert(first == 1 and second == 10000, 'stage 1 replay draw changed')
    stage1Draws = stage1Draws + 1
    value = 5000
  else
    value = mathRandom(...)
  end
  luaRngIndex = luaRngIndex + 1
  record('random', 'lua-rng', {index = luaRngIndex, value = value, args = {...}})
  return value
end

local initBattle = MiniGameBattleMgr.InitBattle
function MiniGameBattleMgr.InitBattle(args)
  -- Same fixture as the 4181-frame stage 1 test in ui-host.test.ts.
  if __RuleTraceStage1Fixture then stage1Draws = 0 end
  initBattle(args)
  stage1Draws = nil
end

local getRandom = MiniGameBattleMgr.GetRandom
function MiniGameBattleMgr.GetRandom()
  local value = getRandom()
  battleRngIndex = battleRngIndex + 1
  record('random', 'battle-rng', {index = battleRngIndex, cursor = MiniGameBattleData.curRandomIndex, value = value})
  return value
end

local skillChoice = require('MiniGameSkillChoiceWindow')
local randomSkillList = skillChoice.RandomSkillList
function skillChoice.RandomSkillList(level)
  local choices = randomSkillList(level)
  local options = {}
  for index, skill in ipairs(choices) do options[index] = {skill = skill.id, unit = skill.unit.uid} end
  record('offer', 'choice', {level = level, options = options})
  return choices
end

local newUnit, addUnit = MiniGameBattleUnit.NewUnit, MiniGameBattleSceneMgr.AddUnit
function MiniGameBattleUnit.NewUnit(...)
  local unit = newUnit(...)
  local saveSkill, setState = unit.SaveSkill, unit.SetState
  function unit:SaveSkill(skill)
    record('learn', 'unit:' .. self.uid, {skill = skill})
    return saveSkill(self, skill)
  end
  function unit:SetState(nextState, ...)
    if nextState == BATTLE_STATE_ENUM.DEAD and self.curState ~= nextState then
      record('dead', 'unit:' .. self.uid)
    end
    return setState(self, nextState, ...)
  end
  return unit
end
function MiniGameBattleSceneMgr.AddUnit(data)
  local uid = MiniGameBattleScene.unitGlobalIndex + 1
  local event = record('spawn', 'unit:' .. uid)
  local unit = addUnit(data)
  event.id, event.camp, event.position = unit.id, unit.camp, vector(unit.position)
  return unit
end

local dealDying = MiniGameBattleAction.DealDying
function MiniGameBattleAction.DealDying(unit)
  record('dying', 'unit:' .. unit.uid)
  return dealDying(unit)
end
local addBullet, removeBullet = MiniGameBattleSceneMgr.AddBullet, MiniGameBattleSceneMgr.RemoveBullet
function MiniGameBattleSceneMgr.AddBullet(attackUnit, ...)
  local uid = MiniGameBattleScene.unitGlobalIndex + 1
  local event = record('spawn', 'bullet:' .. uid, {caster = attackUnit.uid})
  local bullet = addBullet(attackUnit, ...)
  event.skill = bullet.skillId
  casters[bullet] = attackUnit.uid
  local hit = bullet.DealHurt
  function bullet:DealHurt(unit)
    record('hit', 'bullet:' .. self.uid, {target = unit.uid, skill = self.skillId, alive = unit:IsAlive()})
    return hit(self, unit)
  end
  return bullet
end
function MiniGameBattleSceneMgr.RemoveBullet(bullet)
  record('remove', 'bullet:' .. bullet.uid)
  return removeBullet(bullet)
end

local dealHurt, dealSkill = MiniGameBattleAction.DealHurt, MiniGameBattleAction.DealUnitSkill
local getSkillHurt = MiniGameBattleDataCount.GetSkillHurt
function MiniGameBattleDataCount.GetSkillHurt(attacker, target, skill)
  local calculated, flags = getSkillHurt(attacker, target, skill)
  record('skill-hit', 'unit:' .. attacker.uid, {target = target.uid, skill = skill.id,
    calculated = calculated, critical = flags.isCrit == true})
  return calculated, flags
end
function MiniGameBattleAction.DealHurt(attacker, target, requested, display, flags, effect)
  local event = record('damage', 'unit:' .. target.uid,
    {source = attacker and attacker.uid, requested = requested, critical = flags and flags.isCrit == true or false})
  local value = dealHurt(attacker, target, requested, display, flags, effect)
  event.final, event.hp = value, target:GetHp()
  return value
end
function MiniGameBattleAction.DealUnitSkill(unit, skill, target)
  local event = record('skill', 'unit:' .. unit.uid, {skill = skill, target = target})
  local applied = dealSkill(unit, skill, target)
  event.applied = applied
  return applied
end

local newBuff, addBuff, removeBuff = MiniGameBattleBuff.NewBuff, MiniGameBattleBuffMgr.AddToBuffList,
  MiniGameBattleBuffMgr.RemoveFromBuffList
function MiniGameBattleBuff.NewBuff(...)
  local buff = newBuff(...)
  -- Initial settlement can occur before the factory returns; buff-add and
  -- the state snapshot also cover buffs that settle immediately.
  local settle, deduce = buff.Settle, buff.Deduce
  function buff:Settle(...)
    record('buff-settle', 'buff:' .. self.uid, {id = self.id, target = self.toUnitUid})
    return settle(self, ...)
  end
  function buff:Deduce(...)
    record('buff-deduce', 'buff:' .. self.uid, {id = self.id, target = self.toUnitUid})
    return deduce(self, ...)
  end
  return buff
end
function MiniGameBattleBuffMgr.AddToBuffList(buff)
  record('buff-add', 'buff:' .. buff.uid, {id = buff.id, source = buff.fromUnitUid, target = buff.toUnitUid,
    bullet = buff.toBulletUid})
  return addBuff(buff)
end
function MiniGameBattleBuffMgr.RemoveFromBuffList(uid)
  record('buff-remove', 'buff:' .. uid)
  return removeBuff(uid)
end

local pause, resume = MiniGameBattleControl.Pause, MiniGameBattleControl.Continue
function MiniGameBattleControl.Pause(...)
  local previous = MiniGameBattleControl.isPause
  pause(...)
  if not previous and MiniGameBattleControl.isPause then record('pause', 'battle') end
end
function MiniGameBattleControl.Continue(...)
  local previous = MiniGameBattleControl.isPause
  resume(...)
  if previous and not MiniGameBattleControl.isPause then record('resume', 'battle') end
end

local stop = MiniGameBattleControl.Stop
function MiniGameBattleControl.Stop(...)
  if not MiniGameBattleControl.isOver then
    local scene, data = MiniGameBattleScene, MiniGameBattleData
    record('settlement', 'battle', {stage = data.stageId, win = scene.isBattleWin, loss = scene.isBattleLoss,
      kills = data.killEnemyCount, wave = scene.curMonsterWave, wallHp = data.selfHp})
  end
  return stop(...)
end

local addFixed, removeFixed = UpdateManager.AddFixedUpdateHandler, UpdateManager.RemoveFixedUpdateHandler
local originalFixed, tracedFixed
function UpdateManager.AddFixedUpdateHandler(callback)
  originalFixed = callback
  tracedFixed = function(...)
    callback(...)
    if __RuleTraceExtraRandomFrame == MiniGameBattleControl.curFixedFrame then MiniGameBattleMgr.GetRandom() end
    emit('fixed', state())
  end
  addFixed(tracedFixed)
end
function UpdateManager.RemoveFixedUpdateHandler(callback)
  if originalFixed == callback then
    removeFixed(tracedFixed)
    originalFixed, tracedFixed = nil, nil
  else
    removeFixed(callback)
  end
end

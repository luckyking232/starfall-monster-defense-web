-- Diagnostic capability only. Unchanged original Lua owns config, RNG, spawn, frame and pause.
local stageId, events, exhausted
local originalDataInit = InitMiniGameBattleData
local nativeProcess = MiniGameBattleControl.UpdateProcess
local nativePause, nativeContinue = MiniGameBattleControl.Pause, MiniGameBattleControl.Continue
local nativeInitUnits = MiniGameBattleSceneMgr.InitUnit
local nativePosition = MiniGameBattleSceneMgr.GetInitPosition
local speedScale = 1
math.round = function(value) return math.floor(value + 0.5) end -- authored Util.lua
function Split(str, sep)
  local r = {}
  for piece in str:gmatch("[^" .. sep .. "]+") do r[#r + 1] = piece end
  return r
end
function SimpleCopy(t)
  local r = {}
  for k, v in pairs(t or {}) do r[k] = v end
  return r
end
function print(...) end
function printError(...) error("native game RNG rejected the tape", 2) end
TableData = {
  GetConfig = function(id, name)
    if name == "BaseShootStage" then return BaseShootStage[id] end
    if name == "BaseShootCard" then return BaseShootCard[id] end
    error("unclosed config dependency " .. tostring(name), 2)
  end,
  GetTable = function(name)
    assert(name == "BaseShootMonsterGroup", "unclosed table dependency")
    return BaseShootMonsterGroup
  end
}
PlayerPrefsUtil = {GetInt = function(_, default) return default end}
PLAYER_PREF_ENUM = {MINI_GAME_BATTLE_SPEED = "MINI_GAME_BATTLE_SPEED"}
PLAYER_PREF_DEFAULT_VALUE = {MINI_GAME_BATTLE_SPEED = 1}
WinResConfig = {MiniGameBattleUIWindow = {name = "BattleUIWindow"}}
WindowMsgEnum = {MiniGameBattleUIWindow = {E_MSG_CHANGE_WAVE = 6}}
UIMgr = {SendWindowMessage = function() end, IsWindowOpen = function() return true end}
LoginData = {SetTimeScale = function(value) speedScale = value end}

-- Engine substitutions are scoped to spawn-audit only. Do not invoke a false live victory
-- from an empty diagnostic alive list or substitute test models for real combat.
MiniGameBattleSceneMgr.UpdateProcess = function() end
MiniGameBattleSceneMgr.UpdateBattleOverState = function() end
MiniGameBattleSceneMgr.AddUnit = function(data)
  local card = assert(TableData.GetConfig(data.id, "BaseShootCard"), "unknown card")
  local x, y, z = nativePosition(data.positionIndex)
  return {battleUnitType = card.type, position = {x = x, y = y, z = z}}
end
MiniGameBattleSceneMgr.AddMonster = function(id, pos, hp, exp)
  local s = MiniGameBattleScene
  local ord = s.curMonsterGroupIndex - (s.curIndexInGroup >= #s.curMonsterList and 1 or 0)
  local n = #s.normalMonsterGroup
  local row = ord <= n and s.normalMonsterGroup[ord]
    or s.loopMonsterGroup[(ord - n - 1) % #s.loopMonsterGroup + 1]
  local x, y, z = nativePosition(pos)
  local fields = {
    stageId, MiniGameBattleControl.curFixedFrame, "spawn", s.curMonsterWave, row.id, ord,
    id, pos, hp, exp, MiniGameBattleData.curRandomIndex, x, y, z
  }
  events[#events + 1] = table.concat(fields, ",")
end
function localAuditInit(id, rawTape)
  local cfg = assert(BaseShootStage[id], "no authored stage")
  local tape = {}
  for value in rawTape:gmatch("%d+") do tape[#tape + 1] = tonumber(value) end
  assert(#tape == 50, "fifty RNG values required")
  for _, value in ipairs(tape) do assert(value >= 1 and value <= 10000, "RNG value out of range") end
  -- Original initializer asks Lua for 50 values; supply the captured vector at that
  -- input seam only. Subsequent RNG/mapping code stays upstream.
  local rng = math.random
  local i = 0
  math.random = function(low, high)
    assert(low == 1 and high == 10000, "unexpected RNG initializer request")
    i = i + 1
    assert(tape[i], "unexpected additional initializer RNG draw")
    return tape[i]
  end
  local ok, err = pcall(originalDataInit, {stageId = id})
  math.random = rng
  assert(ok, err)
  assert(i == 50, "unexpected short RNG consumption")
  stageId, events, exhausted = id, {}, false
  ClearMiniGameBattleScene()
  local s = MiniGameBattleScene
  s.mapXCount, s.mapYCount = cfg.size[1], cfg.size[2]
  s.initX = -s.mapXCount * s.ceilLength / 2
  s.initY = s.mapYCount * s.ceilLength / 2 + s.initY_offset
  nativeInitUnits()
  MiniGameBattleControl.Init()
  speedScale = MiniGameBattleControl.baseTimeScale
  assert(BATTLE_CONFIG_ENUM.FIXED_FPS == 30)
  return _VERSION
end
function localAuditSnapshot()
  return table.concat({stageId, MiniGameBattleControl.curFixedFrame, MiniGameBattleScene.curMonsterWave,
    MiniGameBattleData.curRandomIndex, MiniGameBattleControl.isPause and 1 or 0, exhausted and 1 or 0,
    MiniGameBattleScene.isLoopStage and 1 or 0, speedScale}, ",")
end
function localAuditStep(count)
  if not exhausted then
    for _ = 1, count do
      nativeProcess()
      if MiniGameBattleScene.allMonsterCreate then
        exhausted = true
        events[#events + 1] = table.concat(
          {stageId, MiniGameBattleControl.curFixedFrame, "all-spawned", MiniGameBattleScene.curMonsterWave}, ",")
        break
      end
    end
  end
  local result = table.concat(events, "\n")
  events = {}
  return result
end
function localAuditPause() nativePause(); return localAuditSnapshot() end
function localAuditResume() nativeContinue(); return localAuditSnapshot() end
function localAuditSpeed(speed)
  assert(speed == 1 or speed == 2)
  MiniGameBattleControl.baseTimeScale = speed
  if not MiniGameBattleControl.isPause then LoginData.SetTimeScale(speed) end
  return localAuditSnapshot()
end

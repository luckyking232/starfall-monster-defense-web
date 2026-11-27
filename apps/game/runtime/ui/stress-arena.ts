import { STRESS_STAGE } from '../../src/content/stress-stage';

export const STRESS_ARENA_LUA = String.raw`
local sceneMgr = MiniGameBattleSceneMgr
local originalInitUnit = sceneMgr.InitUnit
local originalCreateMonster = sceneMgr.CreateMonster
local originalClose = MiniGameBattleMgr.CloseBattle

function sceneMgr.InitUnit()
  originalInitUnit()
  local data = MiniGameBattleData
  if not data.stress then return end
  data.levelMax = true
  data.stressSpawned = 0
  __HostCall('battle.stressLoadout', __JsonEncode(StressLoadoutApply()))

  -- Only this run's wall recovers from a fatal hit. Damage, effects and the enemy's
  -- original attack still go through the usual methods.
  local wall = MiniGameBattleScene.wallUnit
  local changeAttr = wall.ChangeAttr
  function wall:ChangeAttr(name, delta)
    if name == ATTR_ENUM.hp and self:GetHp() + delta <= 0 then
      changeAttr(self, name, 1 - self:GetHp())
      changeAttr(self, name, self:GetAttr(ATTR_ENUM.max_hp) - 1)
    else
      changeAttr(self, name, delta)
    end
  end
end

function sceneMgr.CreateMonster()
  local data, scene = MiniGameBattleData, MiniGameBattleScene
  if not data.stress then return originalCreateMonster() end

  local tier = 1 + math.floor(MiniGameBattleControl.curFixedFrame / ${STRESS_STAGE.tierFrames})
  local target = math.min(${STRESS_STAGE.maxMonsters}, ${STRESS_STAGE.initialMonsters} * tier)
  local wave = target // ${STRESS_STAGE.initialMonsters}
  if wave ~= scene.curMonsterWave then
    scene.curMonsterWave = wave
    UIMgr:SendWindowMessage(WinResConfig.MiniGameBattleUIWindow.name, WindowMsgEnum.MiniGameBattleUIWindow.E_MSG_CHANGE_WAVE)
  end

  local count = math.min(${STRESS_STAGE.spawnPerFrame}, target - #scene.aliveMonsterList)
  for _ = 1, count do
    local index = data.stressSpawned + 1
    data.stressSpawned = index
    local id = 78000201 + (index - 1) % 4
    local addedHp = index % 4 == 0 and 290000 or 90000
    -- Spread entrants across the original map's nine lanes and several depths.
    local row = 1 + (index * 5 + (index // 9) * 3) % 9
    local column = 16 + (index * 7 + (index // 13) * 2) % 12
    -- Nearer elites 78000205 and 78000206 can attack under the full loadout.
    -- Exclude boss 78000207 because its native summon adds five enemies outside this budget.
    if index % 13 == 0 then
      id = 78000205 + (index // 13) % 2
      column = 8 + index % 4
      addedHp = 290000
    end
    sceneMgr.AddMonster(id, column * 100 + row, addedHp, 0)
  end
end

function MiniGameBattleMgr.CloseBattle(...)
  local stress = MiniGameBattleData.stress
  originalClose(...)
  if stress then MiniGameBattleBackground.Clear() end
end
`;

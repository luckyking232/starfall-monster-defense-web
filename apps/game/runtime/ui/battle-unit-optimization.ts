// Installed after the verified original modules, before the first battle creates units.
export const BATTLE_UNIT_OPTIMIZATION = String.raw`
local choose = MiniGameBattleChoose
local originalNearest = choose.GetNearestMonster
local originalUnit = MiniGameBattleUnit.NewUnit

local function nearestFirst(a, b)
  local ap, bp = a.position, b.position
  if ap.x == bp.x then return ap.y > bp.y end
  return ap.x < bp.x
end

local function farthestFirst(a, b)
  local ap, bp = a.position, b.position
  if ap.x == bp.x then return ap.y > bp.y end
  return ap.x > bp.x
end

local function findMonster(farthest, excluded)
  local monsters = MiniGameBattleScene.aliveMonsterList
  local best, bestX, bestY, tied
  for i = 1, #monsters do
    local monster = monsters[i]
    if excluded == nil or table.contain(excluded, monster.uid) == false then
      local x, y = monster.position.x, monster.position.y
      if best == nil or (x == bestX and y > bestY) or
        (farthest and x > bestX) or (not farthest and x < bestX) then
        best, bestX, bestY, tied = monster, x, y, false
      elseif x == bestX and y == bestY then
        tied = true
      end
    end
  end
  if tied then
    -- Lua sort does not preserve input order for equal coordinates. Sort the same full
    -- sequence with the original comparator, including excluded units, before picking.
    local ordered = table.move(monsters, 1, #monsters, 1, {})
    table.sort(ordered, farthest and farthestFirst or nearestFirst)
    for i = 1, #ordered do
      local monster = ordered[i]
      if excluded == nil or table.contain(excluded, monster.uid) == false then
        return monster
      end
    end
  end
  return best
end

local function getCardAttackTarget(unit)
  if unit.attackTargetUid then
    local target = MiniGameBattleSceneMgr.GetUnitByUid(unit.attackTargetUid)
    if target:IsAlive() == false or unit:IsTargetInAttackRange(target) == false then
      unit.attackTargetUid = nil
    end
  end
  if unit.attackTargetUid == nil then
    local target = findMonster(false)
    -- The original returns a detached snapshot. Copy just the chosen unit.
    if target then return SimpleCopy(target) end
  end
end

function MiniGameBattleUnit.NewUnit(data)
  local unit = originalUnit(data)
  if unit.battleUnitType == MINI_GAME_BATTLE_UNIT_TYPE.CARD then
    unit.GetAttackTarget = getCardAttackTarget
  end
  return unit
end

function choose.GetNearestMonster(numLimit, excluded)
  if numLimit ~= nil and numLimit ~= false and numLimit ~= 1 then
    return originalNearest(numLimit, excluded)
  end
  local target = findMonster(false, excluded)
  if target then return {SimpleCopy(target)} end
  return {}
end

function choose.GetOneFarthestMonster()
  local target = findMonster(true)
  if target then return SimpleCopy(target) end
end
`;

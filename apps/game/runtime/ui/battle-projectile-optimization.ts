// Install after the verified original combat modules and the browser platform.
export const BATTLE_PROJECTILE_OPTIMIZATION = String.raw`
local PROJECTILE_GRID_CELL = 64
local GRID_STRIDE = 256
local MIN_MONSTERS, MIN_BULLETS = 32, 12
local MAX_COORDINATE, MAX_RADIUS = 4096, 128
-- Native TruncateFloat drops four fractional digits of the 3D distance.
-- Allow twice that rounding interval, including floating-point rounding at cell boundaries.
local DISTANCE_MARGIN = 0.0002
local floor, sort = math.floor, table.sort
local sceneMgr = MiniGameBattleSceneMgr
local choose = MiniGameBattleChoose
local originalProcess, originalAddUnit = sceneMgr.UpdateProcess, sceneMgr.AddUnit
local originalNewUnit = MiniGameBattleUnit.NewUnit
local originalNewBullet = MiniGameBattleBullet.NewBullet
local originalNearest = choose.GetNearestMonsterForCenterUnit
local cells, ranks, seen = {}, {}, {}
local processing, indexedList, indexedCount, usable
local gridVersion, searchVersion = 0, 0

local function descending(a, b) return a > b end

local function supported(position, radius, radiusLimit)
  return type(radius) == 'number' and radius >= 0 and radius <= radiusLimit
    and math.abs(position.x) <= MAX_COORDINATE and math.abs(position.y) <= MAX_COORDINATE
    and math.abs(position.z) <= MAX_COORDINATE
end

local function rebuild(list, count)
  indexedList, indexedCount = list, count
  gridVersion = gridVersion + 1
  for i = count, 1, -1 do
    local monster = list[i]
    local radius, position = monster.coverRadiusR, monster.position
    if radius then
      if not supported(position, radius, MAX_RADIUS) then return false end
      local minX = floor((position.x - radius) / PROJECTILE_GRID_CELL)
      local maxX = floor((position.x + radius) / PROJECTILE_GRID_CELL)
      local minY = floor((position.y - radius) / PROJECTILE_GRID_CELL)
      local maxY = floor((position.y + radius) / PROJECTILE_GRID_CELL)
      for y = minY, maxY do
        local offset = y * GRID_STRIDE
        for x = minX, maxX do
          local key = offset + x
          local bucket = cells[key]
          if not bucket then
            bucket = {version = gridVersion, count = 0}
            cells[key] = bucket
          elseif bucket.version ~= gridVersion then
            bucket.version, bucket.count = gridVersion, 0
          end
          local index = bucket.count + 1
          bucket[index], bucket.count = i, index
        end
      end
    end
  end
  return true
end

local function filter(bullet, list, candidates, count)
  local hits = {}
  local previousHits = bullet.hurtUidList
  for i = 1, count do
    local monster = list[candidates[i]]
    if previousHits[monster.uid] == nil and bullet:IsTargetHit(monster) then
      hits[#hits + 1] = monster
    end
  end
  return hits
end

local function findHits(bullet, list, count)
  local position, radius = bullet.position, bullet.coverRadiusR
  if not supported(position, radius, PROJECTILE_GRID_CELL) then return nil end
  if indexedList ~= list or indexedCount ~= count then usable = rebuild(list, count) end
  if not usable then return nil end

  local padded = radius + DISTANCE_MARGIN
  local minX = floor((position.x - padded) / PROJECTILE_GRID_CELL)
  local maxX = floor((position.x + padded) / PROJECTILE_GRID_CELL)
  local minY = floor((position.y - padded) / PROJECTILE_GRID_CELL)
  local maxY = floor((position.y + padded) / PROJECTILE_GRID_CELL)
  if minX == maxX and minY == maxY then
    local bucket = cells[minY * GRID_STRIDE + minX]
    if not bucket or bucket.version ~= gridVersion then return {} end
    return filter(bullet, list, bucket, bucket.count)
  end

  searchVersion = searchVersion + 1
  local n = 0
  for y = minY, maxY do
    for x = minX, maxX do
      local bucket = cells[y * GRID_STRIDE + x]
      if bucket and bucket.version == gridVersion then
        for i = 1, bucket.count do
          local index = bucket[i]
          if seen[index] ~= searchVersion then
            n = n + 1
            ranks[n], seen[index] = index, searchVersion
          end
        end
      end
    end
  end
  for i = #ranks, n + 1, -1 do ranks[i] = nil end
  -- Duplicates and bucket order are internal. Native list ranks set hit order.
  sort(ranks, descending)
  return filter(bullet, list, ranks, n)
end

function sceneMgr.UpdateProcess()
  -- Projectiles run after unit movement and before the original monster cleanup.
  processing = true
  originalProcess()
  processing, indexedList = false, nil
end

function MiniGameBattleUnit.NewUnit(...)
  local unit = originalNewUnit(...)
  if unit.camp == BATTLE_CAMP_FLAG.RIGHT then
    local savePosition = unit.SavePosition
    function unit:SavePosition(...)
      indexedList = nil
      return savePosition(self, ...)
    end
  end
  return unit
end

function sceneMgr.AddUnit(data)
  -- A native right-side summon can clamp the caller's position table in place.
  local clampsPosition = data.position and data.camp == BATTLE_CAMP_FLAG.RIGHT and data.summonFromUnitId
  if clampsPosition then indexedList = nil end
  local unit = originalAddUnit(data)
  if clampsPosition then indexedList = nil end
  return unit
end

function MiniGameBattleBullet.NewBullet(...)
  local bullet = originalNewBullet(...)
  local scan = bullet.GetHurtMonsterList
  function bullet:GetHurtMonsterList()
    local scene = MiniGameBattleScene
    local list = scene.aliveMonsterList
    local count = #list
    if processing and count >= MIN_MONSTERS and #scene.allBullet >= MIN_BULLETS then
      -- Original spawns and boss summons insert at the front. Cleanup removes entries.
      local hits = findHits(self, list, count)
      if hits then return hits end
    end
    return scan(self)
  end
  return bullet
end

local function closer(a, b)
  if a.distance == b.distance then return a.x < b.x end
  return a.distance < b.distance
end

function choose.GetNearestMonsterForCenterUnit(center, limit, excluded)
  local monsters = MiniGameBattleScene.aliveMonsterList
  if #monsters < 2 then return originalNearest(center, limit, excluded) end
  local candidates = {}
  local position = center.position
  for i = 1, #monsters do
    local monster = monsters[i]
    local target = monster.position
    candidates[i] = {monster = monster, x = target.x,
      distance = MathUtil.GetVector3Module(MathUtil.GetVector3Subtract(target, position))}
  end
  -- Keep the sort's original initial order and comparison for equal keys.
  sort(candidates, closer)
  local result = {}
  limit = limit or 1
  for i = 1, #candidates do
    local monster = candidates[i].monster
    if excluded == nil or table.contain(excluded, monster.uid) == false then
      result[#result + 1] = SimpleCopy(monster)
      if limit <= #result then break end
    end
  end
  return result
end
`;

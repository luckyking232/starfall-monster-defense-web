export const UI_TIMERS_LUA = String.raw`
local timers = {}
local componentTweens = {}
local nextId = 0
local scaledMs, unscaledMs = 0, 0
local advancing = false
local function getOwner() return nil end
local function dispatch(_, callback, ...) return callback(...) end

local function isFinite(value)
  return type(value) == 'number' and value == value and math.abs(value) < math.huge
end

function __UiSetTimerContext(ownerGetter, ownerDispatch)
  assert(type(ownerGetter) == 'function' and type(ownerDispatch) == 'function', 'invalid timer context')
  getOwner, dispatch = ownerGetter, ownerDispatch
end

local function clock(timer)
  if timer.unscaled then return unscaledMs end
  return scaledMs
end

local function rate(timer, timeScale)
  if timer.unscaled then return 1 end
  return timeScale
end

local methods = {}
function methods:setIgnoreTimeScale(ignore)
  assert(type(ignore) == 'boolean', 'invalid timer time scale flag')
  local elapsed = clock(self) - self.startMs
  self.unscaled = ignore
  self.startMs = clock(self) - elapsed
  return self
end
methods.SetIgnoreEngineTimeScale = methods.setIgnoreTimeScale

function methods:setOnUpdate(callback)
  assert(type(callback) == 'function', 'invalid timer update callback')
  self.onUpdate = callback
  return self
end

function methods:setOnComplete(callback)
  assert(type(callback) == 'function', 'invalid timer completion callback')
  self.onComplete = callback
  return self
end

local timerMeta = { __index = methods }
local function createTimer(seconds, owner)
  assert(isFinite(seconds) and seconds >= 0 and isFinite(seconds * 1000), 'invalid timer duration')
  nextId = nextId + 1
  local dispatchOwner = getOwner()
  local timer = setmetatable({
    uniqueId = nextId,
    owner = owner,
    dispatchOwner = dispatchOwner,
    startMs = scaledMs,
    durationMs = 1000 * seconds,
    unscaled = false,
  }, timerMeta)
  timers[timer.uniqueId] = timer
  return timer
end

local function value(from, to, seconds, owner)
  assert(isFinite(from) and isFinite(to), 'invalid timer values')
  local timer = createTimer(seconds, owner)
  timer.from, timer.to = from, to
  return timer
end

local function remove(timer)
  timers[timer.uniqueId] = nil
  if componentTweens[timer.owner] == timer then componentTweens[timer.owner] = nil end
  timer.onUpdate, timer.onComplete = nil, nil
end

LeanTween = {
  value = value,
  delayedCall = function(seconds, callback)
    assert(type(callback) == 'function', 'invalid timer completion callback')
    return createTimer(seconds):setOnComplete(callback)
  end,
  cancel = function(id)
    local timer = timers[id]
    if timer then remove(timer) end
  end,
}

function __UiTweenValue(from, to, seconds, onUpdate, owner)
  assert(type(onUpdate) == 'function', 'invalid timer update callback')
  local previous = componentTweens[owner]
  if previous and previous.to == to and isFinite(seconds) and previous.durationMs == seconds * 1000 then return previous end
  local timer = value(from, to, seconds, owner):setOnUpdate(onUpdate)
  if previous then remove(previous) end
  if owner ~= nil then componentTweens[owner] = timer end
  return timer
end

function __UiClearTimers(owner)
  for _, timer in pairs(timers) do
    if owner == nil then
      if timer.owner == nil and timer.dispatchOwner == nil then remove(timer) end
    elseif timer.owner == owner or timer.dispatchOwner == owner then
      remove(timer)
    end
  end
end

function __UiClearTimerOwners(owners)
  for _, timer in pairs(timers) do
    if owners[timer.owner] or owners[timer.dispatchOwner] then remove(timer) end
  end
end

local function invoke(timer, callback, ...)
  if callback then dispatch(timer.dispatchOwner, callback, ...) end
end

local function complete(timer)
  local ok, err = pcall(invoke, timer, timer.onUpdate, timer.to)
  local onComplete = timers[timer.uniqueId] == timer and timer.onComplete
  remove(timer)
  if not ok then error(err, 0) end
  invoke(timer, onComplete)
end

local function nextDue(remainingMs, timeScale, initialId)
  local due, offset
  for id, timer in pairs(timers) do
    local timerRate = rate(timer, timeScale)
    -- Defer a zero-delay timer scheduled by a callback until the next advance.
    if timerRate > 0 and (timer.durationMs > 0 or id <= initialId) then
      local waitMs = math.max(0, timer.durationMs - (clock(timer) - timer.startMs)) / timerRate
      if waitMs <= remainingMs and (not due or waitMs < offset or (waitMs == offset and id < due.uniqueId)) then
        due, offset = timer, waitMs
      end
    end
  end
  return due, offset
end

local function moveClocks(deltaMs, timeScale)
  unscaledMs = unscaledMs + deltaMs
  scaledMs = scaledMs + deltaMs * timeScale
end

local function advance(deltaMs, timeScale)
  local remainingMs, initialId = deltaMs, nextId
  while true do
    local timer, offset = nextDue(remainingMs, timeScale, initialId)
    if not timer then break end
    moveClocks(offset, timeScale)
    remainingMs = remainingMs - offset
    complete(timer)
  end
  moveClocks(remainingMs, timeScale)

  local updates = {}
  for id, timer in pairs(timers) do
    if timer.onUpdate and timer.durationMs > 0 and rate(timer, timeScale) > 0 then
      updates[#updates + 1] = id
    end
  end
  table.sort(updates)
  for _, id in ipairs(updates) do
    local timer = timers[id]
    if timer then
      local progress = math.min(1, (clock(timer) - timer.startMs) / timer.durationMs)
      invoke(timer, timer.onUpdate, timer.from * (1 - progress) + timer.to * progress)
    end
  end
end

function __UiAdvanceTimers(deltaMs, timeScale)
  assert(isFinite(deltaMs) and deltaMs >= 0 and isFinite(timeScale) and timeScale >= 0, 'invalid timer advance')
  assert(isFinite(unscaledMs + deltaMs) and isFinite(scaledMs + deltaMs * timeScale), 'timer clock overflow')
  assert(not advancing, 'timer advance is already in progress')
  if deltaMs == 0 then return end
  advancing = true
  local ok, err = pcall(advance, deltaMs, timeScale)
  advancing = false
  if not ok then error(err, 0) end
end
`;

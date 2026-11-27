// Reuse each unit's ordered HP listener snapshot between subscription changes.
export const BATTLE_UNIT_HP_LISTENERS = String.raw`
local manager = MiniGameBattleBuffMgr
local hpBelowThreshold = MINI_GAME_BUFF_DEDUCE_TYPE.SETTLE_HP_LESS
local originalInit = manager.Init
local originalRegister = manager.RegisterDeduceListener
local originalUnregister = manager.UnRegisterDeduceListener
local originalRefresh = manager.RefreshRegisterDeduceListener
local originalTrigger = manager.TriggerUnitListener
local ownersByBuff, subscribed = {}, {}

local function updateSubscription(uid, delta)
  if not uid then return end
  local entry = subscribed[uid] or {count=0}
  entry.count = entry.count + delta
  entry.ordered = nil
  subscribed[uid] = entry.count > 0 and entry or nil
end

function manager.Init()
  originalInit()
  ownersByBuff, subscribed = {}, {}
end

function manager.RegisterDeduceListener(buff)
  originalRegister(buff)
  if buff.deduceType ~= hpBelowThreshold or buff.uid == nil then return end
  local owners = ownersByBuff[buff.uid] or {}
  local owner = buff.toUnitUid or false
  owners[#owners + 1] = owner
  ownersByBuff[buff.uid] = owners
  updateSubscription(owner, 1)
end

function manager.UnRegisterDeduceListener(uid, deduceType)
  originalUnregister(uid, deduceType)
  if deduceType ~= hpBelowThreshold then return end
  local owners = ownersByBuff[uid]
  if owners then
    updateSubscription(table.remove(owners, 1), -1)
    if #owners == 0 then ownersByBuff[uid] = nil end
  end
end

function manager.RefreshRegisterDeduceListener(buff)
  originalRefresh(buff)
  if buff.deduceType ~= hpBelowThreshold then return end
  local owners = ownersByBuff[buff.uid]
  local owner = buff.toUnitUid or false
  if owners and owners[1] ~= owner then
    updateSubscription(owners[1], -1)
    owners[1] = owner
    updateSubscription(owner, 1)
  end
end

function manager.TriggerUnitListener(unit, deduceType, settleType, deduceParam, settleParam)
  if deduceType ~= hpBelowThreshold or settleType or not unit or not unit.uid then
    return originalTrigger(unit, deduceType, settleType, deduceParam, settleParam)
  end
  local entry = subscribed[unit.uid]
  if not entry then return end
  local ordered = entry.ordered
  if not ordered then
    ordered = manager.GetListenerDeduceList(deduceType, unit.uid)
    entry.ordered = ordered
  end
  -- Keep the native dispatch snapshot. A callback can register, remove or retarget a buff.
  -- Later entries still look up the live buff just before use, as in the original loop.
  if ordered then
    for i = 1, #ordered do
      local buff = manager.savedBuffList[ordered[i]]
      if buff then buff:Deduce(deduceParam) end
    end
  end
end
`;

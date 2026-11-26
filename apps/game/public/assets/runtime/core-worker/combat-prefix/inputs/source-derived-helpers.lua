ProtoEnum = {ATTR_ID = {
    AID_NONE = 0,
    HP = 40000101,
    MAX_HP = 40000102,
    ATK = 40000103,
    DEF = 40000104,
    CRT = 40000201,
    BLK = 40000202,
    EVA = 40000203,
    CRT_INT = 40000204,
    BLK_INT = 40000205,
    SPD_MOVE = 40000301,
    SPD_ATK = 40000302,
    RANGE_ATK = 40000303,
    BLOCK_MAX = 40000304,
    STOIC = 40000305,
    SHIELD = 40000306,
    MAX_RAGE = 40000307,
    RAGE = 40000308,
    RAGE_TIME = 40000309,
    RAGE_ATK = 40000310,
    RAGE_HIT = 40000311,
    RAGE_KILL = 40000313,
    BLOCK_COUNT = 40000314,
    SPD_MOVE_ENHANCE = 40000315,
    SPD_ATK_ENHANCE = 40000316,
    RESTRAINT_ADD1 = 40000401,
    RESTRAINT_ADD2 = 40000402,
    RESTRAINT_ADD3 = 40000403,
    RESTRAINT_ADD4 = 40000404,
    RESTRAINT_ADD5 = 40000405,
    RESTRAINT_SUB1 = 40000406,
    RESTRAINT_SUB2 = 40000407,
    RESTRAINT_SUB3 = 40000408,
    RESTRAINT_SUB4 = 40000409,
    RESTRAINT_SUB5 = 40000410,
    DAMAGE_ADD = 40000411,
    DAMAGE_SUB = 40000412,
    TREAT_ADD = 40000501,
    BE_TREAT_ADD = 40000502,
    TENACITY = 40000601,
    SHIELD_SPECIAL = 40000602
  }}
local s_find,s_len,s_sub=string.find,string.len,string.sub
function table.contain(t, value)
  for k, v in pairs(t) do
    if v == value then
      return true, k
    end
  end
  return false
end

function table.getLen(t)
  local count = 0
  for i, v in pairs(t) do
    if v then
      count = count + 1
    end
  end
  return count
end

function table.randomSort(t)
  if "table" ~= type(t) then
    return
  end
  local _result = {}
  local _index = 1
  while 0 ~= #t do
    local ran = math.random(0, #t)
    if nil ~= t[ran] then
      _result[_index] = t[ran]
      table.remove(t, ran)
      _index = _index + 1
    end
  end
  return _result
end
function table.mapKey2Array(map, sortFunc)
  local array = {}
  for i, v in pairs(map) do
    array[#array + 1] = i
  end
  if sortFunc then
    sortFunc(array)
  end
  return array
end
function math.round(value)
  return math.floor(value + 0.5)
end
function Split(s, delim)
  if nil == s or nil == delim then
    return {}
  end
  if "string" ~= type(delim) or s_len(delim) <= 0 then
    return {}
  end
  if s_len(s) <= 0 then
    return {}
  end
  local start = 1
  local t = {}
  local pos
  while true do
    pos = s_find(s, delim, start, true)
    if not pos then
      break
    end
    t[#t + 1] = s_sub(s, start, pos - 1)
    start = pos + s_len(delim)
  end
  t[#t + 1] = s_sub(s, start)
  return t
end
local function CopyOne(t2, t1)
  if "table" == type(t1) then
    for k, v in pairs(t1) do
      if "table" == type(v) then
        local d2 = {}
        CopyOne(d2, v)
        t2[k] = d2
      else
        t2[k] = v
      end
    end
  end
end

function SimpleCopy(t1)
  if nil == t1 then
    return {}
  end
  local t2 = {}
  CopyOne(t2, t1)
  return t2
end

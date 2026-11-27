// Lua-side host infrastructure for the original window host. This is the
// bridge layer the original C#/FairyGUI runtime used to provide (component
// proxies, Net, UIMgr, T, TableData...). It contains no product window logic:
// every window behaviour stays in the original Lua files.
export const UI_PRELUDE_LUA = String.raw`
assert(__HostCall, 'host bridge missing')

local function __tostringAll(...)
  local n = select('#', ...)
  local parts = {}
  for i = 1, n do parts[i] = tostring(select(i, ...)) end
  return table.concat(parts, '\t')
end
function print(...) __HostCall('log', __tostringAll(...)) end

function Split(str, sep)
  local out = {}
  for piece in string.gmatch(str, '([^' .. sep .. ']+)') do table.insert(out, piece) end
  return out
end

function table.contain(t, value)
  for _, v in pairs(t) do if v == value then return true end end
  return false
end

function IsNil(v) return v == nil end

-- ---------------------------------------------------------------- JSON ----
local function __JsonEncodeString(s)
  return '"' .. s:gsub('[%z\1-\31\\"]', function(c)
    if c == '"' then return '\\"' end
    if c == '\\' then return '\\\\' end
    return string.format('\\u%04x', string.byte(c))
  end) .. '"'
end

function __JsonEncode(v)
  local t = type(v)
  if t == 'nil' then return 'null' end
  if t == 'boolean' then return v and 'true' or 'false' end
  if t == 'number' then return tostring(v) end
  if t == 'string' then return __JsonEncodeString(v) end
  if t == 'table' then
    local count = 0
    local array = true
    for k in pairs(v) do
      if type(k) ~= 'number' then
        array = false
      else
        count = count + 1
      end
    end
    local parts = {}
    if array then
      for i = 1, count do parts[i] = __JsonEncode(v[i]) end
      return '[' .. table.concat(parts, ',') .. ']'
    end
    for k, item in pairs(v) do
      table.insert(parts, __JsonEncodeString(tostring(k)) .. ':' .. __JsonEncode(item))
    end
    return '{' .. table.concat(parts, ',') .. '}'
  end
  error('json: cannot encode ' .. t)
end

function __JsonDecode(s)
  local pos = 1
  local function fail(msg) error('json: ' .. msg .. ' at ' .. pos) end
  local function skip()
    while pos <= #s do
      local c = s:sub(pos, pos)
      if c == ' ' or c == '\t' or c == '\n' or c == '\r' then pos = pos + 1 else break end
    end
  end
  local parseValue
  local function parseString()
    if s:sub(pos, pos) ~= '"' then fail('expected string') end
    pos = pos + 1
    local out = {}
    while pos <= #s do
      local c = s:sub(pos, pos)
      if c == '"' then
        pos = pos + 1
        return table.concat(out)
      end
      if c == '\\' then
        local esc = s:sub(pos + 1, pos + 1)
        if esc == 'n' then out[#out + 1] = '\n'
        elseif esc == 't' then out[#out + 1] = '\t'
        elseif esc == 'r' then out[#out + 1] = '\r'
        elseif esc == 'b' then out[#out + 1] = '\b'
        elseif esc == 'f' then out[#out + 1] = '\f'
        elseif esc == 'u' then
          local code = tonumber(s:sub(pos + 2, pos + 5), 16)
          if not code then fail('bad unicode escape') end
          out[#out + 1] = utf8.char(code)
          pos = pos + 4
        else
          out[#out + 1] = esc
        end
        pos = pos + 2
      else
        out[#out + 1] = c
        pos = pos + 1
      end
    end
    fail('unterminated string')
  end
  local function parseNumber()
    local start = pos
    while pos <= #s and s:sub(pos, pos):match('[%d%+%-%.eE]') do pos = pos + 1 end
    local value = tonumber(s:sub(start, pos - 1))
    if not value then fail('bad number') end
    return value
  end
  local function parseArray()
    pos = pos + 1
    local out = {}
    skip()
    if s:sub(pos, pos) == ']' then pos = pos + 1 return out end
    while true do
      out[#out + 1] = parseValue()
      skip()
      local c = s:sub(pos, pos)
      pos = pos + 1
      if c == ']' then return out end
      if c ~= ',' then fail('expected , or ]') end
    end
  end
  local function parseObject()
    pos = pos + 1
    local out = {}
    skip()
    if s:sub(pos, pos) == '}' then pos = pos + 1 return out end
    while true do
      skip()
      local key = parseString()
      skip()
      if s:sub(pos, pos) ~= ':' then fail('expected :') end
      pos = pos + 1
      out[key] = parseValue()
      skip()
      local c = s:sub(pos, pos)
      pos = pos + 1
      if c == '}' then return out end
      if c ~= ',' then fail('expected , or }') end
    end
  end
  parseValue = function()
    skip()
    local c = s:sub(pos, pos)
    if c == '"' then return parseString() end
    if c == '{' then return parseObject() end
    if c == '[' then return parseArray() end
    if c == 't' then pos = pos + 4 return true end
    if c == 'f' then pos = pos + 5 return false end
    if c == 'n' then pos = pos + 4 return nil end
    return parseNumber()
  end
  local value = parseValue()
  skip()
  if pos <= #s then fail('trailing data') end
  return value
end

-- ------------------------------------------------- data / text / time ----
function T(id, ...)
  local row = BaseWord_cn[id]
  if row == nil then error('T: missing word id: ' .. tostring(id)) end
  local pattern = row.name or row.sub_name
  if type(pattern) ~= 'string' then error('T: word id has no text: ' .. tostring(id)) end
  if select('#', ...) > 0 then return string.format(pattern, ...) end
  -- The original localized descriptions use printf's %% escape even without substitutions.
  local text = pattern:gsub('%%%%', '%%')
  return text
end

TableData = {}
function TableData.GetConfig(id, tableName)
  local t = rawget(_G, tableName)
  if type(t) ~= 'table' then error('TableData: config table not loaded: ' .. tostring(tableName)) end
  return t[id]
end
function TableData.GetTable(tableName)
  local t = rawget(_G, tableName)
  if type(t) ~= 'table' then error('TableData: config table not loaded: ' .. tostring(tableName)) end
  return t
end

TimeUtil = {}
function TimeUtil.FormatDate(fmt, stamp)
  if fmt ~= '%H' then error('TimeUtil.FormatDate: unsupported format: ' .. tostring(fmt)) end
  -- 原 cn 服务器时区为 UTC+8
  local hour = math.floor((((stamp + 8 * 3600) % 86400) + 86400) % 86400 / 3600)
  return string.format('%02d', hour)
end

LoginData = {}
function LoginData.GetCurServerTime()
  return __HostCall('time.now')
end

-- host-local routing keys: the original numeric values live in proto/C# inputs
-- that are not part of the decoded set; only their identity/ordering semantics
-- are observable from the original Lua (miniDailyStat >= FINISHED etc.).
Proto = {
  MsgName = {
    ActivityGetMiniGameReq = 'ActivityGetMiniGameReq',
    ActivityGetMiniGameRsp = 'ActivityGetMiniGameRsp',
    ActivityPlayMiniGameReq = 'ActivityPlayMiniGameReq',
    ActivityPlayMiniGameRsp = 'ActivityPlayMiniGameRsp',
    ActivityRewardMiniGameReq = 'ActivityRewardMiniGameReq',
    ActivityRewardMiniGameRsp = 'ActivityRewardMiniGameRsp'
  }
}
ProtoEnum = {
  TASK_STATE = { FINISHED = 1, REWARD = 2 },
  RET_CODE = { RC_ROGUE_NODE_REWARD_FETCHED = 20521 },
  TUPLE_TYPE = { ITEM = 1 }
}
WindowMsgEnum = {
  Activity17_MiniGame = { REFRESH_MINIGAME_INFO = 1 },
  Activity17_MiniGameChoice2Window = { RESET_SELECT_CARD = 2 },
  MiniGameBattleUIWindow = {}
}
RED_DOT_DATA_TYPE = { ACTIVITY_DUNGENON = 1 }

-- ------------------------------------------------------------- require ----
local __loadedModules = {}
function require(name)
  if __loadedModules[name] ~= nil then return __loadedModules[name] end
  local source = __HostCall('lua.source', name)
  local chunk, err = load(source, '@' .. name)
  if not chunk then error('require: ' .. tostring(name) .. ': ' .. tostring(err)) end
  local result = chunk()
  if result == nil then result = true end
  __loadedModules[name] = result
  return result
end

-- ---------------------------------------------------- FGUI proxy layer ----
local __NextTokenCounter = 0
local function __NextToken()
  __NextTokenCounter = __NextTokenCounter + 1
  return __NextTokenCounter
end

local __Proxies = {}
local __ClickHandlers = {}
local __ListRenderers = {}
local ObjProxyMeta = {}
local __ObjMethods = {}

local function __GetProxy(id)
  local proxy = __Proxies[id]
  if proxy then return proxy end
  proxy = setmetatable({ __id = id }, ObjProxyMeta)
  __Proxies[id] = proxy
  return proxy
end

local EventProxyMeta = {}
local function __GetEventProxy(id)
  return setmetatable({ __id = id }, EventProxyMeta)
end
function EventProxyMeta.__index(self, key)
  local id = rawget(self, '__id')
  if key == 'Call' then return function() for _,fn in ipairs(__ClickHandlers[id] or {}) do fn() end end end
  if key == 'Add' then
    return function(_, fn)
      local handlers = __ClickHandlers[id] or {}
      __HostCall('click.add', id, #handlers + 1)
      table.insert(handlers, fn)
      __ClickHandlers[id] = handlers
    end
  end
  if key == 'Set' then
    return function(_, fn)
      __HostCall('click.set', id, 1)
      __ClickHandlers[id] = { fn }
    end
  end
  error('onClick: unsupported member: ' .. tostring(key))
end

local ScrollProxyMeta = {}
local function __GetScrollProxy(id)
  return setmetatable({ __id = id }, ScrollProxyMeta)
end
function ScrollProxyMeta.__index(self, key)
  if key == 'SetPosX' then
    return function(_, x, animated)
      __HostCall('list.setPosX', rawget(self, '__id'), x, animated == true)
    end
  end
  error('scrollPane: unsupported member: ' .. tostring(key))
end

local CtrlProxyMeta = {}
local __CtrlProxies = {}
local function __GetControllerProxy(id, name)
  local controllers = __CtrlProxies[id] or {}
  __CtrlProxies[id] = controllers
  local proxy = controllers[name]
  if proxy then return proxy end
  proxy = setmetatable({ __id = id, __name = name }, CtrlProxyMeta)
  controllers[name] = proxy
  return proxy
end
function CtrlProxyMeta.__index(self, key)
  if key == 'selectedIndex' then
    return __HostCall('controller.get', rawget(self, '__id'), rawget(self, '__name'))
  end
  error('controller: unsupported read: ' .. tostring(key))
end
function CtrlProxyMeta.__newindex(self, key, value)
  if key == 'selectedIndex' then
    __HostCall('controller.set', rawget(self, '__id'), rawget(self, '__name'), value)
    return
  end
  error('controller: unsupported write: ' .. tostring(key))
end

function __ObjMethods.GetChild(self, name)
  local id=__HostCall('obj.getChild',rawget(self,'__id'),name)
  if id~=0 then return __GetProxy(id) end
end
function __ObjMethods.GetController(self, name)
  local id = rawget(self, '__id')
  -- 与 FairyGUI 一致：控制器不存在时返回 nil（原 ChangeUIController 依赖此行为，
  -- 例如 SpecialBtn 没有 c2 控制器而原代码仍会 ChangeUIController(tipsBtn, "c2", 0)）
  if __HostCall('obj.getController', id, name) == 0 then return nil end
  return __GetControllerProxy(id, name)
end
local __Animations = {}
local __AnimationsByOwner = {}
function PlayUITrans(com, name, complete)
  local id = __NextToken()
  local playback = { owner = com.__id, complete = complete, hooks = {}, playId = id }
  __HostCall('transition.play', com.__id, name, id)
  __Animations[id] = playback
  local owned = __AnimationsByOwner[playback.owner]
  if not owned then
    owned = {}
    __AnimationsByOwner[playback.owner] = owned
  end
  owned[id] = true
  function playback:SetHook(label, callback)
    if __Animations[id] ~= self then return self end
    self.hooks[label] = callback
    __HostCall('transition.hook', id, label)
    return self
  end
  return playback
end

local function __ReleaseNodes(ids)
  if ids == nil or ids == '' then return end
  local removed = {}
  for text in ids:gmatch('%d+') do
    local id = tonumber(text)
    removed[id] = true
    __Proxies[id] = nil
    __CtrlProxies[id] = nil
    __ClickHandlers[id] = nil
    __ListRenderers[id] = nil
  end
  for owner in pairs(removed) do
    local owned = __AnimationsByOwner[owner]
    if owned then
      for id in pairs(owned) do
        local play = __Animations[id]
        play.complete, play.hooks = nil, {}
        __Animations[id] = nil
      end
      __AnimationsByOwner[owner] = nil
    end
  end
  if __UiClearTimerOwners then __UiClearTimerOwners(removed) end
end

function __ObjMethods.AddChild(self, child)
  __HostCall('obj.add', self.__id, child.__id)
  return child
end
function __ObjMethods.RemoveChild(self, child)
  __ReleaseNodes(__HostCall('obj.remove', self.__id, child.__id))
end
function __ObjMethods.RemoveFromParent(self)
  local parent=__HostCall('obj.parent',self.__id)
  if parent~=0 then __GetProxy(parent):RemoveChild(self) end
end
__ObjMethods.Dispose=__ObjMethods.RemoveFromParent
function __ObjMethods.SetXY(self,x,y) self.x=x; self.y=y end
function __ObjMethods.SetValue(self,value) self.value=value end
function __ObjMethods.GetTransition(self,name)
  if not __HostCall('transition.exists',self.__id,name) then return nil end
  local playback
  return setmetatable({Play=function(_,callback) playback=PlayUITrans(self,name,callback) end},
    {__newindex=function(t,k,v)
      if k=='ignoreEngineTimeScale' and playback then __HostCall('transition.scaled',playback.playId,not v)
      else rawset(t,k,v) end
    end})
end
function __WebCreateFromUrl(url) return __GetProxy(__HostCall('obj.fromUrl',url)) end
function __WebHudRoot() return __GetProxy(__HostCall('hud.root')) end
function __ObjMethods.TweenValue(self, value, seconds)
  return __UiTweenValue(self.value or 0, value, seconds, function(step) self.value = step end, self.__id)
end
function __ObjMethods.Center(self)
  __HostCall('obj.center', rawget(self, '__id'))
end
function __ObjMethods.AddItemFromPool(self)
  local id = rawget(self, '__id')
  local itemId = __HostCall('list.addFromPool', id)
  local renderer = __ListRenderers[id]
  if renderer then renderer(__HostCall('obj.get', id, 'numItems') - 1, __GetProxy(itemId)) end
  return __GetProxy(itemId)
end
function __ObjMethods.RemoveChildrenToPool(self)
  __ReleaseNodes(__HostCall('list.clearItems', rawget(self, '__id')))
end

ObjProxyMeta.__index = function(self, key)
  local method = __ObjMethods[key]
  if method then return method end
  local id = rawget(self, '__id')
  if key == 'size' then return {x=self.width, y=self.height} end
  if key == 'onClick' then return __GetEventProxy(id) end
  if key == 'scrollPane' then return __GetScrollProxy(id) end
  return __HostCall('obj.get', id, key)
end

ObjProxyMeta.__newindex = function(self, key, value)
  local id = rawget(self, '__id')
  if key == 'size' then self.width = value.x; self.height = value.y; return end
  if key == 'itemRenderer' then
    if __Proxies[id] ~= self then return end
    __ListRenderers[id] = value
    return
  end
  if key == 'numItems' then
    __ReleaseNodes(__HostCall('list.setNumItems', id, value))
    local renderer = __ListRenderers[id]
    if renderer then
      for i = 0, value - 1 do
        renderer(i, __GetProxy(__HostCall('list.itemAt', id, i)))
      end
    end
    return
  end
  __HostCall('obj.set', id, key, value)
end

-- -------------------------------------------------------- window layer ----
local __Windows = {}
local __OpenArgs = {}
local __SetViewCallbacks = {}

local function __MakeBridge(token)
  local args = __OpenArgs[token] or {}
  __OpenArgs[token] = nil
  local function setView(self,packageName,comName,callback)
    local stoken=__NextToken()
    __SetViewCallbacks[stoken]=callback
    __HostCall('view.setAsync',stoken,packageName,comName)
  end
  return { argTable=args, SetView=setView, SetViewAsync=setView }
end

function OpenWindow(name, parent, ...)
  local token = __NextToken()
  __OpenArgs[token] = { ... }
  if __HostCall('window.open', name, token) == false then __OpenArgs[token]=nil end
end

UIMgr = {}
function UIMgr:CreateObject(packageName, itemName)
  return __GetProxy(__HostCall('obj.create', packageName, itemName))
end
function UIMgr:IsWindowOpen(name)
  return __HostCall('window.isOpen', name)
end
function UIMgr:GetItemUrl(packageName, itemName)
  return __HostCall('res.itemUrl', packageName, itemName)
end
function UIMgr:CloseWindow(name)
  __HostCall('window.close', name)
end
local __MessageArgs={}
function UIMgr:SendWindowMessage(name,msgId,para)
  local token=para~=nil and __NextToken() or 0
  if __HostCall('window.message',name,msgId,token)==true and token~=0 then __MessageArgs[token]=para end
end

-- ----------------------------------------------------------------- Net ----
local __NetListeners = {}
local __NetCallbacks = {}
local __NetErrCallbacks = {}
Net = {}
function Net.AddListener(msgName, fn)
  local listeners = __NetListeners[msgName] or {}
  table.insert(listeners, fn)
  __NetListeners[msgName] = listeners
end
function Net.Send(msgName, data, rspCallback, errCallback)
  local token = __NextToken()
  if rspCallback then __NetCallbacks[token] = rspCallback end
  if errCallback then __NetErrCallbacks[token] = errCallback end
  __HostCall('net.send', msgName, __JsonEncode(data), token)
end

-- ------------------------------------------------------------- UIUtil -----
UIUtil = {}
function UIUtil.SetText(com, text, childName)
  com:GetChild(childName).text = text
end
function UIUtil.SetBtnText(btn, text)
  -- 本包内按钮的标题文本子节点约定为 WordTxt（同 UIUtil.SetText 的调用证据）
  local child = __HostCall('obj.textChild', btn.__id)
  if child ~= 0 then __GetProxy(child).text = text end
end
function UIUtil.GetResUrl(res)
  local packageName, itemName = string.match(res, '^(.-):(.+)$')
  if not packageName then error('UIUtil.GetResUrl: unsupported res: ' .. tostring(res)) end
  return __HostCall('res.itemUrl', packageName, itemName)
end
function UIUtil.ShowItemFrame(itemId, root, count, quality, cb)
  __HostCall('ui.showItemFrame', itemId, root.__id, count)
  if cb then
    root.onClick:Add(function()
      cb({ StopPropagation = function() end })
    end)
  end
end
function UIUtil.CommonItemClickCallback(itemId, itemType)
  __HostCall('ui.itemClick', itemId, itemType)
end

function ChangeUIController(com, name, index)
  local controller = com:GetController(name)
  if controller ~= nil then controller.selectedIndex = index end
end

RedDotMgr = {}
function RedDotMgr.AddNode(node)
  __HostCall('reddot.add', node.com.__id, node.windowName, node.dataType)
end
function RedDotMgr.UpdateNode(dataType)
  __HostCall('reddot.update', dataType)
end

FloatTipsUtil = {}
function FloatTipsUtil.ShowWarnTips(text)
  __HostCall('ui.warn', text)
end

GetItemTips = {}
function GetItemTips.Show(rewards)
  __HostCall('ui.itemTips')
end

function ld(name)
  __HostCall('module-group', name)
end

MiniGameBattleMgr = {}
function MiniGameBattleMgr.InitBattle(args)
  assert(type(args) == 'table' and type(args.stageId) == 'number', 'InitBattle: numeric stageId required')
  __HostCall('battle.init', args.stageId)
end
function MiniGameBattleMgr.CloseBattle()
  __HostCall('battle.close')
end

-- ----------------------------------------------------------- dispatch -----
function __HostDispatch(kind, a, b, c)
  if kind == 'nodes.release' then
    __ReleaseNodes(a)
    return
  end
  if kind == 'window.shown' then
    local module = __Windows[a]
    if module and module.OnShowAnimationEnd then module.OnShowAnimationEnd() end
    return
  end
  if kind == 'transition' then
    local play = __Animations[a]
    if not play then return end
    local callback
    if b then
      callback = play.hooks[b]
      play.hooks[b] = nil
    else
      callback = play.complete
      play.complete, play.hooks = nil, {}
      __Animations[a] = nil
      local owned = __AnimationsByOwner[play.owner]
      owned[a] = nil
      if next(owned) == nil then __AnimationsByOwner[play.owner] = nil end
    end
    if callback then callback() end
    return
  end
  if kind == 'click' then
    local handlers = __ClickHandlers[a]
    if handlers then
      for _, fn in ipairs(handlers) do fn() end
    end
    return
  end
  if kind == 'setview' then
    local callback = __SetViewCallbacks[a]
    __SetViewCallbacks[a] = nil
    if callback then callback(__GetProxy(b)) end
    return
  end
  if kind == 'window.open' then
    local name, token = a, b
    local module = require(name)
    if type(module) ~= 'table' or type(module.OnInit) ~= 'function' then
      error('window: ' .. tostring(name) .. ' has no OnInit')
    end
    __Windows[name] = module
    module.OnInit(__MakeBridge(token))
    return
  end
  if kind == 'window.close' then
    local module = __Windows[a]
    __Windows[a] = nil
    if module and module.OnClose then module.OnClose() end
    return
  end
  if kind == 'window.message' then
    local module = __Windows[a]
    local arg=__MessageArgs[c]
    __MessageArgs[c]=nil
    if module and module.HandleMessage then module.HandleMessage(b,arg) end
    return
  end
  if kind == 'net.rsp' then
    local msg = __JsonDecode(b)
    local listeners = __NetListeners[a] or {}
    for _, fn in ipairs(listeners) do fn(msg) end
    local callback = __NetCallbacks[c]
    __NetCallbacks[c] = nil
    if callback then callback(msg) end
    return
  end
  if kind == 'net.err' then
    local callback = __NetErrCallbacks[c]
    __NetErrCallbacks[c] = nil
    if callback then callback(b) end
    return
  end
  error('dispatch: unknown kind: ' .. tostring(kind))
end

function __HostBindActivity(showId, startStamp)
  local bound
  for id, activity in pairs(BaseActivity) do
    if activity.type == 10119 and type(activity.parameter) == 'string' then
      local config = BaseActivityStageConfig[tonumber(activity.parameter)]
      if config and config.show_id == showId then
        ActivityDungeonData.SetActivityInfo({ baseInfo = { activityId = id, startStamp = startStamp } }, showId)
        bound = id
      end
    end
  end
  if bound == nil then
    error('activity binding failed: no BaseActivity maps to show_id ' .. tostring(showId))
  end
  ActivityDungeonData.SaveShowId(showId)
  return bound
end
`;

// Original modules are executed in the window VM so buttons and rules share Lua objects.
export const BATTLE_BASE = ['BattleConst', 'MiniGameBattleConst', 'BaseShootMonsterGroup',
  'MiniGameBattleControl', 'MiniGameBattleData', 'MiniGameBattleMgr', 'MiniGameBattleScene'];
export const BATTLE_COMBAT = ['source-derived-helpers', 'BaseAttribute', 'BaseShootSkill',
  'BaseShootSkillBuff', 'BaseSkillParameter', 'CardAttribute', 'MathUtil', 'MiniGameBattleAction',
  'MiniGameBattleBuff', 'MiniGameBattleBuffEffect', 'MiniGameBattleBuffMgr', 'MiniGameBattleBullet',
  'MiniGameBattleChoose', 'MiniGameBattleDataCount', 'MiniGameBattleUnit'];

export const BATTLE_PLATFORM = String.raw`
local noop = function() end
local function vector(x,y,z) return {x=x or 0,y=y or 0,z=z or 0} end
local function f32(n) return string.unpack('f',string.pack('f',n)) end
local function scale(x,y,z) return vector(f32(x),f32(y),f32(z)) end
Vector3, typeof = vector, function(t) return t end
CS = {UnityEngine={Animator='Animator'}}
Application={platform='WebGLPlayer',targetFrameRate=60}
RuntimePlatform={WindowsEditor='WindowsEditor',OSXEditor='OSXEditor'}
Screen={width=1334,height=750}
MiniGameBattleCamera={enabled=false, orthographicSize=5}
MiniGameBattleCameraObject={}
CameraUtil={SetCameraCullingMask=function(_,mask) MiniGameBattleCamera.cullingMask=mask end}
SettingUtil={UpdateFPS=noop}
require('GlobalConst')
local originalUI=require('UIUtil')
UIUtil.SetBtnText=originalUI.SetBtnText
UIUtil.SetText=originalUI.SetText
UIUtil.GetResUrl=originalUI.GetResUrl
PlayerPrefsUtil={GetInt=function(key,default) return __HostCall('prefs.get',key,default) end,
                SetInt=function(key,value) __HostCall('prefs.set',key,value) end}
PLAYER_PREF_ENUM={MINI_GAME_BATTLE_SPEED='speed'}
PLAYER_PREF_DEFAULT_VALUE={MINI_GAME_BATTLE_SPEED=1}
LoginData.gameTimescale=1
LoginData.SetTimeScale=function(value) LoginData.gameTimescale=value end
SoundUtil={SetSfxSpeedInBattle=function(speed) __HostCall('audio.speed',speed) end, PlayLastMusic=noop,
  PlayMusic=function(id) local c=TableData.GetConfig(id,'BaseSoundPath'); __HostCall('audio.play','bgm',c.path) end,
  PlaySfxInBattle=function(path,bank,obj)
    return __HostCall('audio.play','sfx',path,MiniGameBattleControl.curFixedFrame or 0,obj and obj.instance)
  end,
  StopCurMusic=function() __HostCall('audio.stop','bgm') end,
  StopSoundEvent=function(id) __HostCall('audio.stop',id) end}
SkeletonAnimationUtil={TwinkleColor=noop}
local effects={}
local effectLifetimes=__JsonDecode(__HostCall('native.effectLifetimes'))
local function fixedFrame() return MiniGameBattleControl.curFixedFrame or 0 end
local function destroyObject(obj)
  obj.destroyed=true
  effects[obj.instance]=nil
end
local function clearEffects()
  for _,obj in pairs(effects) do obj.destroyed=true end
  effects={}
end
EffectUtil={SetAutoDestroyCallback=function(object,callback)
    local lifetime=effectLifetimes[object.path:lower()]
    if lifetime and lifetime.loop then
      object.endFrame=nil
    else
      local seconds=lifetime and lifetime.seconds or 0
      object.endFrame=object.bornFrame+math.max(1,math.ceil(seconds*BATTLE_CONFIG_ENUM.FIXED_FPS))
    end
    object.onComplete=callback
    effects[object.instance]=object
  end,
  Overturn=function(effect,flip) effect.flipped=flip end}
SoundManager={ClearTempBanks=noop}
BattleResourceManager={SetBattleRootScale=noop,ClearBattleResource=clearEffects,
  DestroyGameObject=function(_,obj) destroyObject(obj) end,
  AddGameObject=function(_,obj,x,y,z,sx,sy,sz)
    obj.transform.localPosition=vector(x,y,z)
    obj.transform.localScale=scale(sx or 1,sy or 1,sz or 1)
  end}
local prefabs=__JsonDecode(__HostCall('native.models'))
ResourceManager={}
local resourceInstance=0
local transformOwners=setmetatable({},{__mode='k'})
local transformMetatable={__newindex=function(transform,key,value)
  rawset(transform,key,value)
  if key=='parent' and transformOwners[value] then
    local object=transformOwners[transform]
    effects[object.instance]=object
  end
end}
function ResourceManager.Instantiate(path)
  local worldPath=path:lower()
  local source=prefabs[worldPath]
  local clips={Length=0}
  local sockets={}
  if source then
    for i,clip in ipairs(source.clips) do clips[i-1]=clip; clips.Length=i end
    for name,position in pairs(source.sockets) do sockets[name]={transform={localPosition=position}} end
  end
  local animator=source and #source.clips>0 and {speed=1,runtimeAnimatorController={animationClips=clips}} or nil
  resourceInstance=resourceInstance+1
  local object={path=path,worldPath=worldPath,instance=resourceInstance,bornFrame=fixedFrame(),
    transform={localPosition=vector(),localScale=scale(1,1,1)}, sockets=sockets, animator=animator,
    SetActive=function(self,visible) self.visible=visible end,
    GetComponentInChildren=function(_,kind) if kind=='Animator' then return animator end end,
    Get3DPositionToUIPosition=function(self,camera)
      local p=self.transform.localPosition
      local factor=Screen.height/(2*camera.orthographicSize)
      return {x=Screen.width/2+p.x*factor,y=Screen.height/2-p.y*factor}
    end}
  -- Original Lua recursively copies unit tables, so keep transform ownership outside them.
  transformOwners[object.transform]=object
  setmetatable(object.transform,transformMetatable)
  return object
end
ResourceManager.DestroyGameObject=destroyObject
LuaUtil={FindChild=function(obj,key) return obj.sockets[key] end, ChangeLayer=noop,
  SetLocalPos=function(obj,x,y,z) obj.transform.localPosition=vector(x,y,z) end,
  SetScale=function(obj,x,y,z,multiply)
    local s=obj.transform.localScale
    if multiply then x,y,z=x*s.x,y*s.y,z*s.z end
    obj.transform.localScale=scale(x,y,z)
  end,
  SetChildrenOrderInLayer=function(obj,n) obj.order=n end,
  PlayAnimator=function(obj,state) if obj then obj.animation=state;obj.animationTime=0 end end}
SortingHelper=require('SortingHelper')
CS.Launch={Singleton={transform={}}}
FairyGUI={GObjectPool=function()
  return {Clear=noop,GetObject=function(_,url) return __WebCreateFromUrl(url) end,
    ReturnObject=function(_,obj) obj:Dispose() end}
end}
-- The HUD window is queued at scene load. Resolve its live root when inserting a number.
UIMgr.GetLayerRoot=function()
  return {AddChild=function(_,obj) return __WebHudRoot():AddChild(obj) end}
end
-- HeadInfo is optional on the extracted prefabs. Its absence is supported by the original binding.
local instantiate=ResourceManager.Instantiate
ResourceManager.Instantiate=function(path)
  local model=instantiate(path)
  if prefabs[path:lower()] then
    local head=model.sockets.HeadInfo
    model.sockets.model={transform={Find=function(_,name) if name=='HeadInfo' then return head end end},GetComponentInChildren=function() return nil end}
    if head then
      head.gameObject={SetActiveSafe=function(_,active) if not active and model.headUi then model.headUi:Dispose();model.headUi=nil end end}
      head.gameObject.transform={GetComponent=function()
        local ui=__WebCreateFromUrl(UIMgr:GetItemUrl('CommonResource','Activity17_MonsterHP'))
        __WebHudRoot():AddChild(ui)
        model.headUi=ui
        model.headX,model.headY=nil,nil
        return {ui=ui}
      end}
    end
  end
  return model
end
print_battle=noop
print=noop
printError=function(...) error(table.concat({...},' ')) end
UILayer={Loading='Loading'}
WindowMsgEnum.BattleLoadingWindow={ADD_CALLBACK_IN=1,PLAY_ANIM_OUT=2}
UIUtil.ChangeBattleScreenEffectIn=originalUI.ChangeBattleScreenEffectIn
UIUtil.ChangeBattleScreenEffectOut=originalUI.ChangeBattleScreenEffectOut
Resources={UnloadUnusedAssets=noop}
LuaUtil.SetAlpha=function(object,alpha) object.alpha=alpha end
LuaUtil.ResetAlpha=function(object) object.alpha=1 end
IsUITransPlaying=function(object,name) return __HostCall('transition.active',object.__id,name) end
TimeUtil.GetTimeStr=require('TimeUtil').GetTimeStr
WindowMsgEnum.MiniGameBattleUIWindow={E_MSG_UPDATE_PER_FRAME=1,E_MSG_CHANGE_WAVE=6}
local fixed,display,accumulator
local pendingMilliseconds,stepBudget
UpdateManager={
  AddFixedUpdateHandler=function(callback) fixed=callback;accumulator=0;pendingMilliseconds=nil end,
  AddUpdateHandler=function(callback) display=callback end,
  RemoveFixedUpdateHandler=function(callback) if fixed==callback then fixed=nil end end,
  RemoveUpdateHandler=function(callback) if display==callback then display=nil end end}
CardAttribute.InitAttrEnum()
local originalInit=MiniGameBattleMgr.InitBattle
function MiniGameBattleMgr.InitBattle(args)
  if MiniGameBattleCamera.enabled and not MiniGameBattleControl.isOver then return end
  pendingMilliseconds=nil
  clearEffects()
  __HostCall('battle.init',args.stageId,args.stress==true)
  math.randomseed(__HostCall('rng.seed'),args.stageId)
  originalInit(args)
  MiniGameBattleData.stress=args.stress==true
end
local sendResult=MiniGameBattleMgr.SendBattleOverMsg
function MiniGameBattleMgr.SendBattleOverMsg(stageId,param)
  local skipResult=__HostCall('battle.result',stageId,__JsonEncode({frame=MiniGameBattleControl.curFixedFrame,
    win=param.isBattleWin,loss=param.isBattleLoss,wave=param.wave,kills=param.killCount}))
  if skipResult~=true then sendResult(stageId,param) end
end
local function worldPose(obj)
  if not obj or obj.destroyed or obj.visible==false then return nil end
  local transform=obj.transform
  local position,size,right=transform.localPosition,transform.localScale,transform.right
  if obj.flipped then size=vector(-size.x,size.y,size.z) end
  local parent=transformOwners[transform.parent]
  if parent then
    local parentPosition,parentSize,parentRight=worldPose(parent)
    if not parentPosition then return nil end
    local cos,sin=1,0
    if parentRight then
      local length=math.sqrt(parentRight.x^2+parentRight.y^2)
      if length>0 then cos,sin=parentRight.x/length,parentRight.y/length end
    end
    local x,y=position.x*parentSize.x,position.y*parentSize.y
    position=vector(parentPosition.x+x*cos-y*sin,parentPosition.y+x*sin+y*cos,parentPosition.z+position.z*parentSize.z)
    size=vector(size.x*parentSize.x,size.y*parentSize.y,size.z*parentSize.z)
    if right then right=vector(right.x*cos-right.y*sin,right.x*sin+right.y*cos,right.z)
    else right=parentRight end
  end
  return position,size,right
end
local function modelState(obj)
  local position,size,right=worldPose(obj)
  if not position then return nil end
  -- See battle-snapshot.ts for the private Lua-to-Worker record format.
  return {obj.worldPath,position.x,position.y,position.z,size.x,size.y,size.z,
    obj.animation or false,obj.animationTime or 0,obj.order or 0,right and {right.x,right.y,right.z} or false,
    math.max(0,fixedFrame()-obj.bornFrame)/BATTLE_CONFIG_ENUM.FIXED_FPS,obj.instance}
end
local function expireEffects()
  local expired={}
  for _,effect in pairs(effects) do
    if effect.endFrame and fixedFrame()>=effect.endFrame then expired[#expired+1]=effect end
  end
  for _,effect in ipairs(expired) do
    local callback=effect.onComplete
    destroyObject(effect)
    effect.onComplete=nil
    if callback then callback() end
  end
end
local function collectEffects()
  local live={}
  for _,effect in pairs(effects) do
    local model=modelState(effect)
    if model then live[#live+1]=model end
  end
  table.sort(live,function(a,b) return a[13]<b[13] end)
  return live
end
local function advanceWorld(seconds)
  for _,u in ipairs(MiniGameBattleScene.allUnit or {}) do
    if u.id and not u:IsDestroy() then
      if u.model and u.model.headUi and u.UIPosition then
        local x,y=u.UIPosition.x,u.UIPosition.y
        if x~=u.model.headX or y~=u.model.headY then
          u.model.headUi:SetXY(x,y)
          u.model.headX,u.model.headY=x,y
        end
      end
      if u.model and u.model.animation then
        u.model.animationTime=(u.model.animationTime or 0)+seconds*(u.modelTimeScale or 1)
      end
    end
  end
  expireEffects()
end
local function collectWorld()
  local units={}
  local data,scene,control=MiniGameBattleData,MiniGameBattleScene,MiniGameBattleControl
  if not data.stageId or data.stageId==0 then return 'null' end
  for _,u in ipairs(scene.allUnit or {}) do
    if u.id and not u:IsDestroy() then
      table.insert(units,{u.uid,u.id,u.position.x,u.position.y,u.position.z,u.camp,u.curState or false,
        u.isFlip==true,modelState(u.model) or false})
    end
  end
  local bullets={}
  for _,b in ipairs(scene.allBullet or {}) do
    local m=modelState(b.model)
    if m then table.insert(bullets,m) end
  end
  return __JsonEncode({control.curFixedFrame or 0,data.stageId,scene.curMonsterWave,data.killEnemyCount,
    data.curLevel or false,data.curExp or false,data.selfHp or false,data.selfMaxHp or false,data.speedIndex or false,
    control.isPause==true,units,modelState(MiniGameBattleBackground.model) or false,bullets,collectEffects()})
end
function __WebBattleTick(milliseconds)
  local continuing=pendingMilliseconds~=nil
  if continuing then
    milliseconds=pendingMilliseconds
    pendingMilliseconds=nil
  elseif __UiAdvanceTimers then __UiAdvanceTimers(milliseconds,LoginData.gameTimescale or 1) end
  if fixed and not MiniGameBattleControl.isPause then
    if not continuing then accumulator=accumulator+milliseconds*(LoginData.gameTimescale or 1) end
    local step=1000/BATTLE_CONFIG_ENUM.FIXED_FPS
    local advanced=0
    while fixed and accumulator+0.000001>=step and not MiniGameBattleControl.isPause do
      accumulator=accumulator-step
      fixed()
      advanced=advanced+1
      if advanced==stepBudget and fixed and not MiniGameBattleControl.isPause and accumulator+0.000001>=step then
        pendingMilliseconds=milliseconds
        return ''
      end
    end
    if display and not MiniGameBattleControl.isPause then display() end
  else accumulator=0 end
  advanceWorld(fixed and not MiniGameBattleControl.isPause and milliseconds/1000*(LoginData.gameTimescale or 1) or 0)
  return collectWorld()
end
function __WebBattleSlice(milliseconds,limit,resume)
  if resume and pendingMilliseconds==nil then return 'null' end
  assert(resume or pendingMilliseconds==nil,'unfinished foreground tick')
  stepBudget=limit
  local state=__WebBattleTick(milliseconds)
  stepBudget=nil
  return state
end
`;

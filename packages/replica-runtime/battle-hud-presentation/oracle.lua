-- Lua shadow tree records exact authored calls, not Unity graphics/tweens.
local h=AuditBattleHud
local oldT=T
T=function(id,...)
  if hudTranslations[id] then return string.format(hudTranslations[id], ...) end
  return oldT(id,...)
end
local root, pane, lastTween, lifecycle, lastOp, oldSend, opsFixed, opsDisplay
local function record(k) lifecycle[#lifecycle+1]=k end
local function node()
  local data={}
  local n={}
  local m={}
  function m:GetChild(k)
    if not data[k] then data[k]=node() end
    return data[k]
  end
  function m:TweenValue(v,t) data.tween={v,t};lastTween[#lastTween+1]={value=v,duration=t} end
  function m:Center() end
  function m:AddChild(c) record("add-battleStart") end
  function m:RemoveChild(c,dispose) assert(dispose);record("remove-battleStart") end
  return setmetatable(n,{
    __index=function(_,k)
      if m[k] then return m[k] end
      if k=='numItems' or k=='itemRenderer' or k=='text' or k=='value' or k=='url' or k=='selectedIndex'
          or k=='tween' or k=='page' or k=='activeItems' or k=='visible' or k=='touchable' then return data[k] end
      if k=='onClick' then return {Add=function()end,Set=function()end} end
      return m.GetChild(n,k)
    end,
    __newindex=function(_,k,v)
      data[k]=v
      if k=='numItems' then
        data.activeItems={}
        for i=1,v do
          local item=m.GetChild(n,'@'..i)
          data.itemRenderer(i-1,item)
          data.activeItems[i]=item
        end
      end
    end
  })
end
local origCtrl=ChangeUIController
ChangeUIController=function(item,ctr,page)
  if getmetatable(item) then item:GetChild("@"..ctr).page=page;return end
  return origCtrl(item,ctr,page)
end
Application={platform='oracle',targetFrameRate=24}
RuntimePlatform={WindowsEditor='not-oracle'}
SoundUtil=SoundUtil or {}
SoundUtil.SetSfxSpeedInBattle=function() end
function GetActivityDungeon1017Battle_BattleUIWindowUis(x) assert(x==pane);return root end
WindowMsgEnum.MiniGameBattleUIWindow.E_MSG_UPDATE_PER_FRAME=29
function hudOracleInit()
  lifecycle={};lastTween={};root=node();pane=node();lastOp='native_init_ops';opsFixed=0;opsDisplay=0
  h.OnInit({SetViewAsync=function(_,pkg,name,callback)callback(pane)end})
  oldSend=UIMgr.SendWindowMessage
  UIMgr.SendWindowMessage=function(self,name,msg,...)
    local v=oldSend(self,name,msg,...)
    if root and name==WinResConfig.MiniGameBattleUIWindow.name and (msg==29 or msg==6) then
      if msg==29 then lastTween={};lastOp='native_display_ops';opsFixed=MiniGameBattleControl.curFixedFrame;opsDisplay=MiniGameBattleControl.curFrame end
      h.HandleMessage(msg,...)
    end
    return v
  end
end
function hudOracleIntro()
  local bg,sign,up,cleanup
  UIMgr.CreateObject=function(_,pkg,name) assert(pkg=="ActivityDungeon1017Battle" and name=="BattleStart");return node() end
  UIUtil.ChangeBattleScreenEffectOut=function(cb) record("screen-effect-out-request");bg=cb end
  PlayUITrans=function(target,name,callback)
    if name=="in" then record("battleStart-in-request");cleanup=callback
    elseif name=="up" then record("battleHud-up-request");up=callback
    else error("unknown authored transition "..name) end
    return {SetHook=function(_,label,fn) assert(label=="Sign");record("battleStart-Sign-hook-request");sign=fn end}
  end
  pane.touchable=false
  local old=MiniGameBattleMgr
  MiniGameBattleMgr={isBattleStart=false,StartBattle=function() record("original-battle-start-call") end}
  h.OnShowAnimationEnd()
  assert(root.Main.root.visible==false)
  assert(not sign and not up and pane.touchable==false);bg()
  assert(sign and not up and pane.touchable==false);sign()
  assert(up and root.Main.root.visible and pane.touchable==false);up()
  assert(pane.touchable==true);cleanup()
  MiniGameBattleMgr=old
  return table.concat(lifecycle,"|")
end
function hudOracleSpeedRefresh() h.UpdateSpeedBtn() end
local function row(out,...)
  local o={...}
  for i=1,#o do if o[i]==false then o[i]='-' end; o[i]=tostring(o[i]) end
  out[#out+1]=table.concat(o,"\t")
end
function hudOracleRead()
  local a=root.Main.Top
  local b=root.Main.Bottom
  local out={}
  local cards=MiniGameBattleScene.cardList
  row(out,'phase',lastOp,MiniGameBattleControl.curFixedFrame,MiniGameBattleControl.curFrame,opsFixed,opsDisplay)
  row(out,'top',a.Time.TimeTxt.text,a.Progress.TimeTxt.text,a.Number.NumberTxt.text,a.Exp.LevelTxt.text,a.Exp.ExpTxt.text,
    a.Exp.ExpProgressBar.value,b.BuildHP.NameTxt.text,b.BuildHP.HPTxt.text,b.BuildHP.BuildHPProgressBar.value,
    a.SpeedBtn:GetChild("NumberTxt").text,a.SpeedBtn:GetChild("@c1").page)
  for i=1,5 do
    local d=b.DPSInfoSwitch.DPS1["Card"..i]
    local dp=d.DPSProgressBar
    local c=b.CardList.activeItems[i]
    local raw=cards[i]
    row(out,'card',i,raw and raw.uid or false,raw and raw.id or false,d.c1Ctr.selectedIndex,d.PicLoader.url or false,
      dp:GetChild('NumberTxt').text or false,dp.value or false,dp.tween and dp.tween[1] or false,dp.tween and dp.tween[2] or false,
      c:GetChild('@c1').page,c:GetChild('@c2').page or false,c:GetChild('NumberTxt').text or false,
      c:GetChild('Bg'):GetChild('PicLoader').url or false)
    if raw then
      local data=raw:GetSkillListForUI()
      for j,sk in ipairs(c:GetChild('SkillList').activeItems) do
        row(out,'skill',i,j,data[j].id,sk:GetChild('PicLoader').url,sk:GetChild('@lock').page,
          sk:GetChild('LevelTxt').text or false,sk.value or false)
      end
    end
  end
  return table.concat(out,"\n")
end
function hudOracleReturn()
  local call
  OpenWindow=function(win)call=win end
  WinResConfig.MiniGameBattleExitWindow={name="MiniGameBattleExitWindow"}
  h.ClickReturnBtn()
  return table.concat({call,tostring(MiniGameBattleControl.isPause),MiniGameBattleControl.curFixedFrame,MiniGameBattleControl.curFrame},"\t")
end

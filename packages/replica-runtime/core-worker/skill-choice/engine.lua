-- Loaded only in the isolated audited Stage 1 local engine.
-- The original window owns selection, weighting, timeout and callbacks.
local tickMotion = MiniGameBattleControl.UpdateProcess
local schedulerTime, nextTimerId, scheduled, active
local capturedResult, windowId
printError=function(msg,min,max,rng,value,trace)
  -- Do not repair primary inputs. On a genuinely reversed *original* Dina talent
  -- interval under verified scene bounds, keep Mgr.lua:80's own fallback.
  -- A standalone synthetic test below proves it independently.
  if msg=="随机数出错了" and type(min)=="number" and type(max)=="number" and min>max and
     type(trace)=="string" and (trace:match("runFallbackAudit") or
      (trace:match("MiniGameBattleAction[^\n]+:373:") and
       min+max==MiniGameBattleScene.minY+MiniGameBattleScene.maxY)) then
    emit("authored-rng-fallback",min,max,rng,value,math.floor((min+max)/2))
    return
  end
  error(tostring(msg).." ["..table.concat({tostring(min),tostring(max),tostring(rng),tostring(value)},",").."] "..tostring(trace),2)
end
local function hook(kind,...)
  emit(kind,...)
end
local function resetTimers()
  schedulerTime, nextTimerId, scheduled = 0,0,{}
end
local function timer(kind,duration)
  nextTimerId=nextTimerId+1
  local t={uniqueId=nextTimerId,start=schedulerTime,kind=kind,endMs=schedulerTime+math.floor(duration*1000+0.5)}
  function t:setIgnoreTimeScale(v)
    assert(v==true,"original choice timer must ignore time scale")
    self.unscaled=true
    return self
  end
  function t:setOnComplete(f) self.complete=f;return self end
  function t:setOnUpdate(f) self.update=f;return self end
  scheduled[t.uniqueId]=t
  return t
end
LeanTween = {
  value=function(from,to,dt)
    local t=timer("deadline",dt)
    assert(from==30 and to==0 and dt==30,"changed source clock contract")
    t.seconds=from
    return t
  end,
  delayedCall=function(dt,f)
    local t=timer("delayed",dt)
    t.complete=f
    return t
  end,
  cancel=function(id) scheduled[id]=nil end,
}
local function advance(ms)
  assert(math.type(ms)=="integer" and ms>=0 and ms <= 60000,"invalid unscaled step")
  local target=schedulerTime+ms
  while true do
    local nextDeadline
    for _,t in pairs(scheduled) do
      assert(t.unscaled,"unscaled timing proof absent")
      if t.endMs<=target and (not nextDeadline or t.endMs<nextDeadline.endMs or
        (t.endMs==nextDeadline.endMs and t.uniqueId<nextDeadline.uniqueId)) then
        nextDeadline=t
      end
    end
    if not nextDeadline then break end
    schedulerTime=nextDeadline.endMs
    scheduled[nextDeadline.uniqueId]=nil
    if nextDeadline.update then nextDeadline.update(0) end
    if nextDeadline.complete then nextDeadline.complete() end
  end
  schedulerTime=target
  for _,t in pairs(scheduled) do
    if t.update then t.update((t.endMs-schedulerTime)/1000) end
  end
end
local function callback()
  local a={f=nil}
  function a:Set(f) self.f=f end
  function a:Add(f) self.f=f end
  function a:Call() assert(self.f,"missing UI binding");self.f() end
  return a
end
local function component()
  local c={nodes={},items={},visible=true,touchable=true,onClick=callback()}
  function c:GetChild(n)
    if not self.nodes[n] then self.nodes[n]=component() end
    return self.nodes[n]
  end
  function c:RemoveChildrenToPool() self.items={} end
  function c:AddItemFromPool()
    local node=component()
    self.items[#self.items+1]=node
    return node
  end
  function c:TweenValue(_,duration)
    assert(duration==30)
    return {SetIgnoreEngineTimeScale=function(_,flag) assert(flag==true) end}
  end
  function c:Center() end
  return c
end
local function uiForChoice()
  local tree={Main={TipsList=component(),Time={
    SureBtn=component(),Time1ProgressBar=component(),Time2ProgressBar=component()}}}
  function tree.Main.Time.SureBtn:GetChild(n) return component() end
  return tree
end
GetActivityDungeon1017Battle_SkillChoiceWindowUis=function(p) return p.tree end
UIUtil={
  SetBtnText=function(btn,value) btn.text=value end,
  GetResUrl=function(v) return v end,
}
local originalT=T
T=function(id,...)
  if id==11904 then return (...) end -- capture the underlying countdown integer, not locale rendering
  return originalT(id)
end
ChangeUIController=function() end
PlayUITrans=function() end

-- Mark a UI card with the exact selected list row without reimplementing
-- weighted without-replacement logic or making another RNG draw.
local originalOne=ChoiceWindow.GetOneRandomSkill
ChoiceWindow.GetOneRandomSkill=function(pool)
  local list={}
  for _,r in ipairs(pool) do list[#list+1]=r.id..":"..r.prob end
  local before=MiniGameBattleData.curRandomIndex
  local answer=originalOne(pool)
  hook("draw",windowId,active.generation,table.concat(list,","),before,MiniGameBattleData.curRandomIndex,answer.id)
  return answer
end
local originalWeighted=ChoiceWindow.RandomSkillList
ChoiceWindow.RandomSkillList=function(level)
  assert(active,"choice window lifecycle violated")
  active.level=level
  active.generation=active.generation+1
  local offers=originalWeighted(level)
  active.offers=offers
  active.openedMs=schedulerTime
  assert(#offers>0,"upstream returned no eligible cards; exact behavior blocked")
  local packed={}
  for _,r in ipairs(offers) do packed[#packed+1]=r.id end
  active.offerString=table.concat(packed,",")
  hook("offer",windowId,active.generation,level,schedulerTime,active.offerString,MiniGameBattleData.curRandomIndex)
  return offers
end
UIMgr.CloseWindow=function(_,name)
  assert(name=="SkillChoiceWindow" and active,"unexpected UI close")
  ChoiceWindow.OnClose()
  hook("resume",windowId,active.generation,schedulerTime,MiniGameBattleData.curRandomIndex)
  active=nil
end
OpenWindow=function(name,ignored,levels)
  assert(name=="SkillChoiceWindow" and #levels>0 and not active,"unclosed UI path")
  assert(MiniGameBattleControl.isPause,"Lua was not paused before opening chooser")
  windowId=windowId+1
  local pane=component()
  pane.tree=uiForChoice()
  active={pane=pane,generation=0}
  -- Log successful original SaveSkill calls only for an offered item.
  for _,u in ipairs(MiniGameBattleScene.cardList) do
    if not u.auditOriginalSaveSkill then
       local save=u.SaveSkill
       u.auditOriginalSaveSkill=save
       u.SaveSkill=function(unit,id)
         save(unit,id)
         if active then
           hook("learn",windowId,active.generation,unit.id,id,unit:GetSkillLevel(id),schedulerTime,MiniGameBattleData.curRandomIndex)
         end
       end
    end
  end
  ChoiceWindow.OnInit({
    argTable={levels},
    SetViewAsync=function(_,pkg,componentName,ready)
      assert(pkg=="ActivityDungeon1017Battle" and componentName=="SkillChoiceWindow")
      ready(pane)
    end,
  })
  -- Process the original card #1 delayedCall(0) on the first available host clock step.
  advance(0)
end
WinResConfig.MiniGameSkillChoiceWindow.package="ActivityDungeon1017Battle"
WinResConfig.MiniGameSkillChoiceWindow.comName="SkillChoiceWindow"

local function choose(id,confirm)
  assert(active and active.pane.touchable,"chooser is not touchable")
  local i
  for index, offer in ipairs(active.offers) do if offer.id==id then i=index; break end end
  assert(i,"not an offered skill")
  local widget=active.pane.tree.Main.TipsList.items[i]
  assert(widget.visible,"original card has not revealed yet")
  widget.onClick:Call()
  if confirm then active.pane.tree.Main.Time.SureBtn.onClick:Call() end
end
-- Network ends at this boundary, matching the original terminal state without submission.
MiniGameBattleMgr.SendBattleOverMsg=function(stageId, result)
  capturedResult={stageId=stageId,win=result.isBattleWin,loss=result.isBattleLoss,wave=result.wave,kills=result.killCount}
end
SoundManager={ClearTempBanks=function() end}
UpdateManager={RemoveFixedUpdateHandler=function() end,RemoveUpdateHandler=function() end}
MiniGameBattleHurtNum={ClearHurtNum=function() end,Init=function() end}
-- ResourceManager's visual-only zero-use object is selected by the original grid
-- branch on Android. Exact per-unit evidence is still required for actual actors.
local sourceInstantiate=ResourceManager.Instantiate
ResourceManager.Instantiate=function(path)
  if path=="Assets/Art/Test/empty.prefab" then
     return {transform={localScale={x=1,y=1,z=1}},Get3DPositionToUIPosition=function() return nil end}
  end
  return sourceInstantiate(path)
end
Application={platform="Android"}
RuntimePlatform={WindowsEditor="WindowsEditor",OSXEditor="OSXEditor"}
UIUtil.ChangeBattleScreenEffectIn=function(loaded) loaded() end
MiniGameBattleSceneMgr.InitBg=function() end
MiniGameBattleSceneMgr.InitUI=function() end
local function armExactTape(raw)
  local tape={}
  for word in raw:gmatch("%d+") do tape[#tape+1]=tonumber(word) end
  assert(#tape==50,"invalid RNG tape size")
  for _,value in ipairs(tape) do assert(value>=1 and value<=10000,"invalid RNG tape value") end
  local random, i=math.random,0
  math.random=function(low,high)
     assert(low==1 and high==10000,"new unclosed seed domain")
     i=i+1
     assert(tape[i],"unexpected extra initializer draw")
     return tape[i]
  end
  local ok,err=pcall(originalDataInit,{stageId=78000001})
  math.random=random
  assert(ok,err)
  assert(i==50)
end
local function init(tape, seedA, seedB)
  assert(not active,"cannot replace an active selection")
  rows, reachedChoice={}, false
  capturedResult,windowId=nil,0
  resetTimers()
  MiniGameBattleBuffMgr.Init()
  MiniGameBattleDataCount.Init()
  stageId, events, exhausted=78000001,{},false
  armExactTape(tape)
  -- Separate explicit QA seed for the original table.randomSort()->math.random.
  -- This does not change its implementation or re-use the 50 captured-style values.
  local a,b=math.randomseed(seedA or 70441022,seedB or 78000001)
  assert(a== (seedA or 70441022) and b==(seedB or 78000001),"unexpected RNG implementation; pin Lua 5.4")
  MiniGameBattleControl.Init()
  InitMiniGameBattleScene() -- authoritative grid, bounds and ordered init callback
  local s=MiniGameBattleScene
  assert(#s.allGird==270 and s.minY==-105 and s.maxY==255 and s.minX==-420 and s.maxX==600,
    "source scene geometry drift")
  speedScale=MiniGameBattleControl.baseTimeScale
  hook("start",MiniGameBattleData.selfHp,#s.cardList,#s.allGird,s.minX,s.maxX,s.minY,s.maxY)
end
local function nextChoiceOrEnd(maxFrame)
  while not active and not capturedResult and MiniGameBattleControl.curFixedFrame<maxFrame do
    tickMotion() -- upstream fixed-step order and win/loss calculation, including Stop
    -- The prefix's diagnostic log buffer is separate from this combat event trace.
    events={}
  end
end
local function runningTick() return MiniGameBattleControl.curFixedFrame end
local function afterPauseUnchanged()
  local t = runningTick()
  for i=1,600 do tickMotion() end
  assert(runningTick()==t,"original simulation advanced while skill choice open")
end
local function snapshotClock(kind)
  local s=active and active.pane.tree.Main.Time
  hook(kind,s and s.SureBtn.text or "none",schedulerTime,MiniGameBattleControl.isPause and 1 or 0,
    MiniGameBattleData.curRandomIndex,active and active.pane.touchable and 1 or 0)
end
function runChoiceAudit(tape,path)
  init(tape)
  localAuditSpeed(2)
  nextChoiceOrEnd(600)
  assert(active and not capturedResult,"first original choice not reached")
  afterPauseUnchanged()
  if path=="manual" then
    assert(not pcall(choose,-1,true),"unoffered skill accepted")
    if #active.offers>=2 then assert(not pcall(choose,active.offers[2].id,true),"concealed card accepted") end
    advance(400)
    choose(active.offers[#active.offers].id,true)
    assert(not active and not MiniGameBattleControl.isPause)
    assert(speedScale==2,"manual continue lost 2x")
    advance(31000)
    hook("old-timer-canceled",schedulerTime,MiniGameBattleData.curRandomIndex)
  elseif path=="selected-timeout" then
    advance(400)
    choose(active.offers[#active.offers].id,false)
    advance(29599)
    snapshotClock("pre-deadline")
    assert(active)
    advance(1)
    assert(not active and not MiniGameBattleControl.isPause)
  elseif path=="timeout" then
    advance(29999)
    snapshotClock("pre-deadline")
    assert(active and active.pane.touchable)
    advance(1)
    snapshotClock("forced-choice")
    assert(active and not active.pane.touchable and MiniGameBattleControl.isPause)
    afterPauseUnchanged()
    advance(499)
    assert(active and MiniGameBattleControl.isPause)
    advance(1)
    assert(not active and not MiniGameBattleControl.isPause)
  else
    error("unknown audit path")
  end
  hook("finished",schedulerTime,speedScale,MiniGameBattleData.curRandomIndex)
  return table.concat(rows,"\n")
end
function runFallbackAudit(tape)
  init(tape)
  local before=MiniGameBattleData.curRandomIndex
  local answer=MiniGameBattleMgr.GetRandomNum(40,-40) -- explicit synthetic, not a live Stage1 event
  assert(answer==0 and MiniGameBattleData.curRandomIndex==before+1)
  hook("fallback-proof",answer,MiniGameBattleData.curRandomIndex)
  return table.concat(rows,"\n")
end
function runChoiceQueueAudit(tape)
  init(tape)
  MiniGameBattleDataMgr.AddExp(105) -- fixture: 30 + 75, not gameplay evidence
  MiniGameBattleDataMgr.DealExpAdd()
  assert(active and active.level==1 and MiniGameBattleData.curLevel==2)
  afterPauseUnchanged()
  advance(400)
  choose(active.offers[#active.offers].id,true)
  assert(active and active.level==2 and active.generation==2 and MiniGameBattleControl.isPause)
  advance(29999)
  assert(active and MiniGameBattleControl.isPause)
  advance(1)
  assert(active and MiniGameBattleControl.isPause and not active.pane.touchable)
  advance(500)
  assert(not active and not MiniGameBattleControl.isPause)
  hook("batch-finished",MiniGameBattleData.curLevel,MiniGameBattleData.curExp,schedulerTime)
  return table.concat(rows,"\n")
end
function runStage1Audit(tape,policy)
  init(tape)
  for attempt=1,30 do
    nextChoiceOrEnd(12000)
    if capturedResult then
      hook("result",capturedResult.stageId,capturedResult.win and 1 or 0,capturedResult.loss and 1 or 0,
        capturedResult.wave,capturedResult.kills)
      return table.concat(rows,"\n")
    end
    assert(active,"whole stage exceeded deterministic bound")
    advance(400)
    -- Deliberately diagnostic tester policy; never metadata about natural user choices.
    -- Favor Annes's normal extension to stay inside the five verified unit resource rows.
    local pick
    if policy=="expanded" then
      local rank={78010130,78010230,78010120,78010131,78010132,78010133,78010231,78010232,78010233,
        78010112,78010113,78010212,78010213,78010121,78010122,78010123,78010111,78010211}
      for _,id in ipairs(rank) do
        for _,offer in ipairs(active.offers) do if offer.id==id then pick=id;break end end
        if pick then break end
      end
    end
    for _,offer in ipairs(active.offers) do
      if not pick and offer.unit.id==78000101 and BaseShootSkill[offer.id].type==11 then pick=offer.id;break end
    end
    if not pick then
      for _,offer in ipairs(active.offers) do
        if BaseShootSkill[offer.id].type==11 then pick=offer.id;break end
      end
    end
    assert(pick,"fully closed route blocked by offered skills "..active.offerString)
    choose(pick,true)
  end
  error("too many selections for bounded full Stage 1 audit")
end

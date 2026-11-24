-- Only log original Lua-to-Unity requests for explicitly invoked display schedules.
-- Never call, model, or predict the actual Unity Animator implementation.
local source=assert(AuditOriginalDisplay)
for _,name in ipairs({"PlayStart","PlayStand","PlayMove","PlayAttack","PlayDead","PlayStun","PlayBeatBack"}) do
  MiniGameBattleActionDisplay[name]=assert(source[name])
end
local trace,phase,creating={}, "boot", nil
local function record(kind,...)
  trace[#trace+1]=table.concat({kind,phase,MiniGameBattleControl.curFixedFrame,
    MiniGameBattleControl.curFrame,...},"\t")
end
local nativeAnimatorRequest=LuaUtil.PlayAnimator
LuaUtil.PlayAnimator=function(model,state)
  local owner=model and (model.auditOwner or creating)
  if owner then record("play-request",owner.uid,owner.id,state) end
  return nativeAnimatorRequest(model,state)
end
local newActor=MiniGameBattleUnit.NewUnit
MiniGameBattleUnit.NewUnit=function(data)
  if data.isGrid then return newActor(data) end
  assert(data.uid and data.id and not creating)
  creating={uid=data.uid,id=data.id}
  local unit=newActor(data)
  local owner=creating
  creating=nil
  assert(unit.uid==owner.uid and unit.id==owner.id and unit.model)
  unit.model.auditOwner=owner
  record("actor-created",owner.uid,owner.id,unit.curState,unit.waitFrameDestroy)
  local destroy=unit.DestroyModel
  unit.DestroyModel=function(self)
    if self.model and not self.isDisplayDestroyed then
      record("actor-model-destroy-request",owner.uid,owner.id,self.curState,self.curAnimation)
    end
    return destroy(self)
  end
  local apply=unit.UpdateModelTimeScale
  unit.UpdateModelTimeScale=function(self)
    local prev=self.modelTimeScale
    apply(self)
    if prev~=self.modelTimeScale then
      record("animator-speed-request",owner.uid,owner.id,prev,self.modelTimeScale)
    end
  end
  return unit
end
local timeScale=LoginData.SetTimeScale
LoginData.SetTimeScale=function(scale)
  record("global-timescale-request",scale)
  return timeScale(scale)
end
function animAuditMark(s)
  phase=s
end
function animAuditDisplay()
  phase="display"
  MiniGameBattleControl.UpdateDisplay()
  phase="fixed"
end
function animAuditSnapshot(uid)
  local s=MiniGameBattleScene
  local u=s.unitByUid[uid]
  local present=u and u.model and not u.isDisplayDestroyed
  return table.concat({MiniGameBattleControl.curFixedFrame,MiniGameBattleControl.curFrame,
    MiniGameBattleControl.isPause and 1 or 0,
    present and 1 or 0,u and u.id or "-",
    u and u.curState or "-",u and u.curAnimation or "-",u and u.waitFrameDestroy or "-"},"\t")
end
function animAuditLog() return table.concat(trace,"\n") end

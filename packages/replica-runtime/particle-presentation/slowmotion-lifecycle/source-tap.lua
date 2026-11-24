-- Dedicated local QA/preview lane; wraps original methods, never a replacement gameplay implementation.
local EffectPath="Assets/Art/Effects/Prefab/UI_prefab/MiniGame/MiniGame022/Minigame022_slowmotion_buff.prefab"
local New, Inst, Pos, Scale, Sort, Destroy=MiniGameBattleUnit.NewUnit,ResourceManager.Instantiate,LuaUtil.SetLocalPos,LuaUtil.SetScale,SortingHelper.SetOrderInLayer,ResourceManager.DestroyGameObject
local ctx,phase,rows,fxSerial=nil,nil,{},0
local instances={}
local function row(action,r,...)
  assert(#rows<256,"Slowmotion callback cap")
  rows[#rows+1]=table.concat({action,r.serial,r.uid,MiniGameBattleControl.curFixedFrame,MiniGameBattleControl.curFrame,...},"\t")
end
local function scoped(self,op,fn,...)
  assert(ctx==nil,"Unexpected re-entrant Slowmotion source scope")
  ctx={unit=self,op=op}
  local ok,result=pcall(fn,self,...)
  ctx=nil
  if not ok then error(result,0) end
  return result
end
MiniGameBattleUnit.NewUnit=function(...)
  local u=New(...)
  local display,dispose=u.UpdateBuffEffect,u.DestroyModel
  function u:UpdateBuffEffect(...) return scoped(self,"effect",display,...) end
  function u:DestroyModel(...) return scoped(self,"parent",dispose,...) end
  return u
end
ResourceManager.Instantiate=function(path)
  if path~=EffectPath then return Inst(path) end
  assert(ctx and ctx.op=="effect" and phase=="display" and ctx.unit.uid,"Slowmotion demanded by an unsupported callback")
  fxSerial=fxSerial+1
  local obj={transform={}}
  local r={serial=fxSerial,uid=ctx.unit.uid,step=0,obj=obj}
  instances[obj]=r
  row("instantiate",r,path)
  return obj
end
LuaUtil.SetLocalPos=function(obj,a,b,c,...)
  local r=instances[obj]
  if not r then return Pos(obj,a,b,c,...) end
  assert(r.step==0 and ctx and obj.transform.parent==ctx.unit.model.transform and r.uid==ctx.unit.uid and a==0 and b==0 and c==0)
  r.step=1
  row("attach",r,"unit.model.transform","SetParent(true)")
  row("local-origin",r,a,b,c)
end
LuaUtil.SetScale=function(obj,...)
  assert(not instances[obj],"New source scale path held, no guess")
  return Scale(obj,...)
end
SortingHelper.SetOrderInLayer=function(obj,order,...)
  local r=instances[obj]
  if not r then return Sort(obj,order,...) end
  assert(r.step==1 and order==-2000)
  r.step=2;row("sort-request",r,order)
end
ResourceManager.DestroyGameObject=function(obj,...)
  local r=instances[obj]
  if not r then return Destroy(obj,...) end
  assert(r.step==2 and ctx and r.uid==ctx.unit.uid)
  if ctx.op=="effect" then assert(phase=="display") end
  row("destroy",r,ctx.op=="parent" and "destroy-model" or "effect-absent")
  instances[obj]=nil
end
function slowmotionTapBegin(name)
  assert(not phase and #rows==0 and (name=="boot" or name=="fixed" or name=="display" or name=="control"))
  phase=name
end
function slowmotionTapEnd()
  assert(phase and not ctx)
  for _,r in pairs(instances) do assert(r.step==2,"Incomplete Slowmotion callback") end
  local x=table.concat(rows,"\n")
  rows={};phase=nil
  return table.concat({MiniGameBattleControl.curFixedFrame,MiniGameBattleControl.curFrame,MiniGameBattleControl.isPause and 1 or 0,x},"\n")
end

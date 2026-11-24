-- Read-only display companion candidate. A receipt is not a native GameObject.
local path="Assets/Art/Effects/Prefab/UI_prefab/MiniGame/MiniGame022/Minigame022_10000118_frost.prefab"
local marker=MINI_GAME_BUFF_EFFECT_ID.ANNISI_TALENT_FREEZE
assert(marker==1007)
local scales={
 [MINI_GAME_BATTLE_UNIT_TYPE.NORMAL_ENEMY]=1,
 [MINI_GAME_BATTLE_UNIT_TYPE.ELIT_ENEMY]=2,
 [MINI_GAME_BATTLE_UNIT_TYPE.BOSS_ENEMY]=2.5,
}
local allowed={[78000201]=true,[78000202]=true,[78000203]=true,[78000204]=true,[78000205]=true}
local New,Inst,Pos,Scale,Sort,Destroy=MiniGameBattleUnit.NewUnit,ResourceManager.Instantiate,LuaUtil.SetLocalPos,LuaUtil.SetScale,SortingHelper.SetOrderInLayer,ResourceManager.DestroyGameObject
local ctx,phase,serial=nil,nil,0
local rows,live={},{}

local function row(op,u,...)
 assert(phase and #rows<1536)
 rows[#rows+1]=table.concat({op,MiniGameBattleControl.curFixedFrame,MiniGameBattleControl.curFrame,u.uid,u.id,...},"\t")
end
local function scoped(u,op,fn,...)
 assert(not ctx,"Reentrant native frost observation")
 ctx={unit=u,op=op}
 local ok,x=pcall(fn,u,...)
 ctx=nil
 if not ok then error(x,0) end
 return x
end
MiniGameBattleUnit.NewUnit=function(...)
 local u=New(...)
 local display,dispose,freeze=u.UpdateBuffEffect,u.DestroyModel,u.SetFreeze
 function u:UpdateBuffEffect(...) return scoped(self,"update",display,...) end
 function u:DestroyModel(...) return scoped(self,"destroy-model",dispose,...) end
 function u:SetFreeze(flag,...)
  local before=self.isFreeze
  local x=freeze(self,flag,...)
  if before~=self.isFreeze then
   assert(allowed[self.id] and self.camp==2 and type(before)=="boolean" and type(flag)=="boolean")
   local has=self:ContainEffectId(marker)
   assert(type(has)=="boolean" and has==self.isFreeze)
   row("status",self,marker,self.isFreeze and 1 or 0,self:GetHp(),self.camp)
  end
  return x
 end
 return u
end
ResourceManager.Instantiate=function(p,...)
 if p~=path then return Inst(p,...) end
 local u=ctx and ctx.unit
 assert(u and ctx.op=="update" and phase=="display" and allowed[u.id] and u.camp==2 and u.isFreeze==true and
  u:ContainEffectId(marker)==true and not u.freezeEffect and u.model and select("#",...)==0,"Unqualified exact frost request")
 local kind=scales[u.battleUnitType]
 local bodyScale=u.model.transform.localScale.x
 assert(kind and math.abs(bodyScale)>0 and math.abs(bodyScale)<100)
 serial=serial+1
 local o={transform={}}
 local r={serial=serial,unit=u,step=0,expectedScale=kind/math.abs(bodyScale),order=u.sortingOrder+1,obj=o}
 live[o]=r
 row("instantiate",u,serial,p,marker,u.camp,kind,bodyScale,u.sortingOrder)
 return o
end
local function use(o,s)
 local r=live[o]
 assert(ctx and ctx.unit==r.unit and ctx.op=="update" and phase=="display" and r.step==s)
 return r
end
LuaUtil.SetLocalPos=function(o,x,y,z,...)
 if not live[o] then return Pos(o,x,y,z,...) end
 local r=use(o,0)
 assert(o.transform.parent==r.unit.model.transform and x==0 and y==0 and z==0 and select("#",...)==0)
 r.step=1
 row("attach",r.unit,r.serial,"unit.model.transform",0,0,0)
end
LuaUtil.SetScale=function(o,x,y,z,...)
 if not live[o] then return Scale(o,x,y,z,...) end
 local r=use(o,1)
 assert(x==r.expectedScale and y==x and z==1 and select("#",...)==0)
 r.step=2
 row("scale",r.unit,r.serial,x,y,z)
end
SortingHelper.SetOrderInLayer=function(o,k,...)
 if not live[o] then return Sort(o,k,...) end
 local r=use(o,2)
 assert(k==r.order and select("#",...)==0)
 r.step=3
 row("sort",r.unit,r.serial,k)
end
ResourceManager.DestroyGameObject=function(o,...)
 local r=live[o]
 if not r then return Destroy(o,...) end
 assert(r.step==3 and ctx and r.unit==ctx.unit and r.unit.freezeEffect==o and select("#",...)==0)
 assert(ctx.op=="destroy-model" or ctx.op=="update" and phase=="display" and r.unit:ContainEffectId(marker)==false)
 row("destroy",r.unit,r.serial,ctx.op=="destroy-model" and "destroy-model" or "effect-absent")
 live[o]=nil
end
function frostBegin(s)
 assert(not phase and not ctx and #rows==0 and (s=="boot" or s=="fixed" or s=="display" or s=="control"))
 phase=s
end
function frostEnd()
 assert(phase and not ctx)
 for o,r in pairs(live) do assert(r.step==3 and r.unit.freezeEffect==o,"Incomplete original frost chain") end
 local x=table.concat(rows,"\n")
 rows={};phase=nil
 return table.concat({MiniGameBattleControl.curFixedFrame,MiniGameBattleControl.curFrame,MiniGameBattleControl.isPause and 1 or 0,x},"\n")
end

-- Scope-specific observer of existing native rule/scene requests only. Does not alter damage or instances.
local root="Assets/Art/Effects/Prefab/UI_prefab/MiniGame/MiniGame022/"
local profiles={
  [78000302]={owner=78000103,path=root.."Minigame022_10000104_skill3_summon.prefab"},
  [78000303]={owner=78000104,path=root.."Minigame022_10000101_skill3_summon.prefab"}
}
local qualified,attached,creating,rows=nil,{},nil,{}
function earlyFxScope(stage)
  assert(not qualified and stage>=78000003 and stage<=78000006)
  qualified=stage<=78000004 and 78000302 or 78000303
  assert(BaseShootCard[qualified].spd==profiles[qualified].path,"Exact original summon path differs")
end
local function row(op,uid,...)
  assert(#rows<128 and qualified)
  rows[#rows+1]=table.concat({op,uid,qualified,MiniGameBattleControl.curFixedFrame,MiniGameBattleControl.curFrame,...},"\t")
end
local make=MiniGameBattleUnit.NewUnit
local allocate=ResourceManager.Instantiate
local add=BattleResourceManager.AddGameObject
local destroy=BattleResourceManager.DestroyGameObject
ResourceManager.Instantiate=function(path,...)
  local m=allocate(path,...)
  if qualified and path==profiles[qualified].path then
    assert(creating and not creating.instance and m~=nil,"Unbound exact summon prefab")
    creating.instance=m
  end
  return m
end
BattleResourceManager.AddGameObject=function(self,m,x,y,z,sx,sy,sz,...)
  if creating and creating.instance==m then
    assert(not creating.added and x==0 and y==0 and z==0 and sx>0 and sy>0 and sz==1)
    creating.added=true
  end
  return add(self,m,x,y,z,sx,sy,sz,...)
end
MiniGameBattleUnit.NewUnit=function(d,...)
  if d.id~=qualified then return make(d,...) end
  local p=profiles[qualified]
  assert(not creating and d.summonFromUnitId==p.owner and d.summonFromUnitUid>0 and d.uid~=d.summonFromUnitUid)
  creating={};local u=make(d,...);local a=creating;creating=nil
  assert(u.id==qualified and u.uid==d.uid and u.model==a.instance and a.added and not attached[u.model] and u.waitFrameDestroy==0)
  attached[u.model]={uid=d.uid,owner=d.summonFromUnitUid}
  row("create",d.uid,p.path,p.owner,d.summonFromUnitUid)
  return u
end
BattleResourceManager.DestroyGameObject=function(self,m,...)
  if attached[m] then row("destroy",attached[m].uid);attached[m]=nil end
  return destroy(self,m,...)
end
function earlyFxDrain()
 local r=table.concat(rows,"\n");rows={};return r
end

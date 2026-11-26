-- Headless Stage1 prefix only, stops at the first original skill-choice window.
-- Headless model facade is fed exact Unity local sockets/Animator die length.
-- Not a playable scenario; no remote progression, effects, audio, or FairyGUI.
local savedInit = localAuditInit
local rawSpawnAudit = MiniGameBattleSceneMgr.AddMonster
local rows, reachedChoice
local no = function() end
local function emit(kind, ...)
  local args = {...}
  local fields = {kind, MiniGameBattleControl.curFixedFrame}
  for _, value in ipairs(args) do fields[#fields + 1] = tostring(value) end
  rows[#rows + 1] = table.concat(fields, "\t")
end
local function f32(value)
  return string.unpack("f", string.pack("f", value))
end
local function vec(x,y,z) return {x=x,y=y,z=z} end
local function socket(arr) return {transform={localPosition=vec(arr[1],arr[2],arr[3])}} end
local function model(path)
  local source = assert(NATIVE_PREFABS[path:lower()], "unclosed model prefab " .. tostring(path))
  local clips = {Length=source.die > 0 and 1 or 0}
  if source.die > 0 then clips[0]={name="die",length=source.die} end
  return {source = source, transform={localScale=vec(1,1,1)}, sockets={bullet=socket(source.bullet),hit=socket(source.hit)},
    Get3DPositionToUIPosition=function() return nil end,
    GetComponentInChildren=function(_,type)
      if type == "Animator" then return {runtimeAnimatorController={animationClips=clips}} end
    end}
end
local visualBulletPaths = {}
for _, skill in pairs(BaseShootSkill) do
  if type(skill.bullet_effect) == "string" then visualBulletPaths[skill.bullet_effect:lower()] = true end
end
ResourceManager = {
  Instantiate = function(path)
    if type(path) ~= "string" then error("unexpected non-string authored resource") end
    if NATIVE_PREFABS[path:lower()] then return model(path) end
    assert(visualBulletPaths[path:lower()], "unclosed non-visual resource " .. path)
    -- Sim collision depends on its Lua radius/topology, not this display symbol.
    return {transform={localScale=vec(1,1,1)}}
  end,
  DestroyGameObject=no,
}
BattleResourceManager = {
  AddGameObject = function(_, m, _,_,_, x,y,z)
    m.transform.localScale = vec(f32(x or 1), f32(y or 1), f32(z or 1))
  end,
  DestroyGameObject=no,
}
LuaUtil = {
  FindChild=function(m,name)
    if name == "model" then return nil end -- display-only skinned/color effect target
    assert(m.sockets, "could not bind a non-visual socket")
    return assert(m.sockets[name], "unclosed socket " .. tostring(name))
  end,
  ChangeLayer=no, PlayAnimator=no, SetLocalPos=no,
  SetScale=function(m,x,y,z,multiply)
    local current=m.transform.localScale
    if multiply then x,y,z=x*current.x,y*current.y,z*current.z end
    m.transform.localScale=vec(f32(x),f32(y),f32(z))
  end
}
Vector3, typeof = vec, function(x) return x end
CS={UnityEngine={Animator="Animator"}}
SortingHelper={SetOrderInLayer=no}
UIMgr.GetLayerRoot=function() return nil end
T=function(id) return tostring(id) end -- config names never used by gameplay
print_battle=no
MiniGameBattleActionDisplay={
  PlayStart=no,PlayStand=no,PlayMove=no,PlayAttack=no,PlayDead=no,PlayBeatBack=no,
  PlayHurt=no,PlaySound=no,PlayMonsterAppearEffect=no,PlayHitEffect=no,PlayEffect=no,
}
WinResConfig.MiniGameSkillChoiceWindow={name="SkillChoiceWindow"}
OpenWindow=function(name, ignored, levels)
  assert(name=="SkillChoiceWindow" and #levels >= 1, "unexpected UI branch " .. tostring(name))
  reachedChoice=true
  emit("choice",levels[1], MiniGameBattleData.curLevel, MiniGameBattleData.curExp, MiniGameBattleData.killEnemyCount)
end
local tables={BaseAttribute=BaseAttribute,BaseShootStage=BaseShootStage,BaseShootCard=BaseShootCard,BaseShootMonsterGroup=BaseShootMonsterGroup,
 BaseShootSkill=BaseShootSkill,BaseShootSkillBuff=BaseShootSkillBuff,BaseSkillParameter=BaseSkillParameter}
TableData.GetTable=function(name) return assert(tables[name],"unclosed table "..tostring(name)) end
TableData.GetConfig=function(id,name) return assert(TableData.GetTable(name)[id],"unknown config "..name..":"..tostring(id)) end
CardAttribute.InitAttrEnum()

MiniGameBattleSceneMgr.AddUnit=OriginalCombat.AddUnit
MiniGameBattleSceneMgr.UpdateProcess=OriginalCombat.UpdateProcess
MiniGameBattleSceneMgr.UpdateBattleOverState=OriginalCombat.UpdateBattleOverState
MiniGameBattleSceneMgr.AddMonster=function(id,pos,hp,exp)
  rawSpawnAudit(id,pos,hp,exp)
  OriginalCombat.AddMonster(id,pos,hp,exp)
  local u=MiniGameBattleScene.aliveMonsterList[1]
  emit("spawn",u.uid,id,pos,u:GetHp(),u.waitFrameDestroy)
end
MiniGameBattleSceneMgr.AddBullet=function(attacker,src,dst,param)
  local bullet=OriginalCombat.AddBullet(attacker,src,dst,param)
  emit("bullet",attacker.id,param.skillId,bullet.uid,src.x,src.y,dst.x,dst.y)
  return bullet
end
local nativeHurt=MiniGameBattleAction.DealHurt
MiniGameBattleAction.DealHurt=function(a,d,num,display,extra,effect)
  local hp=d:GetHp()
  local real=nativeHurt(a,d,num,display,extra,effect)
  emit("hit",a.id,d.id,d.uid,num,real,hp,d:GetHp())
  return real
end

function runPrefix(seedTape)
  rows,reachedChoice={},false
  MiniGameBattleBuffMgr.Init()
  MiniGameBattleDataCount.Init()
  savedInit(78000001,seedTape)
  emit("start",MiniGameBattleData.selfHp, #MiniGameBattleScene.cardList)
  for i=1,600 do
    localAuditStep(1)
    if reachedChoice then break end
  end
  assert(reachedChoice,"initial skill-choice not reached within guarded scope")
  assert(MiniGameBattleControl.isPause,"authored skill-choice did not pause")
  local pausedTick, rowCount = MiniGameBattleControl.curFixedFrame, #rows
  localAuditStep(600)
  assert(MiniGameBattleControl.curFixedFrame == pausedTick and #rows == rowCount,"paused original engine advanced")
  return table.concat(rows,"\n")
end

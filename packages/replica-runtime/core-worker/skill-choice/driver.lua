-- Local controlled execution/selection seam. Rendering/presentation is not part of this state.
local eventCursor, started=0,false
local function bounded(x,lo,hi)
  return type(x)=="number" and x%1==0 and x>=lo and x<=hi
end
function choiceSessionStart(tape,a,b)
  assert(not started and bounded(a,0,2147483647) and bounded(b,0,2147483647),
    "invalid or already-started local Stage1 session")
  init(tape,a,b)
  started=true
  return true
end
function choiceSessionFixed(frames)
  assert(started and bounded(frames,1,600),"invalid fixed tick quota")
  if capturedResult or MiniGameBattleControl.isPause then return 0 end
  local from=runningTick()
  nextChoiceOrEnd(math.min(12000,from+frames))
  assert(runningTick()<12000 or capturedResult,"Stage1 local safety limit reached")
  return runningTick()-from
end
function choiceSessionClock(ms)
  assert(started and bounded(ms,0,60000),"invalid unscaled clock step")
  if not capturedResult then advance(ms) end
  return schedulerTime
end
function choiceSessionSelect(window,generation,id,confirm)
  assert(started and active and not capturedResult and window==windowId and generation==active.generation,
         "stale skill offer")
  assert(bounded(id,78000000,78999999) and type(confirm)=="boolean","invalid selection inputs")
  choose(id,confirm)
  return true
end
function choiceSessionSpeed(speed)
  assert(started and (speed==1 or speed==2),"invalid battle speed")
  if not capturedResult then
    MiniGameBattleData.speedIndex=speed
    localAuditSpeed(speed)
  end
  return speedScale
end
function choiceSessionSnapshot()
  assert(started,"session not initialized")
  local d=MiniGameBattleData
  local s=MiniGameBattleScene
  local function n(bool) return bool and 1 or 0 end
  local r={table.concat({"state",runningTick(),78000001,
     capturedResult and capturedResult.wave or s.curMonsterWave,
     capturedResult and capturedResult.kills or d.killEnemyCount,d.curLevel,d.curExp,
     d.selfHp,d.selfMaxHp,d.speedIndex,schedulerTime,n(MiniGameBattleControl.isPause),
     n(capturedResult and capturedResult.win),n(capturedResult and capturedResult.loss),
     n(capturedResult~=nil)}, "\t")}
  if active then
    r[#r+1]=table.concat({"choice",windowId,active.generation,active.level,
        math.max(0,active.openedMs+30000-schedulerTime),n(active.pane.touchable),active.offerString},"\t")
    for i,w in ipairs(active.pane.tree.Main.TipsList.items) do
      r[#r+1]=table.concat({"visibility",i,n(w.visible)},"\t")
    end
  end
  if not capturedResult then
    for _,u in ipairs(s.allUnit) do
      if u.id and not u:IsDestroy() then
        r[#r+1]=table.concat({"unit",u.uid,u.id,u.position.x,u.position.y,u.position.z,
           u.camp,u.curState,n(u.isFlip)},"\t")
      end
    end
  end
  return table.concat(r,"\n")
end
function choiceSessionEvents()
  assert(started)
  local value=table.concat(rows,"\n",eventCursor+1)
  eventCursor=#rows
  return value
end

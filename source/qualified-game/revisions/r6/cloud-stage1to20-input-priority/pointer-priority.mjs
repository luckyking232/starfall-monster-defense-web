/** Holds at most one exact target from the currently painted original upgrade window. */
const positive=n=>Number.isSafeInteger(n)&&n>0;
const inRect=([x,y,w,h],a,b)=>a>=x&&a<x+w&&b>=y&&b<y+h;
function identity(frame){
 const m=frame?.model,s=frame?.state,c=s?.battle?.choice;
 if(frame?.plane!=='choice'||s?.phase!=='upgrade'||!m?.visible||!c?.touchable||
   !Number.isFinite(c.remainingMs)||c.remainingMs<=0||
   typeof s.runId!=='string'||!s.runId||!positive(s.scope?.stageId)||
   !positive(m.windowId)||!positive(m.generation)||m.windowId!==c.windowId||m.generation!==c.generation)
  return null;
 return {run:s.runId,stage:s.scope.stageId,windowId:m.windowId,generation:m.generation,selected:m.selected};
}
export function hasPaintedChoiceTarget(painted,x,y){
 if(![x,y].every(Number.isFinite)||!identity(painted))return false;
 return painted.model.targets.some(t=>inRect(t.rect,x,y));
}
export function createChoicePriority(){
 let held=null;
 return Object.freeze({
  get waiting(){return held!==null;},
  queue(owner,painted,x,y){
   if(held||!owner||![x,y].every(Number.isFinite))return false;
   const key=identity(painted);
   if(!key)return false;
   const t=painted.model.targets.find(q=>inRect(q.rect,x,y));
   if(!t||!positive(t.skillId)||!['offer','confirm'].includes(t.target)||
      (t.target==='confirm'&&key.selected!==t.skillId))return false;
   held={owner,key,x,y,target:t.target,skillId:t.skillId};
   return true;
  },
  clear(){held=null;},
  take(owner){
   const t=held;held=null;
   if(!t||owner!==t.owner)return null;
   const next=owner.frame(),key=identity(next);
   if(!key||next.state.pendingCommand||
    !['run','stage','windowId','generation','selected'].every(k=>key[k]===t.key[k]))
    return null; // Rule timer/choice generation or selected card became stale.
   const live=owner.hover(t.x,t.y,next);
   if(live?.target!==t.target||live.skillId!==t.skillId)return null;
   return [t.x,t.y]; // Only the ordinary shell pointer can dispatch the actual selection.
  }
 });
}

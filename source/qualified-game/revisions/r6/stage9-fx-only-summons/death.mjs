export const DEATH_CARD=78000206;
const BUNDLE='84c63f1a28dcc746b573a764fb661c40',CONTROLLER='4338523917390462401',CLIP='-5682148573797749937';
const die=new Set(['DYING','DEAD']);
const fail=(p,m)=>{if(!p)throw Object.assign(Error(m),{code:'preview-20108-death-invalid'});};
export function exactEmptyDie(a,ctrl,state,clip){
 if(state?.stateName!=='die')return false;
 fail(a.source.bundle===BUNDLE&&ctrl.pathId===CONTROLLER&&ctrl.states[3]===state&&
   state.animationClipPathId===CLIP&&state.stateHash===1036227598&&clip?.pathId===CLIP&&clip.spriteCurves?.length===0,
   'Exact 20108 authored state3 die clip mismatch');
 return true;
}
export function openDeathHold(index,stageId,permitExactFx){
 fail(stageId===78000009&&typeof permitExactFx==='function'&&index.stageId===stageId&&index.units[DEATH_CARD]?.bundle===BUNDLE,'wrong late-stage asset scope');
 const born=new Set(),held=new Set(),dead=new Set(),requested=new Set();
 let run=null,request=0,holdFx=null;
 return Object.freeze({
  consume(c){
   for(const a of c.rows){
    if(a[5]!==String(DEATH_CARD))continue;
    const uid=Number(a[4]);
    fail(Number.isSafeInteger(uid)&&uid>0,'Invalid 20108 model UID');
    if(a[0]==='actor-created'){
     fail(!born.has(uid)&&a[7]==='30','Wrong 20108 original model frame policy');born.add(uid);
    }else if(a[0]==='play-request'&&a[6]==='die'){
     fail(born.has(uid)&&!dead.has(uid),'20108 die request does not belong to a current original model');requested.add(uid);
    }else if(a[0]==='actor-model-destroy-request'){
     fail(born.has(uid)&&!dead.has(uid),'20108 original model destroy identity mismatch');dead.add(uid);
    }
   }
  },
  decide(p){
   const world=p.state.units;
   fail(p.stageId===stageId&&p.state.stageId===stageId&&typeof p.runId==='string'&&(run===null||p.runId===run)&&
     Number.isSafeInteger(p.requestId)&&p.requestId>=request,'wrong 20108 death authority');
   run=p.runId;request=p.requestId;
   if(p.state.terminal)return null; // Final settlement has no body presentation and may close the entire scene.
   fail(world.every(u=>Object.hasOwn(index.units,u.cardId)||permitExactFx(p,u)),'Unknown actor in death-window scope');
   const by=new Map(world.map(u=>[u.uid,u]));
   for(const u of world.filter(x=>x.cardId===DEATH_CARD)){
    fail(u.camp===2&&u.flipped&&born.has(u.uid),'20108 ordinary actor identity mismatch');
    if(die.has(u.stateName)){
     if(!held.size)holdFx=p.state.fixedFrame;
     held.add(u.uid);
    }else fail(!held.has(u.uid)&&!dead.has(u.uid)&&!requested.has(u.uid),'20108 held model returned before an exact removal');
   }
   for(const uid of held)if(!by.has(uid)){
    fail(dead.has(uid),'20108 left authoritative scene without original model destroy');held.delete(uid);
   }
   if(!held.size){holdFx=null;return null;}
   return Object.freeze({stageId,runId:run,requestId:request,fixed:p.state.fixedFrame,holdStart:holdFx,
    units:Object.freeze([...held].sort((a,b)=>a-b).map(uid=>Object.freeze({uid,dieRequestObserved:requested.has(uid)}))),
    rendered:false,reason:'original_20108_state3_no_draw_until_actual_remove'});
  },
  assertNoDieProjection(frame){
   fail(!frame.snapshot.units.some(a=>a.cardId===DEATH_CARD&&(a.stateName==='die'||held.has(a.uid))),
    '20108 empty die cannot be presented');
  }
 });
}

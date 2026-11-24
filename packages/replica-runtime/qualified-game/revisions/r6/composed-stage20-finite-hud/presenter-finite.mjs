/** Strict same-object local HUD commit. Staging remains invisible until current authoritative view accepts it. */
export function openHudPresenter({canvas,staging,painter,isCurrent=()=>true}){
 if(!canvas||!staging||canvas.width!==1334||canvas.height!==750||staging.width!==1334||staging.height!==750)
  throw Error('Stage7/8 reference HUD surface dimensions');
 const g=canvas.getContext('2d');
 if(!g)throw Error('Stage7/8 HUD canvas unavailable');
 let generation=0,closed=false,saved=null,shown=null,error=null,tail=Promise.resolve();
 const hidden=()=>{if(isCurrent())canvas.dataset.hudVisible='false';shown=null;};
 hidden();
 const close=()=>{generation++;closed=true;saved=null;hidden();painter.dispose();};
 return Object.freeze({
  async commit(c){
   if(closed)return false;
   const mine=++generation;saved=null;
   if(!c?.frame||!c?.hud||c.hud.fixedFrame===0){hidden();return false;}
   const f=c.frame, h=c.hud;
   const live=Number.isSafeInteger(f.stageId)&&f.stageId>=78000009&&f.stageId<=78000020&&h.runId===f.runId&&h.stageId===f.stageId&&
    h.displayRef===f.display&&h.commandsRef===f.commands&&h.snapshotRef===f.snapshot&&
    ((h.mode==='freeze-prior-exact-display'&&h.currentRequestId===f.requestId&&h.requestId===f.frozenFromRequestId)||
     (h.mode==='explicit-stage9to20-same-display-partial-hud/1'&&h.requestId===f.requestId))&&h.sourceSnapshotOnly===true&&
    h.blurSourceQualified===false&&h.plan.nativeUnityFrame===false;
   if(!live){hidden();error='HUD 与原显示请求不同；不替画。';return false;}
   const task=tail.then(async()=>{
   if(closed||mine!==generation)return false;
   try{
    await painter.paint(h.plan,{allowPartial:true});
    if(!closed&&mine===generation){saved=f;return true;}
   }catch(e){if(!closed&&mine===generation){error=String(e.message).slice(0,175);hidden();}}
   return false;
   });
   tail=task.catch(()=>{});
   return task;
  },
  update(frame,{visible=false,phase=''}={}){
   if(closed||!isCurrent()||!visible||!['battle','paused','exit-confirm'].includes(phase)||!saved||frame!==saved){hidden();return false;}
   if(shown===saved)return true;
   try{
    g.save();
    try{g.setTransform(1,0,0,1,0,0);g.clearRect(0,0,1334,750);g.drawImage(staging,0,0);}
    finally{g.restore();}
    shown=saved;canvas.dataset.hudVisible='true';return true;
   }catch(e){error=String(e.message).slice(0,175);hidden();return false;}
  },close,get error(){return error;}
 });
}

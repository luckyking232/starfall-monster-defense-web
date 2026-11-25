/** Display only. Never dispatches a battle request or consumes a lifecycle event. */
const allowed=new Set(['battle-ready','battle','paused','exit-confirm','upgrade','settlement']);
const valid=o=>o&&Number.isSafeInteger(o.generation)&&Number.isSafeInteger(o.stageId)&&typeof o.runId==='string'&&o.runId.length>0;
const same=(a,b)=>valid(a)&&valid(b)&&a.generation===b.generation&&a.stageId===b.stageId&&a.runId===b.runId;

export function createFrameFront({paint,clear,mismatchMs=2200,now=()=>performance.now()}){
 if(typeof paint!=='function'||typeof clear!=='function'||!Number.isFinite(mismatchMs)||mismatchMs<=0)
  throw new TypeError('Invalid presentation front');
 let shown=null,staleAt=null,active=null;
 function reset(){
  if(shown)clear();
  shown=staleAt=null;
 }
 function scope(owner,phase){
  const next=valid(owner)&&allowed.has(phase)?owner:null;
  if(next&&active&&next.generation<active.generation)return false;
  if(!same(next,active)){reset();active=next?{...next}:null;}
  return !!active;
 }
 return Object.freeze({reset,scope,
  submit(owner,phase,frame,pixels){
   if(!allowed.has(phase)||!same(owner,active)||frame?.stageId!==owner.stageId||frame?.runId!==owner.runId||
      !Number.isSafeInteger(frame.requestId)||frame.requestId<1||!pixels)return false;
   if(shown&&frame.requestId<shown.frame.requestId)return false;
   if(shown?.frame===frame)return true;
   // Single replacement of the entire visible target; no pre-commit clear.
   paint(pixels);shown={owner:{...owner},frame};staleAt=null;return true;
  },
  view(owner,phase,{exact=false,error=false,hidden=false}={}){
   if(!same(owner,active)||!same(owner,shown?.owner)||!allowed.has(phase))return 'empty';
   if(hidden)return 'hidden';
   if(error){staleAt=null;return 'fault';}
   if(exact){staleAt=null;return 'current';}
   if(['upgrade','paused','exit-confirm','settlement'].includes(phase)){staleAt=null;return 'frozen';}
   staleAt??=now();
   return now()-staleAt>=mismatchMs?'stale':'previous';
  }
 });
}

/** Routes Canvas2D pixels to a shared front; the old render targets are never visible. */
export function openCanvasFront(canvas,{onChange=()=>{},invalidateStaging=()=>{}}={}){
 const ctx=canvas.getContext('2d',{alpha:true});
 let lost=false,closed=false;
 const alive=()=>!!ctx&&!lost&&!closed&&ctx.isContextLost?.()!==true;
 const front=createFrameFront({
  paint(pixels){
   if(!alive()||pixels.width!==canvas.width||pixels.height!==canvas.height)throw new Error('Presentation buffer unavailable');
   ctx.putImageData(pixels,0,0);
  },
  clear(){if(alive())ctx.clearRect(0,0,canvas.width,canvas.height);}
 });
 function loss(event){event.preventDefault?.();lost=true;front.reset();invalidateStaging();onChange();}
 function restoration(){lost=false;invalidateStaging();onChange();}
 canvas.addEventListener?.('contextlost',loss);
 canvas.addEventListener?.('contextrestored',restoration);
 return {alive,front,close(){front.reset();closed=true;canvas.removeEventListener?.('contextlost',loss);canvas.removeEventListener?.('contextrestored',restoration);}};
}

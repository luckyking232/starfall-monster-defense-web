export const MAX_HOLD_MS=400;
const phases=new Set(['battle-ready','battle','paused','exit-confirm']);
const same=(a,b)=>a&&b&&a.epoch===b.epoch&&a.stageId===b.stageId&&a.runId===b.runId&&a.surface===b.surface;
const valid=x=>x&&Number.isSafeInteger(x.epoch)&&[78000001,78000002,78000003,78000004,78000005,78000006].includes(x.stageId)&&typeof x.runId==='string'&&x.runId.length>0&&
 Number.isSafeInteger(x.requestId)&&x.requestId>0&&x.surface;
export function createHoldPolicy({now=()=>performance.now(),maxMs=MAX_HOLD_MS}={}){
 if(!Number.isFinite(maxMs)||maxMs<1||maxMs>MAX_HOLD_MS)throw Error('Previous-frame deadline failed closed');
 let shown=null,since=null,prev=-Infinity;
 function reset(){shown=null;since=null;}
 return Object.freeze({reset,update({authority,match,work,phase,fail,hidden,expectedStage,isAlive=true}){
  const time=now();
  if(!Number.isFinite(time)||time<prev){reset();return {kind:'hide'};}
  prev=time;
  const good=isAlive===true&&!fail&&!hidden&&phases.has(phase)&&valid(authority)&&authority.stageId===expectedStage;
  if(!good){reset();return {kind:'hide'};}
  if(match===true){shown=authority;since=null;return {kind:'current'};}
  // Consecutive unaccepted requests cannot refresh the original deadline. After
  // expiry the framebuffer is forgotten until a real present succeeds again.
  if(!['battle','paused'].includes(phase)||work!==true||!valid(shown)||!same(authority,shown)||authority.requestId<=shown.requestId){
   reset();return {kind:'hide'};
  }
  since??=time;
  if(time-since>=maxMs){reset();return {kind:'hide'};}
  return {kind:'previous',remaining:maxMs-(time-since)};
 }});
}
/** Capture bytes semantically submitted by the existing qualified 2D renderer; never expose its staging target. */
export function captureCpuFront(front,{alpha,onLost=()=>{}}={}){
 const ctx=front.getContext('2d',{alpha});
 if(!ctx||front.width!==1334||front.height!==750)throw Error('Original independent CPU display surface unavailable');
 let live=true,lost=false,stage=null,generation=0,proof=null,shownFrame=null,visiblePixels=false;
 const alive=()=>live&&!lost&&front.width===1334&&front.height===750&&ctx.isContextLost?.()!==true;
 const sink={width:1334,height:750,getContext(kind,o){
  if(kind!=='2d'||o?.alpha!==alpha)throw Error('CPU painter requested different target');
  return {createImageData:(...args)=>ctx.createImageData(...args),
   putImageData(img,x,y){
    if(!alive()||x!==0||y!==0||img.width!==1334||img.height!==750||!(img.data instanceof Uint8ClampedArray)||img.data.length!==1334*750*4)
     throw Error('Invalid original staged CPU frame');
    stage=img;generation++;
   },
   clearRect(){stage=null;generation++;}
  };
 }};
 function clear(){
  if(visiblePixels){visiblePixels=false;shownFrame=null;try{ctx.clearRect(0,0,1334,750);}catch{/* Lost surface remains hidden. */}}
 }
 function lose(){if(!lost){lost=true;clear();onLost();}}
 front.addEventListener?.('contextlost',lose);
 function wrap(observer){
  return Object.freeze({close(){observer.close();},...Object.fromEntries(['begin','observe','display'].map(op=>[op,async(...args)=>{
   const result=await observer[op](...args);
   proof=result.frame&&stage?{frame:result.frame,generation}:null;
   return result;
  }]))});
 }
 return Object.freeze({sink,wrap,alive,clear,has:()=>visiblePixels,
  commit(frame){
   if(!alive())return false;
   if(shownFrame===frame&&visiblePixels)return true;
   if(!frame||proof?.frame!==frame||proof.generation!==generation||!stage)return false;
   ctx.putImageData(stage,0,0);shownFrame=frame;visiblePixels=true;return true;
  },
  destroy(){if(live){live=false;front.removeEventListener?.('contextlost',lose);stage=proof=null;clear();}}
 });
}

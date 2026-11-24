/** Visual-only continuation. This module does not import/pass the native popup authority. */
import {createPackedBlur,ORIGINAL_BLUR_PROGRAMS} from '../blur-presentation/webgl.mjs';
import {STAGE1_SHA256} from '../stage-renderer/native-stage.mjs';
import {PREVIEW_SCHEMA,RECONSTRUCTION} from '../presentation-clock/presentation-clock.mjs';
export const SCHEMA='starfall-private-reconstructed-popup-blur/1';
export const PROFILE=Object.freeze({
  capturePlane:'reconstructed-world-plus-committed-pre-popup-hud',
  width:1334,height:750,orientation:'bottom-left',encoding:'scene-linear-rgba32f',
  blend:'unpremultiplied-opaque',composite:'linear-source-over-world-then-old-hud',
  layers:'world,previous-hud',sampler:'linear-clamp',targetFormat:'rgb111110float',
});
export const DESTINATION=Object.freeze({
  orientation:'bottom-left',targetFormat:'rgb111110float',
  policy:'reconstructed-same-context-linear-to-qualified-local-target',
});
const SHA=/^[a-f0-9]{64}$/u;
const int=(n,a=0,b=2147483647)=>Number.isSafeInteger(n)&&n>=a&&n<=b;
const same=(given,exact)=>given&&Object.keys(given).length===Object.keys(exact).length&&
  Object.entries(exact).every(([k,v])=>given[k]===v);
const verify=(x,reason)=>{if(!x)throw Object.assign(new Error(reason),{code:reason});};
const status=(state,reason,key)=>Object.freeze({schema:SCHEMA,state,reason,popupKey:key,
  outputKind:'reconstructed-lower-frame-with-original-packed-passes',nativeUnityFrame:false});
const identity=(r)=>JSON.stringify([r.runId,r.state.choice.windowId,r.state.choice.generation]);
const complete=(r)=>r?.protocol==='starfall-stage1-rules/1'&&
  r.gates?.sourceState==='integrity_verified'&&r.state?.stageId===78000001&&
  typeof r.runId==='string'&&r.runId.length<=64&&int(r.requestId,1)&&int(r.state.fixedFrame)&&int(r.state.elapsedMs);
const expectedFrame=(f,p)=>f?.schema===PREVIEW_SCHEMA&&f.lane===RECONSTRUCTION&&
  f.nativeRuntimePose===false&&f.fullSceneNativeParity===false&&
  f.nativeIndexSha256===STAGE1_SHA256&&f.protocol===p.protocol&&f.runId===p.runId&&f.requestId===p.requestId&&
  f.viewport?.width===PROFILE.width&&f.viewport?.height===PROFILE.height&&
  Array.isArray(f.dispositions)&&!f.dispositions.some(x=>x.status!=='authored_sprite_preview');
const lower=(f,p)=>expectedFrame(f,p)&&f.presentationStatus==='evaluated_host_display_reconstruction'&&
  f.display?.fixedFrame===p.state.fixedFrame&&f.snapshot?.frame===p.state.fixedFrame&&
  f.display?.timeScale===p.state.speedIndex;
const genuineFloat32=(x)=>x instanceof Float32Array&&x.buffer instanceof ArrayBuffer&&x.length===PROFILE.width*PROFILE.height*4;

/** Pure lifecycle barrier. Its trusted host providers are registration-time infrastructure, not popup data.
 * It deliberately DOES NOT promote an admitted test/reconstructed surface to a native camera token. */
export function createReconstructionBlurGuard({sourceAuthority=null,destinationAuthority=null,hostVerifiedPins=[]}={}){
  verify(Array.isArray(hostVerifiedPins)&&hostVerifiedPins.length<=8&&hostVerifiedPins.every(p=>
    p&&Object.keys(p).length===2&&[p.source,p.destination].every(v=>typeof v==='string'&&SHA.test(v))),'blur-unqualified-registry');
  const pins=new Map(hostVerifiedPins.map(p=>[p.source,p.destination]));
  verify(pins.size===hostVerifiedPins.length,'blur-unqualified-registry');
  let commit=null,popup=null,last=null,reason=null,closed=false,epoch=0;
  const frameSet=new WeakSet();
  function inspect(){return status(closed?'closed':popup?(reason?'held':'eligible'):'idle',reason,popup?.key??null);}
  function invalidate(why){
    epoch++;commit=null;popup=null;reason=why;
  }
  function observe(result){
    verify(!closed,'blur-bridge-closed');
    const {packet:p,frame:f}=result??{};
    if(!complete(p)||last&&(p.runId!==last.runId||p.requestId<last.requestId||
      p.state.fixedFrame<last.state.fixedFrame||p.state.elapsedMs<last.state.elapsedMs)){
      invalidate('worker-order-or-run-mismatch');closed=true;return inspect();
    }
    if(last&&p.requestId===last.requestId&&p!==last){invalidate('replayed-worker-envelope');closed=true;return inspect();}
    last=p;
    if(!p.state.choice||p.state.terminal){
      if(popup){epoch++;popup=null;reason=null;commit=null;}
      if(p.state.terminal||p.state.paused){commit=null;return inspect();}
      if(!lower(f,p)){commit=null;reason='no-new-committed-world-frame';return inspect();}
      commit=Object.freeze({packet:p,frame:f});
      reason=null;return inspect();
    }
    const ch=p.state.choice;
    if(!int(ch.windowId,1)||!int(ch.generation,1)||!int(ch.remainingMs,0,30000)||p.state.paused!==true){
      invalidate('invalid-source-popup');closed=true;return inspect();
    }
    const key=identity(p);
    if(popup?.key===key){
      if(p.state.fixedFrame!==popup.fixedFrame||ch.remainingMs>popup.remainingMs||!expectedFrame(f,p)||
        f.display!==popup.frame?.display||f.snapshot!==popup.frame?.snapshot||f.commands!==popup.frame?.commands||
        f.pausedAtFixedFrame!==p.state.fixedFrame||f.frozenFromRequestId!==popup.frame?.requestId||f.presentationStatus!=='held_last_display_during_source_pause'){
        if(reason!=='frozen-frame-or-viewport-changed')epoch++;
        reason='frozen-frame-or-viewport-changed';
      }
      popup={...popup,remainingMs:ch.remainingMs};
      return inspect();
    }
    const predecessor=popup?null:commit;
    epoch++;commit=null;
    popup={key,fixedFrame:p.state.fixedFrame,remainingMs:ch.remainingMs,
      world:predecessor,frame:predecessor?.frame??null,startPacket:p};
    if(!predecessor||p.requestId<=predecessor.packet.requestId||p.state.fixedFrame<predecessor.packet.state.fixedFrame||
      p.state.fixedFrame-predecessor.packet.state.fixedFrame>8||!expectedFrame(f,p)||
      f.presentationStatus!=='held_last_display_during_source_pause'||f.pausedAtFixedFrame!==p.state.fixedFrame||
      f.frozenFromRequestId!==predecessor.packet.requestId||f.display!==predecessor.frame.display||
      f.snapshot!==predecessor.frame.snapshot||f.commands!==predecessor.frame.commands){
      reason='source-popup-without-paired-pre-popup-world';return inspect();
    }
    if(!pins.size||typeof sourceAuthority?.acquire!=='function'||typeof sourceAuthority?.qualify!=='function'||
       typeof destinationAuthority?.qualify!=='function'||typeof destinationAuthority?.present!=='function'){
      reason='old-hud-or-browser-context-unqualified';return inspect();
    }
    reason=null;return inspect();
  }
  async function acquire(signal){
    if(closed||!popup||reason)return null;
    const e=epoch,q=popup;
    const binding=Object.freeze({popupKey:q.key,openingPacket:q.startPacket,previousPacket:q.world.packet,previousFrame:q.frame});
    try{
      const f=await sourceAuthority.acquire(binding,signal);
      if(closed||signal?.aborted||epoch!==e)return null;
      verify(f&&typeof f==='object'&&!frameSet.has(f)&&f.binding===binding&&same(f.captureProfile,PROFILE)&&
        f.nativeUnityFrame===false&&f.worldHudPassesCommitted===true&&f.currentPopupPresent===false&&
        f.hudPacket===q.world.packet&&f.hudDisplay===q.frame.display&&f.worldFrame===q.frame&&typeof f.gl?.isContextLost==='function'&&!f.gl.isContextLost()&&
        genuineFloat32(f.rgba)&&pins.has(f.sourceEvidenceSha256)&&
        sourceAuthority.qualify(f,binding)===true,'same-frame-world-hud-or-context-unqualified');
      const destinationEvidence=pins.get(f.sourceEvidenceSha256);
      verify(destinationAuthority.qualify(f.gl,DESTINATION,destinationEvidence,binding)===true,
        'same-context-local-presenter-unqualified');
      const copy=new Float32Array(f.rgba);
      verify(copy.every((v,i)=>(i%4===3?v===1:Number.isFinite(v)&&v>=0&&v<=65024)),
        'linear-opaque-capture-unqualified');
      frameSet.add(f);
      return Object.freeze({epoch:e,context:f.gl,binding,destinationEvidence,rgba:copy});
    }catch(err){
      if(!closed&&!signal?.aborted&&epoch===e)reason=err?.code??'source-capture-unqualified';
      return null;
    }
  }
  function live(a){return !closed&&!reason&&!!popup&&a?.epoch===epoch&&a.binding.popupKey===popup.key;}
  function present(a,gl,texture,metrics){
    verify(live(a)&&gl===a.context&&!gl.isContextLost()&&metrics?.format==='rgb111110float'&&
      metrics.orientation===PROFILE.orientation&&metrics.sourceWidth===PROFILE.width&&metrics.sourceHeight===PROFILE.height&&
      metrics.width===(PROFILE.width>>2)&&metrics.height===(PROFILE.height>>2)&&
      destinationAuthority.qualify(gl,DESTINATION,a.destinationEvidence,a.binding)===true,'packed-destination-unqualified');
    return destinationAuthority.present({gl,texture,metrics,profile:DESTINATION,binding:a.binding,nativeUnityFrame:false})===true;
  }
  return Object.freeze({observe,inspect,acquire,live,present,
    dispose(){if(!closed){invalidate(null);closed=true;}}});
}
/** Operable only once a real host registers a qualified lower-composite producer and presenter.
 * Always uses the original packed shader implementation; no fallback or angle-adjusted shader. */
export function createReconstructedPopupBlur({programBytes,...qualification}={}){
  const g=createReconstructionBlurGuard(qualification);
  let session=null,pending=null,statusReason=null,closed=false;
  const state=()=>{const s=g.inspect();return status(s.state==='closed'?'closed':session?'ready':pending?'pending':
    statusReason?'held':s.state,statusReason??s.reason,s.popupKey);};
  function clear(){
    pending?.abort.abort();pending=null;
    const x=session;session=null;x?.output.dispose();x?.gpu.dispose();statusReason=null;
  }
  function observe(result){
    const previous=g.inspect().popupKey,next=g.observe(result);
    if(next.popupKey!==previous||next.state==='held'||next.state==='closed')clear();
    return state();
  }
  async function capture(){
    const s=g.inspect();
    if(closed||s.state!=='eligible'||session||statusReason)return state();
    if(pending){await pending.task;return state();}
    const p={abort:new AbortController(),task:null};pending=p;
    p.task=Promise.resolve().then(async()=>{
      let gpu=null,output=null;
      try{
        const a=await g.acquire(p.abort.signal);
        if(!a||p.abort.signal.aborted||!g.live(a))return;
        gpu=await createPackedBlur(a.context,programBytes);
        if(p.abort.signal.aborted||!g.live(a))return;
        output=gpu.capture(a.rgba,PROFILE.width,PROFILE.height);
        if(!g.live(a))return;
        session={a,output,gpu};
        output=gpu=null;
      }catch(e){if(!p.abort.signal.aborted)statusReason=e?.code??'packed-float-or-presenter-unavailable';}
      finally{output?.dispose();gpu?.dispose();if(pending===p)pending=null;}
    });
    await p.task;return state();
  }
  function present(){
    const x=session;
    if(!x||!g.live(x.a))return false;
    try{
      verify(x.output.present((...args)=>g.present(x.a,...args))===true,'packed-presentation-declined');
      return true;
    }catch{clear();statusReason='packed-presentation-declined';return false;}
  }
  return Object.freeze({observe,capture,present,state,programSha256:ORIGINAL_BLUR_PROGRAMS.bytesSHA256,
    dispose(){if(!closed){closed=true;clear();g.dispose();}}});
}

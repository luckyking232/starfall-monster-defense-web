import {P as __p} from "../../../../portable.mjs";
const {URL,fetch,location,Worker}=__p;
/** Non-authoritative Stage1 display observer. No gameplay operation targets the rule Worker. */
import {PROFILE_PROTOCOL,PROFILES,PROFILE_VERSION} from '../profiles.mjs';
import {openPresentationClock,RECONSTRUCTION} from '../../../presentation-capability/scene-profiles/presentation-clock.mjs';
export const EXPLICIT_LANE='explicit-canonical-scene-reconstruction/1';
import {SCENES} from '../../../presentation-capability/scene-profiles/scene-profiles.mjs';
export const COMPANION='/qualified-game/revisions/r6/stage1-2011-companion-probe/companion.js';
import {createAudit} from './slow-audit.mjs';
import {createFrostLedger} from '../stage78-frost-source-witness/frost-ledger.mjs';
const LIMIT=10_000_000_000;
const VIEW=Object.freeze({width:1334,height:750});
const err=(code,message=code)=>Object.assign(Error(message),{code});
const ask=(condition,code,message)=>{if(!condition)throw err(code,message);};
const int=(n,a,b)=>Number.isSafeInteger(n)&&n>=a&&n<=b;
const same=(p,q)=>p?.stageId===q.stageId&&p.profileId===q.profileId&&p.profilePin===q.profilePin;

function stable(x){
  if(x===null||typeof x!=='object')return x;
  if(Array.isArray(x))return x.map(stable);
  return Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])]));
}
function equalWorld(a,b){
  const encode=q=>JSON.stringify(stable({...q,units:[...q.units].sort((x,y)=>x.uid-y.uid)}));
  ask(b&&encode(a)===encode(b),'preview-full-source-divergence','Canonical rules and display companion snapshots diverged; no frame committed');
}
function transport(Class,origin){
  const w=new Class(new URL(COMPANION,origin),{name:'canonical-stage1-display-observer'});
  let pending=null,closed=false,seq=0;
  function close(error=err('preview-source-worker')){
    if(closed)return;
    closed=true;w.terminate();
    if(pending){const p=pending;pending=null;clearTimeout(p.timer);p.reject(error);}
  }
  w.addEventListener('error',e=>close(err('preview-source-worker',e?.message)));
  w.addEventListener('message',({data:d})=>{
    if(!pending||d?.seq!==pending.seq){close(err('preview-source-worker','Stale source companion reply'));return;}
    const p=pending;pending=null;clearTimeout(p.timer);
    if(d.ok!==true||!d.state||!Array.isArray(d.callbacks)||d.callbacks.length>8){
      p.reject(err('preview-source-worker',d?.error??'Malformed observer reply'));close();return;
    }
    p.resolve(d);
  });
  return {close,run(kind,wallUs,more={}){
    ask(!closed&&!pending,'preview-source-worker');
    return new Promise((resolve,reject)=>{
      pending={seq:++seq,resolve,reject,timer:setTimeout(()=>close(err('preview-source-worker','Timed out')),12000)};
      try{w.postMessage({seq,kind,wallUs,...more});}catch(e){close(err('preview-source-worker',String(e)));}
    });
  }};
}
export async function openCanonicalObserver({lane,stageId,expectedOrigin,WorkerClass=__p.Worker,nativeIndexBytes,renderer,onCommit,onSlowEvidence=()=>{},onFrostEvidence=()=>{}}={}){
  const o=new URL(expectedOrigin??'https://invalid.invalid');
  const STAGE=stageId,profile=PROFILES[STAGE],scene=SCENES[STAGE];
  ask(lane===EXPLICIT_LANE&&Number.isSafeInteger(stageId)&&scene?.ruleProfilePin===profile?.profilePin&&Boolean(scene)&&o.origin===expectedOrigin&&__p.sameOrigin(o)&&typeof WorkerClass==='function','preview-scope-held');
  if(typeof __p.location==='object')
    ask(location.origin===o.origin&&location.pathname==='/qualified-game/','preview-scope-held');
  const lifecycle=createAudit(stageId),frostLedger=createFrostLedger(stageId);
  let frostEvidence=null, frostEvents=[];
  const clock=await openPresentationClock({nativeIndexBytes,protocol:PROFILE_PROTOCOL,lane:RECONSTRUCTION,stageId});
  let source=null,packet=null,time=0,lastFrame=null,closed=false,serial=Promise.resolve();
  function close(){if(!closed){closed=true;source?.close();clock.close();}}
  function safe(fn){
    const p=serial.then(()=>{ask(!closed,'preview-closed');return fn();});
    serial=p.catch(close);return p;
  }
  function validate(r,initial){
    ask(r?.protocol===PROFILE_PROTOCOL&&same(r,profile)&&same(r.gates?.stageScope,profile)&&
      r.gates?.audiovisualParity==='held'&&r.gates?.deployment==='not_deployed'&&r.state?.stageId===STAGE&&
      r.type===(initial?'ready':'state'),'preview-authority-scope');
    if(initial)ask(r.version===PROFILE_VERSION&&r.gameId===70441022&&r.fps===30,'preview-authority-build');
    else ask(r.runId===packet.runId&&r.requestId>packet.requestId,'preview-authority-stale');
  }
  function now(us){ask(int(us,time,LIMIT),'preview-wall-clock');time=us;}
  function observeEffect(c,r){
    const b=lifecycle.accept(c,r.state);
    if(b.events.length||b.active)onSlowEvidence({runId:r.runId,requestId:r.requestId,...b,
      phase:c.slow.phase,sourceFixed:c.fixedFrame,sourceDisplay:c.displayFrame,
      sourceRows:c.slow.rows,sourceThreshold:c.slow.threshold,
      rendered:false,effectStatus:'exact_2011_original_requests_not_drawn'});
    frostEvidence=frostLedger.accept(c,r.state);frostEvents.push(...frostEvidence.events);
    const {slow,frost,...normal}=c;
    return normal;
  }
  function accept(r,s){
    equalWorld(r.state,s.state);clock.acceptWorker(r);packet=r;
    if(!r.state.terminal)for(const c of s.callbacks)clock.callback(observeEffect(c,r));
    else {
      ask(Array.isArray(s.terminalSlow)&&s.terminalSlow.length<=8,'source-nondrawable-invalid');
      for(const c of [...s.callbacks,...s.terminalSlow])observeEffect(c,r);
    }
  }
  async function draw(frozen,hudOps=null){
    lastFrame=clock.renderTo(renderer,VIEW,{frozen,allowPartial:false});
    if(typeof onCommit==="function")await onCommit({packet,frame:lastFrame,hudOps});
    return lastFrame;
  }
  async function display(){
    const s=await source.run('display',time);
    equalWorld(packet.state,s.state);
    ask(s.callbacks.length===1&&s.callbacks[0].phase==='display','preview-display-callback');
    clock.callback(observeEffect(s.callbacks[0],packet));return draw(false,s.hudOps);
  }
  const result=frame=>{
    onFrostEvidence(Object.freeze({stageId:STAGE,runId:packet.runId,requestId:packet.requestId,fixed:packet.state.fixedFrame,frame,
      evidence:frostEvidence,events:Object.freeze(frostEvents.splice(0))}));
    return {frame,authoritativeRequest:packet.requestId,held:packet.state.terminal?'terminal_not_battle_frame':null};
  };
  return Object.freeze({
    begin(raw,rng){return safe(async()=>{
      ask(!source,'preview-duplicate');
      const r=structuredClone(raw);validate(r,true);
      source=transport(WorkerClass,o.origin);
      const s=await source.run('init',0,{rng:structuredClone(rng),stageId});
      accept(r,s);return result(await draw(false,s.hudOps));
    });},
    observe(action,reply,wallUs){return safe(async()=>{
      ask(packet&&!packet.state.terminal,'preview-not-live');
      const r=structuredClone(reply);
      validate(r,false);now(wallUs);
      const k=action?.type;
      let s;
      if(k==='step-fixed'){
        ask(int(action.count,1,600)&&int(r.advancedFixed,0,action.count),'preview-fixed-count');
        // An original selection can cut a fixed quota short; mirror only actual committed ticks.
        if(!r.advancedFixed)s=await source.run('clock',time,{ms:0});
        else{
          let tail;const callbacks=[];
          for(let rest=r.advancedFixed;rest>0;rest-=Math.min(rest,8)){
            tail=await source.run('fixed',time,{count:Math.min(rest,8)});
            callbacks.push(...tail.callbacks);
          }
          s={state:tail.state,callbacks,terminalSlow:tail.terminalSlow??[]};
        }
      }else{
        ask(r.advancedFixed===0,'preview-fixed-count');
        if(k==='advance-unscaled')s=await source.run('clock',time,{ms:action.ms});
        else if(k==='select')s=await source.run('select',time,{selection:structuredClone(action.selection)});
        else if(k==='speed')s=await source.run('speed',time,{index:action.index});
        else if(k==='pause'||k==='resume')s=await source.run(k,time);
        else ask(false,'preview-action-held');
      }
      accept(r,s);
      if(r.state.terminal){await onCommit?.({packet,frame:null,hudOps:null});return result(null);}
      return result(r.state.paused?await draw(true):await display());
    });},
    display(wallUs){return safe(async()=>{
      ask(packet&&!packet.state.terminal,'preview-not-live');now(wallUs);
      if(packet.state.paused){
        const s=await source.run('clock',time,{ms:0});
        equalWorld(packet.state,s.state);
        for(const c of s.callbacks)clock.callback(observeEffect(c,packet));
        return result(await draw(true));
      }
      return result(await display());
    });},
    get lastFrame(){return lastFrame;},
    close
  });
}

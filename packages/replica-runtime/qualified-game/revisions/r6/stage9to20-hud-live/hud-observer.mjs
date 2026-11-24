/** Non-authoritative Stage1 display observer. No gameplay operation targets the rule Worker. */
import {PROFILE_PROTOCOL,PROFILES,PROFILE_VERSION} from '../profiles.mjs';
import {openPresentationClock,RECONSTRUCTION} from './presentation-clock.mjs';
export const EXPLICIT_LANE='explicit-canonical-scene-reconstruction/1';
import {SCENES} from './scene-profiles.mjs';
export const COMPANION='/qualified-game/revisions/r6/stage9to20-hud-live/hud-source-companion.js';
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
export async function openCanonicalObserver({lane,stageId,expectedOrigin,WorkerClass=globalThis.Worker,nativeIndexBytes,renderer,hudAuthority}={}){
  const o=new URL(expectedOrigin??'https://invalid.invalid');
  const STAGE=stageId,profile=PROFILES[STAGE],scene=SCENES[STAGE];
  ask(lane===EXPLICIT_LANE&&[78000009, 78000010, 78000011, 78000012, 78000013, 78000014, 78000015, 78000016, 78000017, 78000018, 78000019, 78000020].includes(stageId)&&hudAuthority&&scene?.ruleProfilePin===profile?.profilePin&&Boolean(scene)&&o.origin===expectedOrigin&&o.protocol==='http:'&&
    o.hostname==='127.0.0.1'&&o.port!==''&&typeof WorkerClass==='function','preview-scope-held');
  if(typeof globalThis.location==='object')
    ask(location.origin===o.origin&&location.pathname==='/qualified-game/','preview-scope-held');
  const clock=await openPresentationClock({nativeIndexBytes,protocol:PROFILE_PROTOCOL,lane:RECONSTRUCTION,stageId});
  let source=null,packet=null,time=0,lastFrame=null,closed=false,serial=Promise.resolve(),firstAppear=null;
  function apply(c,r){
    const {nonDrawableFirstAppear,...row}=c;
    clock.callback(row);
    if(nonDrawableFirstAppear){
      const [card,uid,x,y]=nonDrawableFirstAppear;
      ask(!firstAppear&&c.fixedFrame===1&&c.phase==='fixed'&&nonDrawableFirstAppear.length===4&&
        [card,uid].every(Number.isSafeInteger)&&[x,y].every(Number.isFinite),'preview-invalid-first-appear');
      const v=r.state.units.find(a=>a.cardId===card&&a.uid===uid);
      ask(v&&v.camp===2&&(r.state.fixedFrame>1||(v.x===x&&v.y===y)),'preview-invalid-first-appear-world');
      firstAppear=Object.freeze({fixed:1,cardId:card,uid,x,y,drawable:false});
    }
  }
  function close(){if(!closed){closed=true;source?.close();clock.close();hudAuthority.close();}}
  function safe(fn){
    const p=serial.then(()=>{ask(!closed,'preview-closed');return fn();});
    serial=p.catch(close);return p;
  }
  function validate(r,initial){
    ask(r?.protocol===PROFILE_PROTOCOL&&same(r,profile)&&same(r.gates?.stageScope,profile)&&
      r.gates?.audiovisualParity==='held'&&r.gates?.deployment==='not_deployed'&&r.state?.stageId===STAGE&&
      r.type===(initial?'ready':'state'),'preview-authority-scope');
    if(scene.bodyOnlyDiagnostic){
      const opaque=r.gates.nonRenderableDisplayBoundary;
      ask(opaque&&Object.keys(opaque).length===Object.keys(scene.opaqueOriginalBoundary).length&&
        Object.entries(scene.opaqueOriginalBoundary).every(([k,v])=>opaque[k]===v)&&opaque.drawable===false,'preview-opaque-boundary-drift');
    }else ask(!r.gates.nonRenderableDisplayBoundary,'preview-opaque-boundary-drift');
    if(initial)ask(r.version===PROFILE_VERSION&&r.gameId===70441022&&r.fps===30,'preview-authority-build');
    else ask(r.runId===packet.runId&&r.requestId>packet.requestId,'preview-authority-stale');
  }
  function now(us){ask(int(us,time,LIMIT),'preview-wall-clock');time=us;}
  function accept(r,s){
    equalWorld(r.state,s.state);
    ask(!r.state.units.some(u=>u.cardId===78000206&&['DYING','DEAD'].includes(u.stateName)),
      'preview-20108-empty-die','Original 20108 die clip has no drawable keys');
    clock.acceptWorker(r);packet=r;
    if(!r.state.terminal)for(const c of s.callbacks)apply(c,r);
  }
  function draw(frozen,hudOps=null){
    lastFrame=clock.renderTo(renderer,VIEW,{frozen,allowPartial:false});
    hudAuthority.commit(packet,lastFrame,hudOps);
    return lastFrame;
  }
  async function display(){
    const s=await source.run('display',time);
    equalWorld(packet.state,s.state);
    ask(s.callbacks.length===1&&s.callbacks[0].phase==='display','preview-display-callback');
    clock.callback(s.callbacks[0]);return draw(false,s.hudOps);
  }
  const result=frame=>({frame,hud:frame?hudAuthority.peek():null,firstAppear,authoritativeRequest:packet.requestId,held:packet.state.terminal?'terminal_not_battle_frame':null});
  return Object.freeze({
    begin(raw,rng){return safe(async()=>{
      ask(!source,'preview-duplicate');
      const r=structuredClone(raw);validate(r,true);
      source=transport(WorkerClass,o.origin);
      accept(r,await source.run('init',0,{rng:structuredClone(rng),stageId}));return result(draw(false));
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
          s={state:tail.state,callbacks};
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
      if(r.state.terminal){hudAuthority.close();return result(null);}
      return result(r.state.paused?draw(true):await display());
    });},
    display(wallUs){return safe(async()=>{
      ask(packet&&!packet.state.terminal,'preview-not-live');now(wallUs);
      if(packet.state.paused){
        const s=await source.run('clock',time,{ms:0});
        equalWorld(packet.state,s.state);
        for(const c of s.callbacks)clock.callback(c);
        return result(draw(true));
      }
      return result(await display());
    });},
    get lastFrame(){return lastFrame;},
    close
  });
}

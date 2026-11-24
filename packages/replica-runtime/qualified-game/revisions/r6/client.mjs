/** Strict private per-stage rules client. No shell, backend or rendering fallback. */
import {PROFILES,PROFILE_PROTOCOL,PROFILE_MODE,PROFILE_VERSION} from './profiles.mjs';
const int=(n,l,h)=>Number.isInteger(n)&&n>=l&&n<=h;
const error=(code,message)=>Object.assign(new Error(message),{code});
const pinnedStage=id=>Number.isSafeInteger(id)&&Object.hasOwn(PROFILES,id)?PROFILES[id]:undefined;
const same=(a,b)=>a?.stageId===b.stageId&&a.profileId===b.profileId&&a.profilePin===b.profilePin;
export {PROFILES,PROFILE_PROTOCOL,PROFILE_MODE,PROFILE_VERSION} from './profiles.mjs';

export function makeMultistageRulesClient({WorkerClass=globalThis.Worker}={}){
  if(typeof WorkerClass!=='function')throw error('worker-unavailable','Dedicated Worker missing');
  const worker=new WorkerClass(new URL('./worker.js',import.meta.url));
  const outstanding=new Map();
  let seq=0,runId=null,activeProfile=null,lastState=null,closed=false;
  function rejectAll(e){
    for(const q of outstanding.values())q.reject(e);
    outstanding.clear();
  }
  function fatal(code,message){
    const e=error(code,message);
    lastState=null;closed=true;
    rejectAll(e);worker.terminate();
    return e;
  }
  worker.addEventListener('message',({data})=>{
    const q=outstanding.get(data?.requestId);
    if(!q)return;
    if(q.runId!==data.runId)return; // stale/unrelated reply cannot affect current run
    outstanding.delete(data.requestId);
    if(q.runId&&q.runId!==runId){q.reject(error('stale-session','Ignored superseded local profile'));return;}
    if(data.protocol!==PROFILE_PROTOCOL){q.reject(fatal('bad-response-contract','Worker reply used wrong protocol'));return;}
    if(data.type==='error'){
      if(['runtime-failed-closed','session-not-ready','stage-init-failed'].includes(data.code))lastState=null;
      q.reject(error(data.code,data.message));return;
    }
    if(q.type==='describe'){
      const ps=data.profiles??[];
      if(data.type!=='contract'||data.mode!==PROFILE_MODE||data.version!==PROFILE_VERSION||
        data.gameId!==70441022||data.fps!==30||!Array.isArray(ps)||ps.length!==Object.keys(PROFILES).length||
        !Object.values(PROFILES).every(p=>ps.filter(a=>same(a,p)).length===1)){
        q.reject(fatal('bad-response-profile','Describe reply does not match exact profile pins'));return;
      }
    }else{
      const expected=q.type==='init'?'ready':q.type==='close'?'closed':'state';
      if(!same(data,q.profile)||data.type!==expected||
        (data.type!=='closed'&&(data.state?.stageId!==q.profile.stageId||!same(data.gates?.stageScope,q.profile)))||
        (data.type==='ready'&&(data.version!==PROFILE_VERSION||data.gameId!==70441022||data.fps!==30))){
        q.reject(fatal('bad-response-profile','Worker reply switched pinned stage or scope'));return;
      }
      if(data.state&&q.profile.stageId===78000021){
        const z=data.gates?.endlessQualification,t=data.state.terminal,f=data.state.fixedFrame;
        const wanted=t?'native_neutral_terminal':f===12000?'live_horizon_held':'active_source_rules';
        if(z?.optIn!=="original-bounded-neutral-v1"||z.fixedFrameCap!==12000||z.actualCycleVerified!==false||z.officialService!==false||z.finitePoints!==0||
           !int(f,0,12000)||z.disposition!==wanted||
           (t&&(t.win!==false||t.loss!==false||z.disposition!=='native_neutral_terminal'))){
          q.reject(fatal('bad-endless-neutral-scope','Worker changed the exact Endless authority'));return;
        }
      }
      if(data.state)lastState=data.state;
      if(data.type==='closed'){lastState=null;activeProfile=null;runId=null;}
    }
    q.resolve(data);
  });
  worker.addEventListener('error',e=>fatal('worker-unavailable',e?.message||'Worker exited'));
  function request(type,fields={},stage=activeProfile,target=runId){
    if(closed)return Promise.reject(error('closed-client','Closed private rules client'));
    if(type!=='describe'&&(!stage||!target))return Promise.reject(error('session-not-open','Open explicit local stage first'));
    if(outstanding.size>=64||seq>=2147483647)return Promise.reject(error('client-backpressure','Await current request batch'));
    const requestId=++seq;
    return new Promise((resolve,reject)=>{
      outstanding.set(requestId,{resolve,reject,runId:target??undefined,type,profile:stage});
      try{worker.postMessage({protocol:PROFILE_PROTOCOL,type,requestId,runId:target??undefined,...stage,...fields});}
      catch(e){outstanding.delete(requestId);reject(e);}
    });
  }
  function start({stageId,tape,globalRngSeeds,endlessMode}={}){
    if(closed)return Promise.reject(error('closed-client','Closed private rules client'));
    const selected=pinnedStage(stageId);
    if(!selected)return Promise.reject(error('scope-held','No qualified named profile for this stage'));
    if(stageId===78000021?endlessMode!=="original-bounded-neutral-v1":endlessMode!==undefined)
      return Promise.reject(error('endless-scope-opt-in','Explicit bounded neutral Endless scope required'));
    if(!Array.isArray(tape)||tape.length!==50||tape.some(v=>!int(v,1,10000)))
      return Promise.reject(error('bad-rng-tape','Require 50 original RNG test draws'));
    if(!Array.isArray(globalRngSeeds)||globalRngSeeds.length!==2||globalRngSeeds.some(v=>!int(v,0,2147483647)))
      return Promise.reject(error('bad-global-rng','Require two additional Lua 5.4 test seeds'));
    for(const [id,q] of outstanding)if(q.runId){
      q.reject(error('stale-session','Replaced explicit local profile'));outstanding.delete(id);
    }
    activeProfile=selected;lastState=null;runId='local-'+crypto.randomUUID();
    return request('init',{mode:PROFILE_MODE,tape:[...tape],globalRngSeeds:[...globalRngSeeds],...(endlessMode?{endlessMode}:{})});
  }
  return Object.freeze({
    start,describe:()=>request('describe',{},null,null),snapshot:()=>request('snapshot'),
    stepFixed:count=>request('step-fixed',{count}),advanceUnscaled:ms=>request('advance-unscaled',{ms}),
    speed:index=>request('speed',{index}),pause:()=>request('pause'),resume:()=>request('resume'),
    select:({windowId,generation,skillId,confirm})=>request('select',{windowId,generation,skillId,confirm}),
    closeStage:()=>request('close'),
    get lastState(){return lastState;},
    dispose(){if(!closed)fatal('closed-client','Closed private rules client');},
  });
}

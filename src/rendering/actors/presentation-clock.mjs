import {fromObservedStage1LuaCall} from '../../../base-native-audit/animator-requests.mjs';
import {STAGE1_SHA256,compileStage,frameCommands} from '../../../stage-renderer/native-stage.mjs';
import {nativeSpriteAt} from '../../../native-assets/sprite-key.mjs';

export const PREVIEW_SCHEMA='starfall-stage1-authored-sprite-preview/1';
export const RECONSTRUCTION='explicit-host-display-reconstruction/1';
const uncertainty=Object.freeze({
  requestStart:'preview_different_state_starts_at_authored_key_zero_not_proven_Unity_start',
  sameState:'preview_retains_time_not_proven_Unity_same_state_behavior',
  missingState:'preview_ignores_missing_requested_state_not_proven_Unity_missing_state_behavior',
  phase:'preview_display_samples_after_callbacks_not_proven_Unity_evaluation_phase',
  pooling:'new_UID_reads_authored_defaults_not_proven_Unity_pooled_reset',
  earlyDeath:'until_source_removal_not_proven_Unity_visibility',
});
const fail=(code,details={})=>{throw Object.assign(new Error(code),{code,...details});};
const integer=(n,max=10_000_000_000)=>Number.isSafeInteger(n)&&n>=0&&n<=max;
const worldFields=['uid','cardId','x','y','z','camp','stateName','flipped'];
function captureWorld(units,candidate){
  const world=new Set();
  return units.map(u=>{
    if(!keys(u,worldFields)||!integer(u.uid,2147483647)||!integer(u.cardId,78999999)||world.has(u.uid)||
       candidate.get(u.uid)?.cardId!==u.cardId||![u.x,u.y,u.z].every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=100000)||
       (u.camp!==1&&u.camp!==2)||typeof u.flipped!=='boolean'||typeof u.stateName!=='string')fail('preview-source-world');
    world.add(u.uid);return {...u};
  }).sort((a,b)=>a.uid-b.uid);
}
const intString=(s,max)=>typeof s==='string'&&/^(0|[1-9][0-9]*)$/u.test(s)&&integer(+s,max);
const keys=(x,names)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===names.length&&names.every(n=>Object.hasOwn(x,n));
function freeze(o){if(o&&typeof o==='object'&&!Object.isFrozen(o)){Object.values(o).forEach(freeze);Object.freeze(o);}return o;}
function phaseCheck(next,prior) {
  if(!keys(next,['phase','fixedFrame','displayFrame','wallUs','rows','worldUnits'])||
    !integer(next.fixedFrame,12000)||!integer(next.displayFrame,1200000)||!integer(next.wallUs)||
    !Array.isArray(next.rows)||next.rows.length>10000||
    ((next.phase==='boot'||next.phase==='display')? !Array.isArray(next.worldUnits)||next.worldUnits.length>5000 : next.worldUnits!==null))fail('preview-callback');
  if(!prior){
    if(next.phase!=='boot'||next.wallUs!==0||next.fixedFrame!==0||next.displayFrame!==0)fail('preview-boot');
  }else{
    if(next.wallUs<prior.wallUs)fail('preview-clock');
    const f=next.fixedFrame-prior.fixedFrame,d=next.displayFrame-prior.displayFrame;
    if(!((next.phase==='fixed'&&f===1&&d===0)||(next.phase==='display'&&f===0&&d===1)||
      (next.phase==='wallclock'&&f===0&&d===0)))fail('preview-clock');
  }
}
function role(stage,cardId){
  const a=stage.units.get(cardId)?.prefab;
  const ctrl=a?.animator&&a.source.controllers.find(c=>c.pathId===a.animator.controllerPathId);
  if(a?.animator&&!ctrl)fail('preview-controller');
  return {a,ctrl};
}
/** callback wallUs is an explicit host schedule, never fixedFrame/30 or Stage18 media PTS.
 * A fixed callback may enqueue requests but cannot advance the preview sample.
 * Opt-in preview does not feed the strict bridge's native witness registry. */
export async function openPresentationClock(SCENES,openActorBridge,{nativeIndexBytes,protocol,lane,stageId}={}){
  if(lane!==RECONSTRUCTION)fail('preview-opt-in-required');
  const b=nativeIndexBytes instanceof Uint8Array?new Uint8Array(nativeIndexBytes):nativeIndexBytes instanceof ArrayBuffer?new Uint8Array(nativeIndexBytes.slice(0)):null;
  const bridge=await openActorBridge({nativeIndexBytes:b,protocol,stageId});
  const stage=compileStage(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b)));
  const indexIdentity=JSON.stringify(stage.input);
  let last=null,rate=1,scaledUs=0,actors=new Map(),removed=new Set(),lastDisplay=null,packet=null,closed=false,lastFrame=null;
  function callback(c){
    if(closed)fail('preview-closed');
    phaseCheck(c,last);
    let nextScaled=scaledUs+(c.wallUs-(last?.wallUs??0))*rate,nextRate=rate;
    let next=new Map(actors),del=new Set(removed);
    const get=(uid,card)=>{
      let a=next.get(uid);
      if(del.has(uid)||a&&a.cardId!==card)fail('preview-row-identity');
      if(!a){
        if(next.size+del.size>=5000)fail('preview-actor-budget');
        const {ctrl}=role(stage,card);
        a={uid,cardId:card,created:false,stateName:ctrl?.defaultState??null,clipUs:0,lastUs:nextScaled,speed:1,latestRequest:null,
          outcome:'authored_prefab_default'};
      }else a={...a};
      next.set(uid,a);
      return a;
    };
    const age=(a)=>{
      a.clipUs+=(nextScaled-a.lastUs)*a.speed;
      a.lastUs=nextScaled;
    };
    for(const row of c.rows){
      if(!Array.isArray(row)||!row.every(s=>typeof s==='string')||row[1]!==c.phase||
         row[2]!==String(c.fixedFrame)||row[3]!==String(c.displayFrame))fail('preview-row-clock');
      if(row[0]==='global-timescale-request'){
        if(row.length!==5||!['0','1','2'].includes(row[4]))fail('preview-rate');
        nextRate=+row[4];continue;
      }
      if(!intString(row[4],2147483647)||+row[4]===0||!/^780\d{5}$/u.test(row[5]))fail('preview-row-identity');
      const uid=+row[4],card=+row[5],a=get(uid,card);
      switch(row[0]){
      case 'actor-created':
        if(row.length!==8||a.created||row[6]!=='START'||!intString(row[7],12000))fail('preview-lifecycle');
        a.created=true;break;
      case 'actor-model-destroy-request':
        if(row.length!==8||!a.created)fail('preview-lifecycle');
        next.delete(uid);del.add(uid);break;
      case 'animator-speed-request':
        if(row.length!==8||!a.created||!['0','1'].includes(row[6])||!['0','1'].includes(row[7])||
          +row[6]!==a.speed||row[6]===row[7])fail('preview-speed');
        age(a);a.speed=+row[7];break;
      case 'play-request': {
        const r=fromObservedStage1LuaCall(row);
        const {ctrl}=role(stage,card);
        age(a);
        a.latestRequest=r.requestedStateName;
        if(!ctrl)a.outcome='no_qualified_animator';
        else if(!ctrl.states.some(s=>s.stateName===a.latestRequest))a.outcome='preview_ignored_missing_state';
        else if(a.latestRequest===a.stateName)a.outcome='preview_same_state_kept';
        else{
          a.stateName=a.latestRequest;a.clipUs=0;a.outcome='preview_entered_at_authored_zero';
        }
        break;
      }
      default:fail('preview-row-kind');
      }
    }
    if([...next.values()].some(a=>!a.created))fail('preview-unbound-actor');
    // Publish a pose only at boot/display. Wallclock can move and fixed requests can arrive independently.
    let produced=null;
    if(c.phase==='boot'||c.phase==='display'){
      if(nextRate===0)fail('preview-paused-display');
      produced={fixedFrame:c.fixedFrame,displayFrame:c.displayFrame,wallUs:c.wallUs,
        scaledUs:nextScaled,timeScale:nextRate,worldUnits:captureWorld(c.worldUnits,next),actors:[...next.values()].sort((a,b)=>a.uid-b.uid).map(a=>{
          const p={...a};age(p);
          const {a:prefab,ctrl}=role(stage,a.cardId);
          const state=ctrl?.states.find(s=>s.stateName===a.stateName);
          const clip=state&&prefab.source.clips.find(x=>x.pathId===state.animationClipPathId);
          // Keep raw stage-renderer clock in seconds, but expose bounded preview sampling for callers.
          const t=p.clipUs/1000000;
          const sprite=state?nativeSpriteAt(prefab.source,prefab.animator.pathId,state.stateName,t):null;
          return {uid:p.uid,cardId:p.cardId,authoredStateName:p.stateName,request:p.latestRequest,
            requestOutcome:p.outcome,presentationElapsedSeconds:state?t:null,modelSpeed:p.speed,
            clip:{pathId:clip?.pathId??null,stopTime:clip?.stopTime??null,loop:state?.loop??null,authoredStateSpeed:state?.speed??null,stateHash:state?.stateHash??null},
            sprite};
        })};
    }
    last={phase:c.phase,fixedFrame:c.fixedFrame,displayFrame:c.displayFrame,wallUs:c.wallUs};
    actors=next;removed=del;rate=nextRate;scaledUs=nextScaled;
    if(produced)lastDisplay=freeze({schema:PREVIEW_SCHEMA,lane:RECONSTRUCTION,nativeRuntimePose:false,
      motionModel:uncertainty,...produced});
    return produced?lastDisplay:null;
  }
  function acceptWorker(reply){
    // Never retain a reference to externally mutable packet fields after validation.
    if(closed)fail('preview-closed');
    const owned=structuredClone(reply);
    const accepted=bridge.accept(owned);packet=owned;return accepted;
  }
  function project(viewport){
    if(closed||!lastDisplay||!packet)fail('preview-not-ready');
    const view=bridge.inspect(viewport);
    if(rate===0||lastDisplay.fixedFrame!==view.fixedFrame||last?.fixedFrame!==view.fixedFrame||view.terminal||view.paused!==(rate===0))fail('preview-world-mismatch');
    const candidate=[...packet.state.units].sort((a,b)=>a.uid-b.uid);
    if(candidate.length!==lastDisplay.worldUnits.length||packet.state.speedIndex!==rate||
      candidate.some((u,i)=>worldFields.some(k=>u[k]!==lastDisplay.worldUnits[i][k])))fail('preview-source-worker-divergence');
    const dispositions=[],snapUnits=[];
    const preview=new Map(lastDisplay.actors.map(p=>[p.uid,p]));
    for(const u of packet.state.units){
      const p=preview.get(u.uid);
      if(!p||u.cardId!==p.cardId)fail('preview-world-actor-mismatch');
      preview.delete(u.uid);
      const known=stage.units.get(u.cardId);
      if(!known){
        dispositions.push({uid:u.uid,cardId:u.cardId,status:u.cardId===78000301?'held_native_dina_particles':'held_unknown_native_asset'});
        continue;
      }
      dispositions.push({uid:u.uid,cardId:u.cardId,status:'authored_sprite_preview'});
      snapUnits.push({uid:u.uid,cardId:u.cardId,x:u.x,y:u.y,z:u.z,camp:u.camp===1?'left':'right',flipX:u.flipped,
        stateName:p.authoredStateName,animationElapsedSeconds:p.presentationElapsedSeconds});
    }
    // Runtime can retain an inert model outside its reported world cleanup. Never draw it.
    if(preview.size)fail('preview-world-actor-mismatch');
    const snapshot={frame:view.fixedFrame,units:snapUnits};
    lastFrame=freeze({schema:PREVIEW_SCHEMA,lane:RECONSTRUCTION,nativeRuntimePose:false,fullSceneNativeParity:false,
      presentationStatus:'evaluated_host_display_reconstruction',
      nativeIndexSha256:SCENES[stageId].nativeIndexSha256,stageId,protocol,runId:view.runId,requestId:view.requestId,
      viewport:view.viewport,projection:view.projection,display:lastDisplay,dispositions,
      snapshot,commands:frameCommands(stage,snapshot)});
    return lastFrame;
  }
  function projectFrozen(viewport){
    if(closed||!lastFrame||!packet||rate!==0||packet.state.paused!==true)fail('preview-freeze-held');
    const view=bridge.inspect(viewport);
    if(view.runId!==lastFrame.runId||view.viewport.width!==lastFrame.viewport.width||
      view.viewport.height!==lastFrame.viewport.height||view.terminal||last.fixedFrame!==view.fixedFrame||
      lastFrame.display!==lastDisplay||view.fixedFrame<lastFrame.display.fixedFrame)fail('preview-freeze-view');
    return freeze({...lastFrame,presentationStatus:'held_last_display_during_source_pause',
      frozenFromRequestId:lastFrame.requestId,requestId:view.requestId,pausedAtFixedFrame:view.fixedFrame,pauseWallUs:last.wallUs});
  }
  function renderTo(renderer,view,{frozen=false,allowPartial=false}={}){
    const result=frozen?projectFrozen(view):project(view);
    const held=result.dispositions.filter(a=>a.status.startsWith('held_'));
    if(held.length&&!allowPartial)fail('preview-partial-render-held',{actors:held});
    if(typeof renderer?.resize!=='function'||typeof renderer?.render!=='function'||
       JSON.stringify(renderer?.stage?.input)!==indexIdentity)fail('preview-renderer-mismatch');
    const actual=renderer.resize(view.width,view.height);
    if(['halfWidth','halfHeight','pixelsPerWorldUnit'].some(k=>!Number.isFinite(actual?.[k])||
      Math.abs(actual[k]-result.projection[k])>1e-9))fail('preview-renderer-view');
    renderer.render(result.snapshot);return result;
  }
  return Object.freeze({callback,acceptWorker,project,projectFrozen,renderTo,
    close(){closed=true;last=null;packet=null;lastDisplay=null;lastFrame=null;actors.clear();removed.clear();bridge.close();}});
}

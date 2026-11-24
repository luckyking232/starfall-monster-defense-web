/** Strict Stage1 rules-worker → native authored SpriteRenderer bridge.
 * The default lane publishes actual frame-zero world positions with serialized default sprites, not a live Unity pose. */
import {compileStage,frameCommands,initialStageSnapshot,nativeProjection,STAGE1_SHA256} from '../../../../stage-renderer/native-stage.mjs';
import {nativeSpriteAt} from '../../../../native-assets/sprite-key.mjs';
export const ACTOR_BRIDGE_SCHEMA='starfall-stage1-actor-bridge/1';
export const CALIBRATED_CAPTURE_SCHEMA='starfall-stage1-native-animator-frame-capture/1';
export const PROTOCOLS=Object.freeze(['starfall-qualified-stage-rules/1']);
import {PROFILES} from '../profiles.mjs';
import {SCENES} from './scene-profiles.mjs';
const VERSION='134377281279792758', STAGE=78000001, GAME=70441022;
const WALL=78000110, DINA_TRAP=78000301;
const SHA=/^[0-9a-f]{64}$/u, RUN=/^[\w-]{1,64}$/u;
const maxFrame=12000;
const stateSet=new Set(['START','STAND','MOVE','WAIT_ATTACK','ATTACK','ATTACK_OVER','DYING','DEAD',
  'STUN','PERSIST_CAST','BEAT_BACK','DEVOUR','FEAR','REVIVE','SPECIAL']);
const int=(n,a,b)=>Number.isSafeInteger(n)&&n>=a&&n<=b;
const finite=(n,a,b)=>typeof n==='number'&&Number.isFinite(n)&&n>=a&&n<=b;
const fail=(code,message,extra={})=>{throw Object.assign(new Error(message),{code,...extra});};
const exactKeys=(o,keys)=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
const bytes=b=>b instanceof Uint8Array?new Uint8Array(b):b instanceof ArrayBuffer?new Uint8Array(b.slice(0)):null;
const encoder=new TextEncoder();
const decode=b=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));
const sha=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),v=>v.toString(16).padStart(2,'0')).join('');
function locked(o){
  if(o&&typeof o==='object'&&!Object.isFrozen(o)){Object.values(o).forEach(locked);Object.freeze(o);}
  return o;
}
function messageFacts(reply,protocol,current,scene){
  const STAGE=scene.stageId;
  if(reply?.protocol!==protocol||typeof reply.runId!=='string'||!RUN.test(reply.runId)||!int(reply.requestId,1,2147483647)
     ||reply.gates?.sourceState!=='integrity_verified'||reply.gates?.source!=='pinned_explicit_stage_profiles_only'
     ||reply.stageId!==STAGE||reply.profileId!==PROFILES[STAGE].profileId||reply.profilePin!==PROFILES[STAGE].profilePin
     ||reply.gates?.stageScope?.stageId!==STAGE||reply.gates.stageScope.profilePin!==PROFILES[STAGE].profilePin
     ||reply.gates?.animation!=='held_unmapped_unity_Animator_time'||!Array.isArray(reply.events)){
    fail('worker-contract','Requires the exact canonical Stage1 Worker profile envelope');
  }
  const q=reply.state;
  if(!q||q.stageId!==STAGE||!int(q.fixedFrame,0,maxFrame)||!int(q.elapsedMs,0,100000000)||
      !int(reply.advancedFixed,0,600)||typeof q.paused!=='boolean'||!Array.isArray(q.units)||q.units.length>5000||
      (reply.type!=='ready'&&reply.type!=='state')){
    fail('worker-state','Missing or malformed authoritative actor snapshot');
  }
  if(q.terminal!==null && (!exactKeys(q.terminal,['win','loss','curMonsterWave','killEnemyCount'])||
    typeof q.terminal.win!=='boolean'||typeof q.terminal.loss!=='boolean'||q.terminal.win===q.terminal.loss||
    !int(q.terminal.curMonsterWave,1,scene.waveMaximum??2)||!int(q.terminal.killEnemyCount,0,scene.spawnMaximum)||q.units.length!==0)){
    fail('worker-terminal','Terminal no-unit cleanup must use the real Worker boundary');
  }
  if(current){
    if(reply.type!=='state'||reply.runId!==current.runId||reply.requestId<=current.requestId||
        q.fixedFrame!==current.fixedFrame+reply.advancedFixed||q.elapsedMs<current.elapsedMs||current.terminal){
      fail('worker-stale','Reply belongs to a different or stale run, regressed clock, or terminal session');
    }
  } else if(reply.type!=='ready'||reply.version!==VERSION||reply.gameId!==GAME||reply.stageId!==STAGE||
      reply.fps!==30||q.fixedFrame!==0||q.elapsedMs!==0||reply.advancedFixed!==0||q.paused||q.choice!==null||q.terminal!==null){
    fail('worker-initial','Exact Stage1 ready reply required to bind the run');
  }
  let ids=new Set();
  const clean=q.units.map(u=>{
    if(!exactKeys(u,['uid','cardId','x','y','z','camp','stateName','flipped'])||!int(u.uid,1,2147483647)||ids.has(u.uid)||
        !int(u.cardId,78000000,78999999)||![u.x,u.y,u.z].every(v=>finite(v,-100000,100000))||
        (u.camp!==1&&u.camp!==2)||typeof u.flipped!=='boolean'||!stateSet.has(u.stateName)){
      fail('worker-actor','Malformed, duplicated, or prematurely destroyed actor in Worker snapshot');
    }
    ids.add(u.uid);
    const {uid,cardId,x,y,z,camp,stateName,flipped}=u;
    return {uid,cardId,x,y,z,camp,stateName,flipped};
  }).sort((a,b)=>a.uid-b.uid);
  return locked({runId:reply.runId,requestId:reply.requestId,protocol,
    fixedFrame:q.fixedFrame,elapsedMs:q.elapsedMs,paused:q.paused,terminal:q.terminal&&{...q.terminal},units:clean});
}
function role(p,u){
  // Dina's cloud raw geometry is authoritative, but its authored 14 particles need
  // verified renderer/scheduling evidence, not a placeholder SpriteRenderer.
  if(u.cardId===DINA_TRAP)return 'held_dina_native_particle_renderer';
  if(!p)return 'held_unknown_native_prefab';
  return p.prefab.animator?'animated':'serialized_static';
}
function poseProvenance(){
  return {position:'actual_canonical_rule_worker_snapshot',mesh:'pinned_authored_native_stage_sprite'};
}
function captureHeader(x,view,expectedDigest,authority){
  const allowed=['schema','label','nativeBuildSha256','captureClock','sourceEvidenceSHA256','nativeIndexSha256',
    'stageId','protocol','runId','requestId','fixedFrame','displayFrame','evaluationUs','timeScale','viewport','worldSha256','actors'];
  if(!exactKeys(x,allowed)||x.schema!==CALIBRATED_CAPTURE_SCHEMA||x.label!=='verified-native-evaluation-sample'||
     x.captureClock!=='observed-native-engine-evaluation'||x.nativeBuildSha256!==authority.nativeBuildSha256||x.sourceEvidenceSHA256!==authority.sourceEvidenceSHA256||
     x.nativeIndexSha256!==STAGE1_SHA256||x.stageId!==STAGE||x.protocol!==view.protocol||x.runId!==view.runId||
     x.requestId!==view.requestId||x.fixedFrame!==view.fixedFrame||!int(x.displayFrame,0,100000000)||
     !int(x.evaluationUs,0,1000000000000)||!finite(x.timeScale,0,2)||(view.paused&&x.timeScale!==0)||
     !Array.isArray(x.viewport)||x.viewport.length!==2||x.viewport[0]!==view.viewport.width||x.viewport[1]!==view.viewport.height||
     x.worldSha256!==expectedDigest||!Array.isArray(x.actors)||x.actors.length>5000){
    fail('capture-mismatch','Native capture must match exact Stage1 view, clocks, Worker binding and world digest');
  }
}
function qualifyPose(stage,u,p){
  const a=stage.units.get(u.cardId).prefab,ctrl=a.source.controllers.find(x=>x.pathId===a.animator?.controllerPathId);
  if(!exactKeys(p,['uid','visible','stateName','clipElapsedSeconds','nativeStateHash','nativeSpritePathId'])||
      p.uid!==u.uid||typeof p.visible!=='boolean'||typeof p.stateName!=='string'||!int(p.nativeStateHash,0,0xffffffff)||
      !finite(p.clipElapsedSeconds,0,10000)||!/^[-]?\d+$/u.test(p.nativeSpritePathId)){
    fail('capture-actor','Malformed explicit actor state or sample');
  }
  const state=ctrl?.states.find(x=>x.stateName===p.stateName);
  if(!state||state.stateHash!==p.nativeStateHash)fail('capture-state','Pose state is not authored for the exact actor controller');
  const sample=nativeSpriteAt(a.source,a.animator.pathId,state.stateName,p.clipElapsedSeconds);
  if(sample.spritePathId!==p.nativeSpritePathId)fail('capture-sprite','Captured sprite ID contradicts the explicit authored clip sample');
  return {stateName:state.stateName,animationElapsedSeconds:p.clipElapsedSeconds,visible:p.visible};
}
export async function openActorBridge({nativeIndexBytes,protocol,stageId,hostVerifiedRuntimeCapturePins=[]}={}){
  if(!PROTOCOLS.includes(protocol))fail('profile-held','Only the canonical exact Stage1 profile is supported');
  const scene=SCENES[stageId],STAGE=stageId;
  if(!scene||scene.ruleProfilePin!==PROFILES[STAGE]?.profilePin||hostVerifiedRuntimeCapturePins.length!==0)
    fail('profile-held','Canonical staged reconstruction only; native witness not admitted');
  const b=bytes(nativeIndexBytes);
  if(!b||b.byteLength>2_000_000||await sha(b)!==scene.nativeIndexSha256)fail('stage-integrity','Exact stage-scoped native asset manifest required');
  // Only a release/test host that independently qualified native witness bytes may populate these
  // pins at construction. Never consume candidate-provided hashes from the evidence packet itself.
  if(!Array.isArray(hostVerifiedRuntimeCapturePins)||hostVerifiedRuntimeCapturePins.length>64||
      hostVerifiedRuntimeCapturePins.some(x=>!exactKeys(x,['sha256','nativeBuildSha256','sourceEvidenceSHA256'])||
        ![x.sha256,x.nativeBuildSha256,x.sourceEvidenceSHA256].every(h=>typeof h==='string'&&SHA.test(h)))){
    fail('capture-config','Invalid explicit host-supplied runtime witness pin registry');
  }
  const pinned=new Map(hostVerifiedRuntimeCapturePins.map(x=>[x.sha256,Object.freeze({...x})]));
  if(pinned.size!==hostVerifiedRuntimeCapturePins.length)fail('capture-config','Duplicate runtime witness pin');
  const input=decode(b),stage=compileStage(input);
  if(input.stageId!==STAGE||input.backgroundBundle!==scene.backgroundBundle)fail('stage-integrity','Stage manifest differs from selected stage');
  const initial=initialStageSnapshot(stage);
  const uidByCard=new Map(scene.authoredBootUids?Object.entries(scene.authoredBootUids).map(([k,v])=>[+k,v]):[[WALL,10001],[78000101,10002],[78000102,10003]]);
  for(const u of initial.units){
    if(u.stateName){
      const p=stage.units.get(u.cardId).prefab;
      const sample=nativeSpriteAt(p.source,p.animator.pathId,u.stateName,0);
      const def=p.renderers.get(sample.rendererPathId)?.defaultSpritePathId;
      if(def!==sample.spritePathId)fail('stage-boot','Authored idle key 0 differs from serialized sprite');
    }
  }
  let current=null,dead=false,epoch=0;
  const identity=new Map(), previous=new Set(), tombstones=new Set(), observed=new WeakMap();
  function accept(reply){
    if(dead)fail('bridge-closed','Bridge closed');
    const next=messageFacts(reply,protocol,current,scene);
    const now=new Set(next.units.map(u=>u.uid));
    if(identity.size+next.units.filter(u=>!identity.has(u.uid)).length>5000){
      fail('actor-budget','Stage1 run exceeded its bounded identity budget');
    }
    for(const u of next.units){
      if(tombstones.has(u.uid))fail('actor-resurrected','Worker reused an actor identity no longer observed');
      const h=identity.get(u.uid);
      if(h&&(h[0]!==u.cardId||h[1]!==u.camp))fail('actor-identity','An actor UID changed original card or camp');
    }
    if(!current){
      if(next.units.length!==initial.units.length)fail('stage-boot','Frame-zero actor count differs from native snapshot');
      for(const a of initial.units) {
        const u=next.units.find(u=>u.cardId===a.cardId);
        if(!u||u.uid!==uidByCard.get(a.cardId)||u.x!==a.x||u.y!==a.y||u.z!==a.z||
            u.stateName!=='START'||u.flipped||u.camp!==1)fail('stage-boot','Frame-zero actor differs from authoritative native placement/identity');
      }
    }
    const removed=[];
    for(const uid of previous) if(!now.has(uid)){
      tombstones.add(uid);
      removed.push({uid,lastObservedLogicState:identity.get(uid)[2],reason:'not_present_in_accepted_worker_snapshot'});
    }
    previous.clear();
    for(const u of next.units){previous.add(u.uid);identity.set(u.uid,[u.cardId,u.camp,u.stateName]);}
    current=next;
    epoch++;
    return locked({protocol,runId:next.runId,requestId:next.requestId,fixedFrame:next.fixedFrame,
       units:next.units.length,removed:removed.sort((a,b)=>a.uid-b.uid),terminal:!!next.terminal});
  }
  function inspect(viewport){
    if(dead||!current)fail('bridge-not-ready','Accept the authoritative ready reply first');
    if(!exactKeys(viewport,['width','height'])||!int(viewport.width,1,4096)||!int(viewport.height,1,4096)||
       viewport.width*viewport.height>16*1024*1024){
      fail('viewport-held','Explicit supported physical framebuffer resolution required');
    }
    const projection=nativeProjection(stage.input.camera,viewport.width,viewport.height);
    const actors=current.units.map(u=>{
      const k=role(stage.units.get(u.cardId),u);
      const world=[u.x,u.y,u.z].map(v=>Math.fround(v/75));
      return {uid:u.uid,cardId:u.cardId,logicState:u.stateName,sourcePresent:true,
        isDyingOrDead:u.stateName==='DEAD'||u.stateName==='DYING',camp:u.camp,flipped:u.flipped,
        worldOrigin:world,projectedPixel:projection.pixel(world[0],world[1]),
        authoredDrawOrder:k.startsWith('held_')?null:Math.ceil(-1000-u.y),assetLane:k};
    });
    const view=locked({schema:ACTOR_BRIDGE_SCHEMA,protocol,runId:current.runId,requestId:current.requestId,
       fixedFrame:current.fixedFrame,elapsedMs:current.elapsedMs,paused:current.paused,
       terminal:!!current.terminal,viewport:{...viewport},projection:{halfHeight:projection.halfHeight,
          halfWidth:projection.halfWidth,pixelsPerWorldUnit:projection.pixelsPerWorldUnit},actors,
       nativeAnimatorState:'held_unless_explicitly_qualified',supportsStageId:STAGE});
    observed.set(view,epoch);
    return view;
  }
  function currentFor(view){
    if(dead||!view||observed.get(view)!==epoch)fail('view-stale','Create a current unmodified bridge view from the accepted Worker reply');
    return current;
  }
  async function witnessDigest(view){
    const q=currentFor(view);
    const bound=encoder.encode(JSON.stringify({schema:ACTOR_BRIDGE_SCHEMA,viewport:[view.viewport.width,view.viewport.height],
        manifestSha256:STAGE1_SHA256,stageId:STAGE,worker:q}));
    const result=await sha(bound);
    currentFor(view);
    return result;
  }
  function result(view,units,provenance){
    const snapshot=locked({frame:view.fixedFrame,units});
    const commands=locked(frameCommands(stage,snapshot));
    return locked({schema:ACTOR_BRIDGE_SCHEMA,viewport:view.viewport,runId:view.runId,requestId:view.requestId,
        snapshot,commands,provenance,fullSceneNativeParity:false});
  }
  const base=u=>({uid:u.uid,cardId:u.cardId,x:u.x,y:u.y,z:u.z,camp:u.camp===1?'left':'right',flipX:u.flipped});
  async function project(view,{nativeCaptureBytes}={}){
    const q=currentFor(view);
    if(q.terminal)fail('terminal-world-held','Worker terminal no-unit cleanup is not an original battle render');
    const held=view.actors.filter(x=>x.assetLane.startsWith('held_'));
    if(held.length)fail('actor-asset-held','At least one observed actor has no qualified native renderer; no silent omission',{actorIds:held.map(a=>a.uid)});
    if(q.requestId===initialRequest&&q.fixedFrame===0&&nativeCaptureBytes===undefined){
      const units=q.units.map(u=>{
        const a=initial.units.find(x=>x.cardId===u.cardId);
        return {...base(u),stateName:a.stateName,animationElapsedSeconds:a.animationElapsedSeconds};
      });
      return result(view,units, {...poseProvenance(),pose:'serialized_pre_evaluation_default',nativeSimulationPose:false});
    }
    if(nativeCaptureBytes===undefined||pinned.size===0)fail('actor-pose-held','Missing independently pinned matching original Animator/display-clock sample', {actorIds:view.actors.filter(a=>a.assetLane==='animated').map(a=>a.uid)});
    const c=bytes(nativeCaptureBytes);
    if(!c||c.byteLength===0||c.byteLength>1_000_000){
      fail('capture-integrity','Native pose sample does not match the permitted receipt shape');
    }
    const authority=pinned.get(await sha(c));
    if(!authority)fail('capture-integrity','Native pose sample not independently pinned in the host registry');
    let proof;
    try{proof=decode(c);}catch{fail('capture-structure','Pinned sample is not valid native receipt JSON');}
    const binding=await witnessDigest(view);
    captureHeader(proof,view,binding,authority);
    const exact=new Map();
    for(const p of proof.actors){
      if(!p||!int(p.uid,1,2147483647)||exact.has(p.uid))fail('capture-actor','Invalid or duplicate captured actor UID');
      exact.set(p.uid,p);
    }
    const units=q.units.map(u=>{
      const a=stage.units.get(u.cardId);
      if(a.prefab.animator){
        if(!exact.has(u.uid))fail('capture-actor','Missing evaluated Animator pose for still-present unit');
        const p=qualifyPose(stage,u,exact.get(u.uid));
        exact.delete(u.uid);
        return {...base(u),...p};
      }
      return {...base(u),stateName:null,animationElapsedSeconds:null};
    });
    if(exact.size)fail('capture-actor','Pose receipt includes removed or non-animated units');
    return result(view,units,{...poseProvenance(),pose:'explicit_host_qualified_sample',nativeSimulationPose:false,
          displayFrame:proof.displayFrame,evaluationUs:proof.evaluationUs,captureClock:proof.captureClock,
          sourceEvidenceSHA256:proof.sourceEvidenceSHA256});
  }
  const stageIdentity=JSON.stringify(input);
  function checkRenderer(renderer){
    if(typeof renderer?.resize!=='function'||typeof renderer?.render!=='function'||
        JSON.stringify(renderer?.stage?.input)!==stageIdentity){
      fail('renderer-mismatch','The supplied renderer is not bound to the exact Stage1 manifest');
    }
  }
  async function renderTo(renderer,view,options){
    currentFor(view);
    checkRenderer(renderer);
    const frame=await project(view,options);
    currentFor(view);
    checkRenderer(renderer);
    // Explicitly size physical drawing buffer before drawing. Verify it advances along the known
    // native camera rule, not an unrelated viewport/letterbox frame.
    const proj=renderer.resize(view.viewport.width,view.viewport.height);
    if(Math.abs(proj?.halfWidth-view.projection.halfWidth)>1e-9||Math.abs(proj?.halfHeight-view.projection.halfHeight)>1e-9||
      Math.abs(proj?.pixelsPerWorldUnit-view.projection.pixelsPerWorldUnit)>1e-9||!
      [proj?.halfWidth,proj?.halfHeight,proj?.pixelsPerWorldUnit].every(Number.isFinite)){
      fail('renderer-viewport','Renderer did not confirm the exact specified physical viewport');
    }
    renderer.render(frame.snapshot);
    return frame;
  }
  let initialRequest=null;
  return Object.freeze({inspect,project,witnessDigest,renderTo,
      accept(reply){const r=accept(reply);if(initialRequest===null)initialRequest=r.requestId;return r;},
      close(){dead=true;current=null;identity.clear();previous.clear();tombstones.clear();epoch++;}});
}

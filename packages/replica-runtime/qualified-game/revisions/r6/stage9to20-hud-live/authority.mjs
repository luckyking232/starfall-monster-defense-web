import {openBattleHudLayout,composeBattleHud} from '../../../../battle-hud-presentation/plan.mjs';
import {MASK_PREVIEW} from '../../../../battle-hud-presentation/portrait-mask.mjs';
import {parseHudOracle} from '../../../presentation-capability/scene-profiles/stage1-hud/parse-ops.mjs';
import {createHudBinding} from '../../../../hud-renderer/hud-fields.mjs';
import {PROFILE_PROTOCOL,PROFILES} from '../profiles.mjs';
const PRE='explicit-stage9to20-same-display-partial-hud/1';
const PINS=[
 'c5be1d92913db571514b17f2603c58f5462ccb217fedc28ffd0398b8369bdcf7',
 'fd5b7266b2f76b9b31adff21a1a8a878c55287d15e20085d651ba1a044734916',
 '1b06eb5d2c4684b59f7644c1000337b329493b9366c09a0559140fea86d1a837',
 '663e0421e80f077094b8ad13ded7f9f7070629bec3ae81f3738c71c0182b6ab4',
 'fd94e7d2dd477065e2e730a6d4c1093f162db064414f643bd34f6bce43dee109',
 'b7e6c5105744dff06436b5b1c28f81ddf56c75f6bfc54d86076a92b50e623042'];
const ask=(p,m)=>{if(!p)throw Object.assign(Error(m),{code:'stage9to20-hud-held'});};
const sum=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),v=>v.toString(16).padStart(2,'0')).join('');
const pins=async (data,i)=>{
 ask(data instanceof Uint8Array&&data.byteLength>0&&data.byteLength<=1000000,'Unqualified HUD source bytes');
 const b=data.slice();ask(await sum(b)===PINS[i],'Stage9–20 HUD source hash mismatch');
 return b;
};
const dec=b=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));
const field={time:'time',wave:'wave',kills:'kills',level:'level',expCount:'exp',expFill:'expFill',wallName:'wallName',
 wallHp:'wallHp',wallFill:'wallFill',speedText:'speed',speedPage:'speedPage'};
export const LANE=PRE;
export async function openStage9to20HudProjection({stageId,lane,layoutBytes,sourceAssetsReceiptBytes,bindingBytes,stageConfigBytes,fontManifestBytes,finiteReceiptBytes}={}){
 ask(lane===PRE&&[78000009, 78000010, 78000011, 78000012, 78000013, 78000014, 78000015, 78000016, 78000017, 78000018, 78000019, 78000020].includes(stageId),'Stage9–20 explicit reconstruction path only');
 const [b,q,d,s,f,finite]=await Promise.all([layoutBytes,sourceAssetsReceiptBytes,bindingBytes,stageConfigBytes,fontManifestBytes,finiteReceiptBytes].map(pins));
 const layout=structuredClone(await openBattleHudLayout(b)),bind=createHudBinding(dec(d),dec(s)),fontManifest=dec(f);
 const audited=dec(q),assetLedger=audited.assetsAndAuthoredAnchors.byObservedLoader;
 const roster=audited.witness['78000007'].init.cards;
 const proven=dec(finite).capturedSourcePlans[String(stageId)];
 ask(proven?.sameRuntimeBSPortraitAndSkillBindings===true&&proven.fenceId===(stageId>=78000019?78000112:78000111)&&
     proven.fenceHp===(stageId>=78000019?7500:6000),'Missing finite-stage HUD fence and roster proof');
 for(const [uri,a] of Object.entries(assetLedger)){
  if(layout.images[a.item]){ask(layout.images[a.item].sha256===a.cropSha256,'Incorrect original loader port');continue;}
  const name=uri.split(':')[1];
  ask(/^[BS]_\d+$/u.test(name),'Unknown original stage-specific loader');
  layout.images[a.item]={basename:a.path.split('/').at(-1),name,sha256:a.cropSha256,offset:[0,0],smoothing:true,
    originalSize:a.size,sourceSize:a.size,scale9:null,scaleOption:0,tileParts:null};
 }
 const exact=PROFILES[stageId];
 let run=null,lastReq=-1,committed=null,last=null,closed=false;
 const validScope=x=>x?.stageId===stageId&&x.profilePin===exact.profilePin&&x.profileId===exact.profileId;
 function commit(p,f,hudOps){
  ask(!closed&&p?.protocol===PROFILE_PROTOCOL&&p.state?.stageId===stageId&&validScope(p)&&validScope(p.gates?.stageScope)&&
    p.gates.sourceState==='integrity_verified'&&p.gates.audiovisualParity==='held'&&p.gates.deployment==='not_deployed'&&
    p.gates.nonRenderableDisplayBoundary?.drawable===false&&typeof p.runId==='string'&&Number.isSafeInteger(p.requestId)&&
    p.requestId>=lastReq&&(run===null||p.runId===run),'Invalid HUD rule identity or sequence');
  ask(f?.stageId===stageId&&f.protocol===PROFILE_PROTOCOL&&f.runId===p.runId&&f.requestId===p.requestId&&f.nativeRuntimePose===false,
    'World/HUD do not share the canonical packet');
  run=p.runId;lastReq=p.requestId;
  if(p.state.fixedFrame>1750){committed=null;return (last=null);} // Explicit early-only diagnostic scope; rules and world unaffected.
  ask(p.state.selfMaxHp===proven.fenceHp&&p.state.units.some(x=>x.uid===10001&&x.cardId===proven.fenceId),
      'Original wall configuration differs from selected stage proof');
  if(p.type==='ready'){
   ask(!committed&&p.state.fixedFrame===0&&!hudOps,'HUD not emitted during original intro/boot');
   return (last=null);
  }
  if(p.state.paused){
   ask(!hudOps&&committed&&f.presentationStatus==='held_last_display_during_source_pause'&&
    f.frozenFromRequestId===committed.requestId&&f.display===committed.displayRef&&f.commands===committed.commandsRef&&f.snapshot===committed.snapshotRef,
    'Do not reconstruct uncommitted paused or upgrade HUD');
   return (last=Object.freeze({...committed,mode:'freeze-prior-exact-display',currentRequestId:p.requestId,pausedAtFixedFrame:p.state.fixedFrame}));
  }
  ask(typeof hudOps==='string'&&hudOps.length>0&&hudOps.length<22000,'Original display operations missing');
  const raw=parseHudOracle(hudOps);
  ask(raw.hudPhase==='native_display_ops'&&raw.fixedFrame===p.state.fixedFrame&&raw.opsFixedFrame===raw.fixedFrame&&raw.opsDisplayFrame===raw.displayFrame&&
    raw.opsFixedFrame===f.display.fixedFrame&&raw.opsDisplayFrame===f.display.displayFrame&&raw.opsDisplayFrame>(committed?.displayFrame??0),
    'Stale or mismatched original HUD/display callback');
  const expected=bind.snapshot(p.state);
  for(const a of expected.fields){
   const v=raw.top[field[a.field]];
   ask(typeof a.value==='number'?typeof v==='number'&&Math.abs(a.value-v)<1e-11:a.value===v,'Original HUD source drift: '+a.field);
  }
  const ids=[78000101,78000102,78000103,78000104,78000105];
  const heroes=p.state.units.filter(u=>u.camp===1&&ids.includes(u.cardId));
  const urls=s=>typeof s==='string'&&Object.hasOwn(assetLedger,s);
  ask(raw.cards.length===5&&heroes.length===5&&new Set(heroes.map(u=>u.uid)).size===5,'Unqualified Stage9–20 roster column');
  for(const [i,c] of raw.cards.entries()){
   const binding=roster[i];
   ask(c.slot===i+1&&c.cardId===ids[i]&&heroes.some(u=>u.cardId===c.cardId&&u.uid===c.uid)&&c.dpsPage===0&&c.cardPage===0&&c.countPage===1&&
     c.portrait===binding.portrait&&c.circle===binding.circle&&urls(c.portrait)&&urls(c.circle)&&c.skills.length===3&&
     c.skills.every((s,j)=>s.slot===j+1&&s.id===binding.skills[j].id&&s.icon===binding.skills[j].icon&&urls(s.icon)),
     'Unknown slot, actor, skill or icon in original HUD');
  }
  const plan=composeBattleHud(layout,raw,{introAcknowledged:true,fontManifest,portraitLane:MASK_PREVIEW});
  ask(plan.commands.length>0&&plan.nativeUnityFrame===false&&plan.blurSourceQualified===false&&
    plan.held.every(x=>x.reason==='game_requested_tween_target_not_rendered_fill')&&
    !plan.commands.some(c=>c.path.endsWith('/DPSProgressBar/bar/n8')),'Cannot draw unavailable DPS, stencil or unknown original HUD');
  return (last=committed=Object.freeze({mode:PRE,stageId,runId:run,requestId:p.requestId,displayFrame:raw.opsDisplayFrame,fixedFrame:raw.opsFixedFrame,
    displayRef:f.display,commandsRef:f.commands,snapshotRef:f.snapshot,plan,
    introNotReplayed:true,nativeStencilKnown:false,knownSafeArea:false,nativeDpsTweenKnown:false,blurSourceQualified:false,sourceSnapshotOnly:true}));
 }
 return Object.freeze({commit(...x){try{return commit(...x);}catch(e){this.close();throw e;}},
  peek(){return last;},close(){closed=true;last=null;committed=null;}});
}

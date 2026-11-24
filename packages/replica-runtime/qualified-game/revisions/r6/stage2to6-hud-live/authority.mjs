import {openBattleHudLayout,composeBattleHud} from '../../../../battle-hud-presentation/plan.mjs';
import {MASK_PREVIEW} from '../../../../battle-hud-presentation/portrait-mask.mjs';
import {parseHudOracle} from '../../../presentation-capability/scene-profiles/stage1-hud/parse-ops.mjs';
import {createHudBinding} from '../../../../hud-renderer/hud-fields.mjs';
import {PROFILE_PROTOCOL,PROFILES} from '../profiles.mjs';
const PRE='explicit-stage2to6-same-display-partial-hud/1';
const PINS=[
 'c5be1d92913db571514b17f2603c58f5462ccb217fedc28ffd0398b8369bdcf7',
 'fd5b7266b2f76b9b31adff21a1a8a878c55287d15e20085d651ba1a044734916',
 '1b06eb5d2c4684b59f7644c1000337b329493b9366c09a0559140fea86d1a837',
 '663e0421e80f077094b8ad13ded7f9f7070629bec3ae81f3738c71c0182b6ab4',
 'fd94e7d2dd477065e2e730a6d4c1093f162db064414f643bd34f6bce43dee109',
 'af5e7dc0147efe5a9ccc22a23ff2946444bbc9e8d47c832142fae1190758603e'];
const ask=(p,m)=>{if(!p)throw Object.assign(Error(m),{code:'stage2to6-hud-held'});};
const sum=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),v=>v.toString(16).padStart(2,'0')).join('');
const pins=async (data,i)=>{
 ask(data instanceof Uint8Array&&data.byteLength>0&&data.byteLength<=1000000,'Unqualified HUD source bytes');
 const b=data.slice();ask(await sum(b)===PINS[i],'Stage2–6 HUD source hash mismatch');
 return b;
};
const dec=b=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));
const field={time:'time',wave:'wave',kills:'kills',level:'level',expCount:'exp',expFill:'expFill',wallName:'wallName',
 wallHp:'wallHp',wallFill:'wallFill',speedText:'speed',speedPage:'speedPage'};
export const LANE=PRE;
export async function openStage2to6HudProjection({stageId,lane,layoutBytes,sourceAssetsReceiptBytes,bindingBytes,stageConfigBytes,fontManifestBytes,finiteReceiptBytes}={}){
 ask(lane===PRE&&[78000002, 78000003, 78000004, 78000005, 78000006].includes(stageId),'Stage2–6 explicit reconstruction path only');
 const [b,q,d,s,f,finite]=await Promise.all([layoutBytes,sourceAssetsReceiptBytes,bindingBytes,stageConfigBytes,fontManifestBytes,finiteReceiptBytes].map(pins));
 const layout=structuredClone(await openBattleHudLayout(b)),bind=createHudBinding(dec(d),dec(s)),fontManifest=dec(f);
 const audited=dec(q),assetLedger=audited.assetsAndAuthoredAnchors.byObservedLoader;
 const proven=dec(finite).fiveScopedSnapshots[String(stageId)];
 ask(proven?.fenceId===78000110&&proven.fenceId===proven.geometry.roles[0]&&proven.wallHp===5000&&
   proven.activeRows>=2&&proven.activeRows<=4&&proven.heldEmptyRows===5-proven.activeRows,'Missing early stage HUD proof');
 const roster=proven.provenLoaderIds;
 ask(roster.length===proven.activeRows&&roster.every((x,i)=>x.cardId===proven.geometry.roles[i+1]),
     'Mismatched exact stage roster');
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
    p.gates.nonRenderableDisplayBoundary===undefined&&typeof p.runId==='string'&&Number.isSafeInteger(p.requestId)&&
    p.requestId>=lastReq&&(run===null||p.runId===run),'Invalid HUD rule identity or sequence');
  ask(f?.stageId===stageId&&f.protocol===PROFILE_PROTOCOL&&f.runId===p.runId&&f.requestId===p.requestId&&f.nativeRuntimePose===false,
    'World/HUD do not share the canonical packet');
  run=p.runId;lastReq=p.requestId;
  if(p.state.fixedFrame>1800){committed=null;return (last=null);} // Explicit early-only diagnostic scope; rules and world unaffected.
  ask(p.state.selfMaxHp===proven.wallHp&&p.state.units.some(x=>x.uid===10001&&x.cardId===proven.fenceId),
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
  const ids=roster.map(q=>q.cardId);
  const heroes=p.state.units.filter(u=>u.camp===1&&ids.includes(u.cardId));
  const urls=s=>typeof s==='string'&&Object.hasOwn(assetLedger,s);
  ask(raw.cards.length===5&&heroes.length===roster.length&&new Set(heroes.map(u=>u.uid)).size===roster.length,'Unqualified Stage2–6 roster column');
  for(const [i,c] of raw.cards.entries()){
   const binding=roster[i];
   if(!binding){
    ask(c.slot===i+1&&c.uid===null&&c.cardId===null&&c.dpsPage===1&&c.cardPage===1&&c.countPage===null&&
      c.portrait===null&&c.circle===null&&Array.isArray(c.skills)&&c.skills.length===0, 'Original empty row changed');
    continue;
   }
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

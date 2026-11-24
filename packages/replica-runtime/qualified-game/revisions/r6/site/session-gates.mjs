import {PROFILE_PROTOCOL,PROFILE_VERSION,PROFILES} from '../profiles.mjs';
export const qualifiedStage=id=>Number.isSafeInteger(id)&&Object.hasOwn(PROFILES,id)?PROFILES[id]:null;
const fail=error=>Object.assign(Error(error),{code:'worker-contract'});
const same=(v,p)=>v?.stageId===p.stageId&&v.profileId===p.profileId&&v.profilePin===p.profilePin;
export function verifyProfileReply(m,id,type){
  const p=qualifiedStage(id);
  if(!p||m?.protocol!==PROFILE_PROTOCOL||m?.type!==type||!same(m,p))
    throw fail('Worker did not respond for this exact stage identity');
  if(type==='closed')return m;
  const g=m.gates;
  if(!same(g?.stageScope,p)||m.state?.stageId!==p.stageId||
    g?.sourceState!=='integrity_verified'||g.source!=='pinned_explicit_stage_profiles_only'||
    g.animation!=='held_unmapped_unity_Animator_time'||g.audiovisualParity!=='held'||
    g.worldPose!=='raw_unit_state_without_animation'||g.deployment!=='not_deployed')
    throw fail('Exact stage scope or display holds changed in the Worker response');
  const db=g.nonRenderableDisplayBoundary;
  const diagnostic=id>=78000007&&id<=78000021;
  const originalAura="Assets/Art/Effects/Prefab/UI_prefab/MiniGame/MiniGame022/Minigame022_10000198_skill3_buff.prefab";
  if(diagnostic ? !db||db.drawable!==false||db.affectsSimulation!==false||db.ruleObservationOnly!==true||
        db.status!=='held_exact_original_drawable_not_supplied'||db.path!==originalAura : db!==undefined)
    throw fail('Worker supplied a display scope that does not match this private rule lane');
  if(id===78000021){
    const e=g.endlessQualification,f=m.state.fixedFrame,t=m.state.terminal;
    const target=t?'native_neutral_terminal':f===12000?'live_horizon_held':'active_source_rules';
    if(e?.optIn!=='original-bounded-neutral-v1'||e.fixedFrameCap!==12000||e.actualCycleVerified!==false||
       e.officialService!==false||e.finitePoints!==0||e.disposition!==target||!Number.isSafeInteger(f)||f<0||f>12000||
       (t&&(t.win!==false||t.loss!==false)))throw fail('Stage21 neutral display scope changed');
  } else if(g.endlessQualification!==undefined)throw fail('Endless authority must not leak into finite stages');
  if(type==='ready'&&(m.version!==PROFILE_VERSION||m.gameId!==70441022||m.fps!==30))
    throw fail('Scoped Worker build differs from original input pin');
  return m;
}

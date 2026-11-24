/** A link from original Stage1 Lua call observations to the supplied client's proved call contract.
 * These remain *requests*: the renderer's real dynamic-pose gate must not consume them as poses. */
export const BASE_GAME_BINDING_PROOF_SHA256='2797d53ddffd450ccebfa39d78fc5be617c62c5193a40301f1f1ca34eb7742cd';
const phaseSet=new Set(['boot','fixed','display']);
const stateSet=new Set(['die','idle','run','skill1']);
const positive=/^[1-9][0-9]{0,9}$/u;
const counter=/^(?:0|[1-9][0-9]{0,8})$/u;
const card=/^780[0-9]{5}$/u;
export function fromObservedStage1LuaCall(row) {
  if(!Array.isArray(row)||row.length!==7||row.some(v=>typeof v!=='string')
    ||row[0]!=='play-request'||!phaseSet.has(row[1])||!counter.test(row[2])||!counter.test(row[3])
    ||!positive.test(row[4])||!card.test(row[5])||!stateSet.has(row[6])){
    throw new TypeError('Only the exact observed Stage 1 two-argument Lua PlayAnimator row is supported');
  }
  const [kind,phase,fixed,display,unit,unitCard,stateName]=row;
  if((phase==='boot'&&(fixed!=='0'||display!=='0'))||(phase==='display'&&display==='0')){
    throw new TypeError('Invalid source directive clock');
  }
  return Object.freeze({
    kind:'supplied-client-animator-play-request',
    requestEvidence:BASE_GAME_BINDING_PROOF_SHA256,
    phase,fixedFrame:Number(fixed),displayFrame:Number(display),unitId:Number(unit),cardId:Number(unitCard),
    requestedStateName:stateName,requestedLayer:0,normalizedTimeTag:'negative-infinity',normalizedTimeF32Bits:'ff800000',
    poseStatus:'held_needs_original_runtime_capture',
    currentAnimatorState:null,appliedNormalizedTime:null,
  });
}
export function requireAppliedAnimatorRuntimePose() {
  // No runtime capture receipt currently exists. Explicitly reject inputs; never launch/render unknown trace.
  throw Object.assign(new Error('Unverified runtime Animator pose; this input supports observed requests only'),{code:'animator-runtime-pose-held'});
}

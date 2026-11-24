// Sample the verified single SpriteRenderer clip, not Unity transition/VFX simulation.
export function nativeSpriteAt(prefab, animatorPathId, stateName, sourceTimeSeconds) {
  if (!Number.isFinite(sourceTimeSeconds) || sourceTimeSeconds < 0) throw new Error("Invalid source time");
  const a = prefab.animators.find(x=>x.pathId===animatorPathId);
  if (!a) throw new Error("Unknown animator");
  const c = prefab.controllers.find(x=>x.pathId===a.controllerPathId);
  if (!c) throw new Error("No verified direct state controller");
  const s = c.states.find(x=>x.stateName === (stateName ?? c.defaultState));
  if (!s) throw new Error("State not authored for this controller");
  const clip = prefab.clips.find(x=>x.pathId===s.animationClipPathId);
  if (!clip || clip.spriteCurves.length!==1 || clip.spriteCurves[0].bindingPath!=="" ||
      clip.otherCurvesPresent || clip.events.length || !(clip.stopTime>0) ||
      s.cycleOffset!==0 || !(s.speed>0)) throw new Error("Unsupported source clip");
  const r = prefab.spriteRenderers.filter(x=>x.gameObjectPathId===a.gameObjectPathId && x.enabled);
  if (r.length!==1) throw new Error("Unverified SpriteRenderer binding");
  let t = sourceTimeSeconds*s.speed;
  t = s.loop ? t % clip.stopTime : Math.min(t, clip.stopTime);
  const keys=clip.spriteCurves[0].keys;
  let lo=0, hi=keys.length;
  while(hi-lo>1) {
    const mid=(lo+hi)>>1;
    if(keys[mid].timeSeconds<=t) lo=mid;else hi=mid;
  }
  const k=keys[lo];
  if (k.fileId!==0) throw new Error("Unresolved external Sprite");
  return {rendererPathId:r[0].pathId,spritePathId:k.spritePathId,timeSeconds:t,
          keyTimeSeconds:k.timeSeconds,clipPathId:clip.pathId};
}

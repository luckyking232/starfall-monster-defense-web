/** Explicit deterministic reconstruction, not a FairyGUI/Unity runtime capture. */
export const DPS_PREVIEW='starfall-stage1-display-dps-linear-preview/1';
export const NATIVE_TWEEN_EVIDENCE='6978df7ac8fc00d35509a448f1aece978751f1bd21074149d0a3143d20e94e60';
const ints=n=>Number.isSafeInteger(n)&&n>=0;
const percentage=n=>Number.isFinite(n)&&n>=0&&n<=100;
const slots=new WeakMap();
const assert=(x,m)=>{if(!x)throw Error(m);};
const freeze=x=>{if(x&&typeof x==='object'&&!Object.isFrozen(x)){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
const sample=(q,at)=>q.start+(q.target-q.start)*Math.max(0,Math.min(1,(at-q.at)/100000));
export function createDpsPreview({lane}={}){
 assert(lane===DPS_PREVIEW,'Explicit reconstructed linear DPS lane required');
 let run=null,last=null,active=[],closed=false,privateFrame=null;
 function accept({runId,display,raw}){
  assert(!closed&&typeof runId==='string'&&runId.length&&[display?.fixedFrame,display?.displayFrame,
    display?.wallUs,display?.scaledUs].every(ints)&&display?.timeScale>0&&
    raw?.opsFixedFrame===display.fixedFrame&&raw?.opsDisplayFrame===display.displayFrame&&raw.cards.length===5,
    'DPS preview requires an active committed display sample');
  const previous=last;
  if(previous&&display===previous){
    assert(privateFrame?.raw===raw&&run===runId,'Altered duplicate DPS source frame');
    return privateFrame;
  }
  assert(run===null||run===runId,'DPS run switched');
  assert(previous?display.displayFrame===previous.displayFrame+1&&display.fixedFrame>=previous.fixedFrame&&
    display.wallUs>=previous.wallUs&&display.scaledUs>=previous.scaledUs:
    raw.hudPhase==='native_init_ops'&&display.fixedFrame===0&&display.displayFrame===0&&display.scaledUs===0,
    'DPS preview display order/clock drift');
  const at=display.scaledUs;
  let next=[];
  for(const [i,c] of raw.cards.entries()){
    const o=active[i];
    assert(c.slot===i+1&&(!o||o.uid===c.uid),'DPS source roster changed');
    if(c.uid===null){next.push({uid:null,current:null,state:null});continue;}
    assert(c.dpsAssigned===0&&(c.dpsTweenTo===null?c.dpsTweenDuration===null:
      percentage(c.dpsTweenTo)&&c.dpsTweenDuration===0.1),'Invalid original DPS tween request');
    const current=o?sample(o.state,at):0;
    let state=o?.state??{start:0,target:0,at};
    // Source TweenValue samples the in-flight value and retargets while keeping original 0.1 s linear policy.
    // Presentation convention: advance by the host's scaled display delta, then dispatch this update's request.
    if(c.dpsTweenTo!==null)state={start:current,target:c.dpsTweenTo,at};
    next.push({uid:c.uid,current,state});
  }
  run=runId;last=display;active=next;
  privateFrame=Object.freeze({schema:DPS_PREVIEW,nativeUnityFrame:false,clock:'host_scaled_display_microseconds',
    raw:freeze(raw),display,runId,sourceNativeSHA:NATIVE_TWEEN_EVIDENCE,values:Object.freeze(next.map(x=>x.current))});
  slots.set(privateFrame,{raw,values:privateFrame.values});
  return privateFrame;
 }
 return Object.freeze({accept,close(){closed=true;last=null;active=[];privateFrame=null;}});
}
export function dpsSampleValues(token,raw){
 const t=slots.get(token);
 assert(t?.raw===raw,'DPS sample is not bound to its original HUD operations');
 return t.values;
}

// Pinned opt-in derivative. Original default /1 and /2 files do not change.
/** Private diagnostic shell. Original pixels appear only at independently qualified boundaries. */
import {composeChooser,composeOutcome,hitTest} from '../../../../screen-shell/screen.mjs';
import {STATIC_MAPS} from './static-maps.mjs';
const W=1334,H=750;
const inside=([x,y,w,h],p)=>p.x>=x&&p.x<x+w&&p.y>=y&&p.y<y+h;
const bad=(code,message)=>Object.assign(Error(message),{code});
const battleHold=Object.freeze(['original_unity_animation_clock','original_battle_dynamic_pixels',
  'original_scene_audio_and_mixing','actual_browser_pixel_acceptance']);
export function canvasPoint(x,y,{left,top,width,height}){
  if(![x,y,left,top,width,height].every(Number.isFinite)||width<=0||height<=0)
    throw bad('canvas-coordinates','Expected visible 1334×750 reference canvas');
  return {x:(x-left)*W/width,y:(y-top)*H/height};
}
/** Separate diagnostic RAF transport, not the original Unity Animator scheduler. */
export function createCadence({maxGapMs=250}={}){
  if(!Number.isFinite(maxGapMs)||maxGapMs<20||maxGapMs>500) throw bad('timing-limit','Invalid local time cap');
  let previous=null,key=null,carry=0;
  function reset(){previous=null;key=null;carry=0;}
  function ingest(at,{phase,speedIndex,runId='offline',hidden=false}){
    if(!Number.isFinite(at)||at<0) throw bad('clock','Nonnegative monotonic timestamp required');
    if(hidden||!['battle','upgrade'].includes(phase)){reset();return null;}
    if(phase==='battle'&&![1,2].includes(speedIndex)) throw bad('speed','Expected known 1×/2×');
    const next=runId+'/'+phase+'/'+(phase==='battle'?speedIndex:'unscaled');
    if(previous!==null&&at<previous) {reset();throw bad('clock','Diagnostic clock regressed');}
    if(key!==next){key=next;previous=at;carry=0;return null;}
    const gap=Math.min(maxGapMs,at-previous);
    previous=at;
    carry+=phase==='battle'?gap*(30*speedIndex)/1000:gap;
    const n=Math.floor(carry+1e-8);
    if(!n)return null;
    carry-=n;if(carry<0)carry=0;
    return phase==='battle'?{kind:'fixed',n}:{kind:'unscaled',n};
  }
  return Object.freeze({reset,ingest});
}

export function createMultistageShell({session,screenManifest,makeRng}={}){
  if(session?.view?.()?.protocol!=='starfall-offline-defense-qualified-session/1'||
     screenManifest?.schema!=='starfall.monsters-defense.screen-shell/1'||typeof makeRng!=='function')
    throw bad('scope','Local game-session and original settled screens must be present');
  let scrollX,visualMs=null,lastOffer=null,lastRun=null,lastPhase=null;
  const cadence=createCadence();
  const getChoiceId=s=>s.battle?.choice?s.runId+'/'+s.battle.choice.windowId:null;
  function sync(s){
    const offered=getChoiceId(s);
    if(offered!==lastOffer){lastOffer=offered;visualMs=offered?0:null;}
    if(s.runId!==lastRun||s.phase!==lastPhase){lastRun=s.runId;lastPhase=s.phase;cadence.reset();}
    return s;
  }
  function openScope(){scrollX=undefined;visualMs=null;cadence.reset();}
  function frame(){
    const s=sync(session.view());
    if(s.phase==='chooser'&&s.chooser?.stages)
      return {plane:'chooser',model:composeChooser(screenManifest,s.chooser,{nativeScrollX:scrollX}),state:s,renderScope:'native_static'};
    if(s.phase==='result')
      return {plane:'outcome',model:composeOutcome(screenManifest,s.result),state:s,renderScope:'native_static'};
    if(s.phase==='upgrade')
      return {plane:'choice',model:session.choiceFrame({windowInMs:visualMs}),state:s,
        renderScope:'native_partial_motion',heldWorld:true,holds:battleHold};
    if(s.scope.stageId>=78000007&&s.scope.stageId<=78000021&&s.workerGates?.nonRenderableDisplayBoundary&&
       ['battle-ready','battle','paused','exit-confirm'].includes(s.phase)){
      return {plane:'held',model:null,state:s,renderScope:'headless_rules_only',
        heldWorld:true,nativeDrawable:false,holds:battleHold};
    }
    if(s.phase==='endless-horizon')return {plane:'held',model:null,state:s,renderScope:'endless_horizon',
      heldWorld:true,nativeDrawable:false,holds:battleHold};
    const art=STATIC_MAPS[s.scope.stageId];
    if(art&&['battle-ready','battle','paused','exit-confirm'].includes(s.phase))
      return {plane:'map-static',model:{stageId:art.stageId,crop:art.crop},state:s,
        renderScope:'static_source_art_only',heldWorld:true,holds:art.holds};
    return {plane:'held',model:null,state:s,renderScope:'diagnostic_only',holds:battleHold};
  }
  function hover(x,y,f=frame()){
    if(!Number.isFinite(x)||!Number.isFinite(y)) throw bad('hit','Invalid native coordinates');
    if(f.state.pendingCommand)return null;
    if(f.plane==='chooser'||f.plane==='outcome') return hitTest(f.model,x,y);
    if(f.plane==='choice')return f.model.targets.find(t=>inside(t.rect,{x,y}))??null;
    return null;
  }
  async function pointer(x,y){
    const f=frame();
    const t=hover(x,y,f);
    if(!t)return {handled:false,state:f.state};
    if(f.plane==='choice'){
      const state=await session.chooseAt(x,y,{windowInMs:visualMs});
      return {handled:true,state:sync(state)};
    }
    let answer;
    if(t.kind==='stage'){
      // Unqualified scope is handled by game-session, never directly invoked.
      const id=f.state.chooser.stages[t.index]?.result?.stageId;
      const rng=f.state.scope.availableStages.includes(id)?makeRng(id):undefined;
      answer=await session.enterStage(t.index,rng);
    } else if(t.kind==='card') answer=await session.selectCard(t.index);
    else if(t.kind==='return'){openScope();answer=await session.closeChooser();}
    else if(t.kind==='result-close'){openScope();answer=await session.returnToChooser();}
    else throw bad('hit','Unqualified authored input');
    return {handled:true,state:sync(answer)};
  }
  function setScroll(n){
    if(session.view().phase!=='chooser'||!Number.isFinite(n)) throw bad('scroll','Chooser position outside current screen');
    scrollX=n;
    return frame();
  }
  async function command(kind,value){
    let s;
    switch(kind){
      case 'enable-endless':s=await session.enableEndless();break;
      case 'close-horizon':openScope();s=await session.closeHorizon();break;
      case 'snapshot': s=await session.pushSnapshot(value);break;
      case 'open-chooser':openScope();s=await session.openChooser();break;
      case 'start-fixed':s=await session.beginBattle();break;
      case 'pause':s=await session.pause();break;
      case 'continue':s=await session.resume();break;
      case 'speed':s=await session.toggleSpeed();break;
      case 'leave':s=await session.requestLeave();break;
      case 'cancel-leave':s=await session.cancelLeave();break;
      case 'confirm-leave':s=await session.confirmLeave();break;
      case 'reset-card':s=await session.resetCard();break;
      case 'ack':{
        const p=session.view().settlement;
        s=await session.finishSettlement({runId:p?.runId,status:value});break;
      }
      case 'recover':openScope();s=await session.returnToChooser();break;
      case 'fixed':s=await session.stepFixed(value);break;
      case 'unscaled':{
        s=await session.advanceUnscaled(value);
        if(visualMs!==null)visualMs+=value;
        break;
      }
      default:throw bad('command','Unsupported private test action');
    }
    return sync(s);
  }
  async function tick(at,{hidden=false}={}){
    const s=sync(session.view());
    if(s.pendingCommand){if(hidden)cadence.reset();return s;}
    const move=cadence.ingest(at,{phase:s.phase,speedIndex:s.battle?.speedIndex,runId:s.runId??'offline',hidden});
    return move?command(move.kind,move.n):s;
  }
  return Object.freeze({frame,hover,pointer,setScroll,command,tick,resetClock:cadence.reset,
    dispose(){cadence.reset();session.dispose();}});
}

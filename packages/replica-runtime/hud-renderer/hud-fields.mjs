/** Source-derived output operations; no DOM substitutes, default font, game-tick advancement, or state guessing. */
const exactVersion="134377281279792758";
const constrain=(ok,m)=>{if(!ok)throw new RangeError(m);};
const nonnegative=n=>Number.isSafeInteger(n)&&n>=0;
const pad=n=>String(n).padStart(2,"0");

export function clockString(fixedFrame,fixedFps=30){
  constrain(nonnegative(fixedFrame)&&fixedFps===30,"Invalid native clock");
  const seconds=Math.floor(fixedFrame/fixedFps), h=Math.floor(seconds/3600);
  const mm=Math.floor((seconds%3600)/60),ss=seconds%60;
  return h>0?`${h}:${pad(mm)}:${pad(ss)}`:`${mm}:${pad(ss)}`;
}
function fmt(template,...args){
  let at=0;
  const r=template.replace(/%[ds]/g,x=>{
    constrain(at<args.length,x+" argument absent");
    const v=args[at++];
    constrain(x!=="%d"||Number.isSafeInteger(v),"Lua numeric format requires exact integral input");
    return String(v);
  });
  constrain(at===args.length,"Unexpected localization argument");
  return r;
}
function equal(a,b){
 return JSON.stringify(a)===JSON.stringify(b);
}
export function createHudBinding(cfg,stageConfigs,fontRefs=[]){
  constrain(cfg?.version===exactVersion&&cfg.schema==="starfall.monsters-defense.hud-binding/1"&&cfg.rootComponentId==="n6021"
    &&stageConfigs?.version===exactVersion&&stageConfigs.schema===1&&stageConfigs.gameId===70441022,"Wrong pinned HUD/input tables");
  const fontAvailable=new Set(fontRefs), byStage=new Map(stageConfigs.stages.map(st=>[st.id,st]));
  function snapshot(s,{nativeInit=false}={}){
    const schema=["fixedFrame","stageId","curMonsterWave","killEnemyCount","curLevel","curExp","selfHp","selfMaxHp","speedIndex"];
    if(s?.terminal){
      constrain(nonnegative(s.fixedFrame)&&byStage.has(s.stageId)&&s.curLevel===null&&s.curExp===null&&
        s.selfHp===null&&s.selfMaxHp===null&&s.speedIndex===null,"Invalid cleared original state");
      return Object.freeze({stageId:s.stageId,fixedFrame:s.fixedFrame,status:"terminal_source_cleared",fields:Object.freeze([])});
    }
    constrain(s&&schema.every(k=>nonnegative(s[k]))&&s.curMonsterWave>=1&&s.selfMaxHp>=1&&s.selfHp<=s.selfMaxHp&&
      cfg.speedOptions.includes(s.speedIndex),"Missing or invalid original HUD state");
    const st=byStage.get(s.stageId);const stageArgument=cfg.stageNameArguments[s.stageId];
    constrain(st&&stageArgument!==undefined,"Unverified stage HUD localization");
    const t=(n,...a)=>fmt(cfg.templates[n],...a);
    const target=(field,op,value,extra={})=>{
      const ref=cfg.targets[field];
      constrain(ref?.route?.length>0,"Missing exact HUD target: "+field);
      return {field,op,value,route:ref.route,...extra};
    };
    const text=(field,value)=>{
      const fontRef=cfg.targets[field].fontRef;
      constrain(typeof fontRef==="string","Original HUD font metadata missing");
      return target(field,"set-text",value,{fontRef,renderText:fontAvailable.has(fontRef),
        fontStatus:fontAvailable.has(fontRef)?"verified_available":"hold_missing_original_font"});
    };
    const need=st.level_time[s.curLevel], previous=st.level_time[s.curLevel-1];
    // Lua arrays are 1-based: allLevel[level+1] vs allLevel[level]. Level transition snapshots are not interpolated.
    const capped=need===undefined||s.curExp>=need;
    const expDen=capped?previous:need;
    constrain(Number.isSafeInteger(expDen)&&expDen>0,"Non-observable HUD EXP state");
    return Object.freeze({
      stageId:s.stageId,fixedFrame:s.fixedFrame,status:"live_hud",fields:Object.freeze([
        text("time",clockString(s.fixedFrame)),
        text("wave",t(11903,t(80220001,stageArgument),s.curMonsterWave)),
        text("kills",t(11901,s.killEnemyCount)),
        text("level",t(1303,s.curLevel)),
        text("expCount",t(11900,s.curExp,expDen)),
        target("expFill","set-progress-value",capped?100:100*s.curExp/need),
        text("wallName",t(11902)),
        text("wallHp",t(11024,s.selfHp,s.selfMaxHp)),
        target("wallFill","set-progress-value",nativeInit?100:100*s.selfHp/s.selfMaxHp),
        text("speedText",t(11909,s.speedIndex)),
        target("speedPage","set-controller-page-index",s.speedIndex-1,{controller:"c1"}),
      ]),
    });
  }
  function diff(previous,next){
    constrain(next&&Array.isArray(next.fields)&&(!previous||previous.stageId===next.stageId)&&
      (!previous||previous.fixedFrame<=next.fixedFrame),"Wrong stage or stale HUD snapshot; restart bindings explicitly");
    if(next.status==="terminal_source_cleared")return previous?.status===next.status?[]:
      [{field:"liveHud",op:"invalidate-after-source-clear",value:true,route:[]}];
    constrain(previous?.status!=="terminal_source_cleared","Restart HUD explicitly after terminal");
    const already=new Map((previous?.fields??[]).map(x=>[x.field,x]));
    return next.fields.filter(x=>!equal(x,already.get(x.field)));
  }
  function choiceClock(choice){
    if(choice===null)return null;
    constrain(choice&&nonnegative(choice.windowId)&&nonnegative(choice.generation)&&Number.isFinite(choice.remainingMs)&&
      choice.remainingMs>=0&&choice.remainingMs<=30000,"Invalid source choice window clock");
    return {windowId:choice.windowId,generation:choice.generation,
      field:"choiceConfirmCountdown",op:"set-original-button-text",
      value:fmt(cfg.templates[11904],Math.ceil(choice.remainingMs/1000)),route:cfg.choiceTimeTarget.route,
      renderText:false,fontStatus:"hold_missing_original_font"};
  }
  return Object.freeze({snapshot,diff,choiceClock});
}

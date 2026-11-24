// Pinned opt-in derivative. Original default /1 and /2 files do not change.
import {openActivityFlow} from '../../../../activity-flow/activity-flow.mjs';
import {makeMultistageRulesClient, PROFILE_PROTOCOL, PROFILES} from '../client.mjs';
import {ENDLESS_MODE,projectEndlessSettlement} from '../endless-settlement.mjs';
import {STAGE_ART} from '../art-profile.mjs';
import {qualifiedStage,verifyProfileReply} from './session-gates.mjs';
import {createChoiceHud} from './choice-hud.mjs';

export const SESSION_PROTOCOL='starfall-offline-defense-qualified-session/1';
const STAGE=78000001, GAME=70441022, VERSION='134377281279792758';
const CHOICE_SHA='bb83df2e9047aaa56053db3eec4392a23e99ddeeedc1a3e583259f40fd75bbe6';
const fail=(code,message)=>Object.assign(Error(message),{code});
const int=(n,a,b)=>Number.isSafeInteger(n)&&n>=a&&n<=b;
const immutable=x=>{
  if (x && typeof x==='object'&&!Object.isFrozen(x)){
    for(const v of Object.values(x)) immutable(v);
    Object.freeze(x);
  }
  return x;
};
const pauseDialog=immutable({title:'暂停中',description:'点击屏幕任意位置继续战斗'});
const exitDialog=immutable({title:'退出战斗',description:'退出将以当前击杀结算，是否退出？',cancelLabel:'取消',confirmLabel:'确定'});

async function pinnedChoice(bytes){
  if (!(bytes instanceof Uint8Array)&&!(bytes instanceof ArrayBuffer)) throw fail('choice-input','Expected bytes');
  const b=bytes instanceof Uint8Array?new Uint8Array(bytes):new Uint8Array(bytes.slice(0));
  if (b.length===0||b.length>1_000_000) throw fail('choice-input','Invalid asset manifest size');
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),x=>x.toString(16).padStart(2,'0')).join('');
  if(digest!==CHOICE_SHA) throw fail('choice-integrity','Wrong or partial choice manifest');
  return immutable(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b)));
}

/**
 * Private offline lifecycle. Explicit clocks, input, progression and an offline
 * completion receipt. No timers, persistence, score upload, rewards, or fetch.
 * WorkerClass is only for a host running this same trusted local transport.
 */
export async function openMultistageGameSession({activityCatalogBytes,choiceCatalogBytes,WorkerClass,preferredSpeed=1}={}){
  if(![1,2].includes(preferredSpeed)) throw fail('speed','Only original 1× and 2×');
  const [flow,choiceData]=await Promise.all([openActivityFlow(activityCatalogBytes),pinnedChoice(choiceCatalogBytes)]);
  let enabledEndless=false,lastEndlessPacket=null;
  let phase='lobby',busy=false,dead=false,revision=0,generation=0;
  let activity=null,localHighScore=0,adaptedView=null;
  let client=null,hud=null,runId=null,requestId=0,battle=null,settlement=null,result=null,clickReply=null,events=[];
  let clockFrames=0,activeStage=null,sharedClient=null,workerGates=null;
  const scope=()=>Object.freeze({mode:'private-offline',lane:'qualified-rules',stageId:activeStage,
    endlessEnabled:enabledEndless,availableStages:Object.values(PROFILES).map(x=>x.stageId).filter(id=>id!==78000021||enabledEndless),originalLiveParity:false,
    renderer:false,staticSourceReference:Boolean(STAGE_ART[activeStage]),officialService:false});
  function state(){
    const modal=phase==='paused'?pauseDialog:phase==='exit-confirm'?exitDialog:null;
    const lobby=activity?flow.main({...activity,miniHighScore:score()}):null;
    return immutable({protocol:SESSION_PROTOCOL,phase,pendingCommand:busy,revision,scope:scope(),workerGates,
      activityId:activity?.activityId??null,externalHighScore:activity?.miniHighScore??null,localHighScore,lobby,
      chooser:adaptedView,battle,modal,settlement,result,events,
      preferredSpeed,runId,fixedFramesAdvanced:clockFrames});
  }
  function expect(...phases){
    if(!phases.includes(phase)) throw fail('phase','Action unavailable in '+phase);
  }
  async function perform(fn){
    if(dead) throw fail('closed','Closed local session');
    if(busy) throw fail('busy','Await pending local command');
    busy=true;
    const token=generation;
    try{
      await fn(token);
      if(token!==generation) throw fail('closed','Local session disposed during command');
    } finally{busy=false;revision++;}
    return state();
  }
  function score(){return Math.max(localHighScore,activity?.miniHighScore??0);}
  function useSnapshot(input){
    const {activityId,startStamp,timezoneOffset,serverStamp,miniHighScore,miniDailyStat,miniDailyNum,taskList,formattedStartHour}=input??{};
    if(!int(activityId,1,2147483647)||!int(startStamp,0,8_640_000_000)||!int(serverStamp,0,8_640_000_000)
       ||!int(timezoneOffset,-86400,86400)||
       (formattedStartHour!==undefined&&!int(formattedStartHour,0,23))||
       !int(miniHighScore,0,78000020)||(miniHighScore!==0&&miniHighScore<STAGE)||!Array.isArray(taskList))
      throw fail('snapshot','Explicit and valid external activity snapshot required');
    // Dry run before publishing anything; no implicit reward or day progression.
    const next=immutable({activityId,startStamp,timezoneOffset,serverStamp,miniHighScore,miniDailyStat,miniDailyNum,
      formattedStartHour,taskList:taskList.map(r=>({taskId:r?.taskId,state:r?.state,value:r?.value,uid:r?.uid}))});
    flow.main(next);
    const same=activity?.activityId===activityId;
    if(same&&next.serverStamp<activity.serverStamp) throw fail('stale-snapshot','External clock snapshot regressed');
    const nextScore=Math.max(same?localHighScore:0,miniHighScore);
    const nextView=phase==='chooser'?flow.chooser({...next,miniHighScore:nextScore},same&&adaptedView?.stages?adaptedView:undefined):null;
    activity=next;
    if(!same) localHighScore=0;
    adaptedView=nextView;
  }
  function disposeBinding({keepTransport=false}={}){
    if(hud) hud.close();
    if(!keepTransport&&sharedClient){sharedClient.dispose();sharedClient=null;}
    hud=null;client=null;clickReply=null;
  }
  async function closeBinding(){
    const handle=client;
    if(!handle) return;
    let acknowledged=false;
    try{
      const message=verifyProfileReply(await handle.closeStage(),activeStage,'closed');
      if(message.runId!==runId||!int(message.requestId,requestId+1,2147483647)) throw fail('worker-close','Worker did not close this exact stage run');
      acknowledged=true;
    }finally{disposeBinding({keepTransport:acknowledged});}
  }
  function verify(message,type,token){
    if(dead||generation!==token) throw fail('closed','Closed local session');
    if(message?.type!==type||message.protocol!==PROFILE_PROTOCOL||message.gates?.sourceState!=='integrity_verified'||
       typeof message.runId!=='string'||(runId&&message.runId!==runId)||!int(message.requestId,requestId+1,2147483647)||
       message?.state?.stageId!==activeStage||!int(message.advancedFixed,0,600)||
       message.state.fixedFrame!==clockFrames+message.advancedFixed||typeof message.state.paused!=='boolean'||
       !Array.isArray(message.events)) throw fail('worker-contract','Unverified scoped reply');
    return verifyProfileReply(message,activeStage,type);
  }
  function accept(message,type,token,sendToHud=true){
    verify(message,type,token);
    if(sendToHud) hud.accept(message);
    requestId=message.requestId;
    lastEndlessPacket=activeStage===78000021?message:null;
    battle=immutable(message.state);workerGates=immutable(message.gates);
    events=immutable(message.events);
    clockFrames+=message.advancedFixed;
  }
  function beginSettlement(cause){
    const terminal=battle.terminal;
    if(cause==='natural'&&!terminal || cause==='leave'&&(!battle.paused||terminal||battle.choice))
      throw fail('settlement-contract','Invalid terminal state for '+cause);
    const d=terminal??battle;
    const offer=activeStage===78000021&&cause==='natural'?projectEndlessSettlement(lastEndlessPacket,flow).offer:flow.beginSettlement({stageId:activeStage,isBattleWin:terminal?.win??false,isBattleLoss:terminal?.loss??false,
      wave:d.curMonsterWave,kills:d.killEnemyCount});
    settlement={cause,runId,offer};
    phase='settlement';
  }
  function syncPhase(){
    if(battle.terminal) beginSettlement('natural');
    else if(activeStage===78000021&&workerGates?.endlessQualification?.disposition==='live_horizon_held')phase='endless-horizon';
    else phase=battle.choice?'upgrade':'battle';
  }
  async function apply(method,value,token,notifyHud=true){
    try{
      const message=await (value===undefined?client[method]():client[method](value));
      accept(message,'state',token,notifyHud);
      return message;
    } catch(error){
      if(!dead){
        disposeBinding();phase='fault';settlement=null;
      }
      throw error;
    }
  }
  return Object.freeze({
    view:state,
    enableEndless:()=>perform(()=>{expect('lobby','chooser');enabledEndless=true;events=[];}),
    closeHorizon:()=>perform(async()=>{
      expect('endless-horizon');await closeBinding();
      adaptedView=flow.chooser({...activity,miniHighScore:score()});
      battle=null;activeStage=null;lastEndlessPacket=null;runId=null;requestId=0;workerGates=null;
      events=[];settlement=null;result=null;phase='chooser';
    }),
    pushSnapshot:args=>perform(()=>{expect('lobby','chooser');useSnapshot(args);}),
    openChooser:()=>perform(()=>{
      expect('lobby');
      if(!activity) throw fail('snapshot','Acquire an explicit local activity snapshot first');
      adaptedView=flow.chooser({...activity,miniHighScore:score()});phase='chooser';events=[];
    }),
    closeChooser:()=>perform(()=>{expect('chooser');adaptedView=null;phase='lobby';events=[];}),
    selectCard:index=>perform(()=>{expect('chooser');const r=flow.selectCard(adaptedView,index);adaptedView=r.view;events=[r.action];}),
    resetCard:()=>perform(()=>{expect('chooser');adaptedView=flow.resetCard(adaptedView);events=[];}),
    enterStage:(index,rng)=>perform(async token=>{
      expect('chooser');
      if(!adaptedView?.stages) throw fail('source-unavailable','Original chooser unavailable');
      const intent=flow.chooseStage(adaptedView,index);
      if(intent.kind!=='battle'){events=[intent];return;}
      if(intent.stageId===78000021&&!enabledEndless){events=[{kind:'endless-opt-in-required',stageId:78000021}];return;}
      if(!qualifiedStage(intent.stageId)){events=[{kind:'held-scope',stageId:intent.stageId}];return;}
      if(!Array.isArray(rng?.tape)||rng.tape.length!==50||rng.tape.some(x=>!int(x,1,10000))||
         !Array.isArray(rng?.globalRngSeeds)||rng.globalRngSeeds.length!==2||rng.globalRngSeeds.some(x=>!int(x,0,2147483647)))
        throw fail('rng','Explicit deterministic offline RNG inputs required');
      phase='loading';runId=null;requestId=0;clockFrames=0;events=[];activeStage=intent.stageId;workerGates=null;
      try{
        if(!sharedClient){
          sharedClient=makeMultistageRulesClient({WorkerClass});
          await sharedClient.describe();
        }
        client=sharedClient;
        const handle=client;
        const ready=verify(await handle.start({...rng,stageId:activeStage,...(activeStage===78000021?{endlessMode:ENDLESS_MODE}:{})}),'ready',token);
        if(ready.version!==VERSION||ready.gameId!==GAME||ready.fps!==30) throw fail('worker-build','Wrong private multistage build');
        runId=ready.runId;
        hud=createChoiceHud(choiceData,{runId,stageId:activeStage,client:{select:async req=>{
          const reply=await handle.select(req);
          verify(reply,'state',token);
          clickReply=reply;
          return reply;
        }}});
        accept(ready,'ready',token);
        if(battle.speedIndex!==preferredSpeed) await apply('speed',preferredSpeed,token);
        phase='battle-ready';
      }catch(error){
        if(!dead){disposeBinding();phase='fault';}
        throw error;
      }
    }),
    beginBattle:()=>perform(()=>{
      expect('battle-ready');
      // Host explicitly crosses the start animation hook. No fabricated duration.
      phase='battle';events=[];
    }),
    stepFixed:count=>perform(async token=>{
      expect('battle','upgrade','paused','exit-confirm');
      if(!int(count,1,600)) throw fail('fixed-count','1 to 600 fixed frames');
      const previous=phase;
      await apply('stepFixed',count,token);
      if(previous==='paused'||previous==='exit-confirm'){
        if(!battle.paused) throw fail('worker-contract','Modal must still hold the Worker');
      } else syncPhase();
    }),
    advanceUnscaled:ms=>perform(async token=>{
      expect('battle','upgrade','paused','exit-confirm');
      if(!int(ms,0,60000)) throw fail('unscaled-clock','0 to 60,000 unscaled ms');
      const previous=phase;
      await apply('advanceUnscaled',ms,token);
      if(previous==='paused'||previous==='exit-confirm'){
        if(!battle.paused) throw fail('worker-contract','Modal must still hold the Worker');
      } else syncPhase();
    }),
    choiceFrame:presentation=>phase==='upgrade'?immutable(hud.frame(presentation)):null,
    chooseAt:(x,y,presentation)=>perform(async token=>{
      expect('upgrade');
      if(!Number.isFinite(x)||!Number.isFinite(y)) throw fail('coordinate','Finite original 1334×750 canvas coordinates required');
      clickReply=null;
      try{
        const hit=await hud.dispatch(x,y,presentation);
        if(hit&&clickReply){
          // The HUD already accepted this exact packet; another hud.accept would be stale.
          accept(clickReply,'state',token,false);
          syncPhase();
        }else events=[];
      }catch(error){
        if(!dead){disposeBinding();phase='fault';settlement=null;}
        throw error;
      }finally{clickReply=null;}
    }),
    pause:()=>perform(async token=>{expect('battle');await apply('pause',undefined,token);phase='paused';}),
    resume:()=>perform(async token=>{expect('paused');await apply('resume',undefined,token);phase='battle';}),
    requestLeave:()=>perform(async token=>{expect('battle');await apply('pause',undefined,token);phase='exit-confirm';}),
    cancelLeave:()=>perform(async token=>{expect('exit-confirm');await apply('resume',undefined,token);phase='battle';}),
    confirmLeave:()=>perform(async ()=>{
      expect('exit-confirm');beginSettlement('leave');events=[];
      try{await closeBinding();}catch(error){if(!dead){phase='fault';settlement=null;}throw error;}
    }),
    toggleSpeed:()=>perform(async token=>{
      expect('battle');const next=battle.speedIndex===1?2:1;
      await apply('speed',next,token);preferredSpeed=next;
    }),
    finishSettlement:({runId:receiptRun,status}={})=>perform(async token=>{
      expect('settlement');
      if(receiptRun!==runId) throw fail('stale-receipt','Receipt does not belong to current run');
      if(status!=='success'&&status!=='error') throw fail('receipt','Explicit offline result required');
      const finished=flow.finishSettlement(settlement.offer,status);
      try{await closeBinding();}catch(error){if(!dead){phase='fault';settlement=null;}throw error;}
      if(dead||token!==generation) throw fail('closed','Closed local session');
      if(status==='success' && settlement.cause==='natural' && settlement.offer.request.point===activeStage)
        localHighScore=Math.max(localHighScore,activeStage);
      result=immutable(finished);settlement=null;events=[];
      phase=status==='success'?'result':'settlement-error';
    }),
    returnToChooser:()=>perform(()=>{
      expect('result','settlement-error','fault');
      if(!activity) throw fail('snapshot','External activity snapshot missing');
      adaptedView=flow.chooser({...activity,miniHighScore:score()});battle=null;result=null;settlement=null;runId=null;requestId=0;activeStage=null;workerGates=null;events=[];
      phase='chooser';
    }),
    dispose(){
      if(!dead){dead=true;generation++;disposeBinding();phase='closed';battle=null;runId=null;result=null;settlement=null;activeStage=null;workerGates=null;events=[];revision++;}
    },
  });
}

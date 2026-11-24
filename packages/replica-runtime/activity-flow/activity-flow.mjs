/** Offline browser rules for the Activity17 魔物抵御战 menus. No I/O or game service. */
export const ACTIVITY_FLOW_VERSION = '134377281279792758';
export const ACTIVITY_CATALOG_SHA256 = 'f9f105c5f43dc829eb968ddd5abaaaf2acb6f0ea138f671a2211ed4d19823669';
export const ACTIVITY_FLOW_PROTOCOL = 'starfall-activity17-defense-flow/1';
const EPOCH_DAY = 86400;
const GAME = 70441022;
const STAGE = 78000000;
const FINITE = 20;
const CHOOSER = 'Activity17MiniGameChoice2Window';
const TASKS = 'Activity17MiniTask2Window';
const CARD = 'Activity17MiniGameChoice2_InfoSkillWindow';
const END = 'MiniGameBattleEndWindow';
const fail = (reason) => { throw new TypeError(reason); };
const ints = (...xs) => xs.every(Number.isSafeInteger);
const win = (window) => ({kind:'open',window});
const copy = (x) => JSON.parse(JSON.stringify(x));
const immutable = (x) => {
  if (x && typeof x === 'object') {
    for (const v of Object.values(x)) immutable(v);
    Object.freeze(x);
  }
  return x;
};

/** Load the emitted catalog bytes, not a loosely matching version or truncated payload. */
export async function openActivityFlow(bytes) {
  if (!(bytes instanceof ArrayBuffer) && !(bytes instanceof Uint8Array)) fail('Catalog bytes required');
  const data=new Uint8Array(bytes instanceof ArrayBuffer ? bytes.slice(0) : bytes);
  if (data.length>32_768 || data.length===0 || !globalThis.crypto?.subtle) fail('Invalid catalog bytes or unavailable hash verifier');
  const digest=await globalThis.crypto.subtle.digest('SHA-256',data);
  const hex=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
  if (hex!==ACTIVITY_CATALOG_SHA256) fail('Activity catalog SHA-256 mismatch');
  return createActivityFlow(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data)));
}

/** Deterministic projection, accepting a caller-owned, separately verified source catalog. */
export function createActivityFlow(raw) {
  // Refuse incomplete or cross-version tables. See verification manifest for pin.
  const cfg = immutable(copy(raw));
  if (cfg.version !== ACTIVITY_FLOW_VERSION ||
      cfg.gameId !== GAME || cfg.activityConfigId !== 70440017 || cfg.gameType !== 22 ||
      cfg.stages?.length !== 21 || cfg.cards?.length !== 5 || cfg.tasks?.length !== 12 ||
      Object.keys(cfg.text ?? {}).length !== 21 || cfg.dailyNum !== 2 ||
      !cfg.stages.every((s,j) => s.id === STAGE+j+1 && s.pre === (j ? STAGE+j : 0) &&
        s.next?.length === 1 && s.next[0] === (j < FINITE ? STAGE+j+2 : 0) &&
        s.unlockDay === Math.floor(j/2) && s.loop === (j === FINITE))) {
    fail('Wrong or incomplete activity source catalog');
  }
  const C = {NORMAL:0,FINISHED:1,REWARD:2,OVERDUE:3};
  if (Object.keys(C).some(k=>cfg.taskStates?.[k]!==C[k])) fail('Mismatched task-state enum');
  const taskById=new Map(cfg.tasks.map(x=>[x.id,x]));
  const stageById=new Map(cfg.stages.map(x=>[x.id,x]));
  const fmt=(id,...args)=>{
    const pattern=cfg.text[id];
    if (typeof pattern !== 'string') fail('Missing client localization ' + id);
    let i=0;
    const result=pattern.replace(/%[sd%]/g,m=>m==='%%'?'%':String(args[i++]));
    if (i!==args.length || result.includes('undefined')) fail('Client localization arity mismatch '+id);
    return result;
  };
  const warn=(t)=>({kind:'warn',text:t});

  function chooser({startStamp,timezoneOffset,serverStamp,miniHighScore,formattedStartHour}, previous) {
    if (!ints(startStamp,timezoneOffset,serverStamp,miniHighScore) || startStamp<0 ||
        serverStamp<0 || Math.abs(timezoneOffset)>EPOCH_DAY ||
        (formattedStartHour!==undefined && (!ints(formattedStartHour) || formattedStartHour<0 || formattedStartHour>23)) ||
        (previous!==undefined && (previous?.stages?.length!==21 || previous?.head?.length!==5))) {
      fail('Invalid server clock or chooser snapshot');
    }
    // TimeUtil.FormatDate("%H", startStamp) with supplied server offset. The
    // original adjusts only hours; minute/second are carried into day gates.
    const offsetSeconds=startStamp+timezoneOffset;
    const hour=formattedStartHour??(Math.floor(offsetSeconds/3600)%24+24)%24;
    const firstStamp=startStamp-(hour-5)*3600;
    const next=cfg.stages.find(s=>s.pre===miniHighScore);
    if (!next || (miniHighScore===0 && serverStamp<firstStamp)) return {kind:'source-unavailable'};
    const currentUnlocked=serverStamp>=firstStamp+next.unlockDay*EPOCH_DAY?next:stageById.get(next.pre);
    const stages=cfg.stages.map((s,i)=>{
      const b={};
      if(i<FINITE) b.name=fmt(11917,i+1);
      // A recycled FGUI item keeps fields Lua does not write this refresh.
      const old=previous?.stages[i];
      for (const k of ['c1','time','touchable']) if(old && Object.hasOwn(old,k)) b[k]=old[k];
      if (s.id<=miniHighScore) return {...b,c2:1,c1:0,lock:0,result:warn(fmt(11927))};
      const time=firstStamp+s.unlockDay*EPOCH_DAY;
      const preComplete=miniHighScore>=s.pre;
      if (preComplete && serverStamp>=time) {
        return {...b,c2:0,lock:0,result:{kind:'battle',stageId:s.id}};
      }
      const days=Math.floor((time-serverStamp)/EPOCH_DAY)+1;
      if (preComplete) return {...b,c2:0,c1:1,lock:1,touchable:true,time:fmt(11925,days),result:warn(fmt(11925,days))};
      return {...b,c2:0,c1:0,lock:1,touchable:true,result:warn(fmt(11926))};
    });
    const head=cfg.cards.map((c,i)=>({
      lock:Number(!currentUnlocked.cards.includes(c.id)), selected:previous?.head[i].selected??0, url:c.head,
    }));
    const scroll=previous?.scroll ?? -190*(next.id%100-1);
    return {stages,head,scroll:Object.is(scroll,-0)?0:scroll,animated:false,cardStageId:currentUnlocked.id};
  }

  function selectCard(view,index) {
    if (view?.head?.length !== cfg.cards.length || !stageById.has(view.cardStageId) ||
        !Number.isInteger(index) || index<0 || index>=cfg.cards.length) fail('Invalid chooser card');
    const c=cfg.cards[index];
    return {view:{...view,head:view.head.map((h,j)=>({...h,selected:Number(index===j)}))},
      action:{...win(CARD),cardId:c.id,stageId:view.cardStageId},
      lockLabel:c.firstStage>view.cardStageId?fmt(11921,c.firstStage%100,c.name):fmt(11922,c.name)};
  }
  function resetCard(view) {
    if(view?.head?.length !== cfg.cards.length) fail('Invalid chooser state');
    return {...view,head:view.head.map(h=>({...h,selected:0}))};
  }
  function chooseStage(view,index) {
    if (view?.stages?.length !== cfg.stages.length || !Number.isInteger(index) || index<0 || index>=cfg.stages.length)
      fail('Invalid stage selection');
    return {...view.stages[index].result};
  }

  function main({miniHighScore,miniDailyStat,miniDailyNum,taskList}) {
    if (!ints(miniHighScore,miniDailyStat,miniDailyNum) || miniHighScore<0 || miniDailyStat<0 ||
        miniDailyNum<0 || !Array.isArray(taskList)) fail('Invalid activity service snapshot');
    const seen=new Set();
    for (const row of taskList) {
      if(!row || !ints(row.taskId,row.state,row.value) || row.value<0 || !taskById.has(row.taskId) ||
         !Object.values(C).includes(row.state) ||
         (!Number.isSafeInteger(row.uid) && !(typeof row.uid==='string'&&/^\d+$/.test(row.uid))) ||
         seen.has(row.taskId)) fail('Invalid task service row');
      seen.add(row.taskId);
    }
    const finished=miniDailyStat>=C.FINISHED;
    const rewarded=miniDailyStat>=C.REWARD;
    const dailyClaim=finished&&!rewarded;
    const sortRank=x=>x.state===C.FINISHED?x.state-2:x.state;
    const tasks=[...taskList].sort((a,b)=>sortRank(a)-sortRank(b)||a.taskId-b.taskId).map(row=>{
      const task=taskById.get(row.taskId);
      const labels={WordTxt:task.label};
      if (row.state!==C.OVERDUE) {
        labels.Word1Txt=fmt(row.state===C.NORMAL?1384:1382);
        labels.NumberTxt=fmt(723,Math.min(row.value,task.threshold),task.threshold);
      }
      const click=row.state===C.FINISHED?[{kind:'task-claim',uid:row.uid,onSuccess:{kind:'refresh'}}]:[];
      return {taskId:row.taskId,...(row.state===C.OVERDUE?{}:{controller:row.state}),
        labels,rewards:task.rewards,click};
    });
    return {score:miniHighScore%100,scoreLabel:fmt(1981),dailyState:finished?rewarded?2:1:0,
      dailyText:fmt(1982,Number(finished)),dailyReward:cfg.dailyReward,startLabel:fmt(11918),
      initEvents:[{kind:'red-dot',visible:dailyClaim},{kind:'red-dot',visible:taskList.some(t=>t.state===C.FINISHED)},{kind:'refresh'}],
      daily:dailyClaim?[{kind:'daily-claim'}]:[], start:[win(CHOOSER)],task:[win(TASKS)],
      dailyCount:Math.min(miniDailyNum,cfg.dailyNum)+'/'+cfg.dailyNum,dailyCountLabel:fmt(20536),tasks};
  }

  function beginSettlement({stageId,isBattleWin,isBattleLoss,wave,kills}) {
    const stage=stageById.get(stageId);
    if (!stage || typeof isBattleWin!=='boolean'||typeof isBattleLoss!=='boolean'||
        !ints(wave,kills)||wave<0||kills<0) fail('Invalid battle result');
    const winFlag=!stage.loop&&isBattleWin;
    return immutable({request:{kind:'settle-request',point:winFlag?stageId:0},
      title:fmt(winFlag?11919:!stage.loop&&isBattleLoss?11920:11905),
      wave,kills,waveLabel:fmt(11906),killsLabel:fmt(11907),closeLabel:fmt(11908)});
  }
  function finishSettlement(pending,status) {
    if (pending?.request?.kind!=='settle-request' || !['success','error'].includes(status))
      fail('Invalid settlement receipt');
    if (status==='error') return {kind:'error',text:fmt(10320),confirm:{kind:'close-battle'}};
    return {kind:'result',title:pending.title,wave:pending.wave,kills:pending.kills,
      waveLabel:pending.waveLabel,killsLabel:pending.killsLabel,closeLabel:pending.closeLabel,
      open:win(END),onOpen:{kind:'close-battle'},close:{kind:'close',window:END}};
  }
  return Object.freeze({catalog:cfg,chooser,selectCard,resetCard,chooseStage,main,beginSettlement,finishSettlement});
}

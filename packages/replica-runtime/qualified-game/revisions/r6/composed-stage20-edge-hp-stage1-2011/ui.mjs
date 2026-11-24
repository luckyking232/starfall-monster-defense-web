// Pinned opt-in derivative. Original default /1 and /2 files do not change.
import {openMultistageGameSession} from '../site/session.mjs';
import {loadStaticMaps} from '../site/static-maps.mjs';
import {loadScreenShell,SHA as SCREEN_SHA} from '../../../../screen-shell/screen.mjs';
import {createMultistageShell,canvasPoint} from '../site/shell.mjs';
import {fetchLocalBytes,makeChoicePainter,wipe} from '../../../../offline-shell/paint.mjs';

import {openWorldLayer} from './site-layer.mjs';
import {phaseCopy,exactFontHoldCopy} from '../composed-stage20-edge-fix/status-copy.mjs';
let world=null;
const CHOICE_SHA='bb83df2e9047aaa56053db3eec4392a23e99ddeeedc1a3e583259f40fd75bbe6';
const q=s=>document.querySelector(s), canvas=q('#game'), scroll=q('#scroll'), status=q('#status'),
  scope=q('#scope'), message=q('#message'), labels=q('#labels'), rng=q('#rng'), auto=q('#auto');
const lane=q('#lane');
const controls=[...document.querySelectorAll('button[data-action]')];
const snapshot={activityId:70060517,startStamp:1752365557,timezoneOffset:28800,serverStamp:1753365557,
  miniHighScore:0,miniDailyStat:0,miniDailyNum:0,taskList:[]};
const byPhase={
  lobby:['open-chooser','enable-endless'],chooser:['reset-card','enable-endless'],'endless-horizon':['close-horizon'], 'battle-ready':['start-fixed'],
  battle:['fixed','pause','speed','leave'],upgrade:['unscaled'],paused:['continue'],
  'exit-confirm':['cancel-leave','confirm-leave'],settlement:['ack'],
  'settlement-error':['recover'],fault:['recover'],
};
const title={
  'endless-horizon':'到达第 12000 固定帧：仅为核验边界，原战斗尚未结束',
  lobby:'本机夹具已加载',chooser:'原版选关 · 固定画幅',
  loading:'校验战斗源资源', 'battle-ready':'等待开战钩子',battle:'原版 Lua 规则 · 战场画面未渲染',
  upgrade:'原版升级选择 · 不替换未找到的字体',paused:'暂停', 'exit-confirm':'退出确认',
  settlement:'等待本地结算确认',result:'原版结算画布', 'settlement-error':'离线结算未成功',fault:'源验证停止',closed:'会话结束',
};
let shell,scene,choice,nativeFont,fontFailure='',dead=false,pending=false,raf,renderKey='',inputs,currentLane='qualified-rules',staticMap=null;
function render(){
  if(!shell||dead)return;
  const f=shell.frame(), s=f.state;
  const worldVisible=world?.update(f)??false;
  const key=[s.revision,f.plane,f.model?.scroll?.position??'',worldVisible].join('/');
  if(renderKey!==key){
    renderKey=key;
    if(f.plane==='chooser')scene.chooser(s.chooser,{nativeScrollX:f.model.scroll.position});
    else if(f.plane==='outcome')scene.outcome(s.result);
    else if(f.plane==='choice')choice.paint(f.model);
    else if(f.plane==='map-static'&&!worldVisible&&![78000001,78000002,78000003,78000004,78000005,78000006].includes(f.model.stageId))staticMap.paint(f.model.stageId);
    else wipe(canvas);
    scope.textContent=f.renderScope==='endless_horizon'?'当前仍存活。超出已核验范围，未触发游戏结算；可返回选关。':f.renderScope==='headless_rules_only'?(worldVisible?'诊断预览；本关可用图层见下方说明，无原生粒子或声音。':'只有原规则；身体诊断未显示，不替画。'):f.plane==='map-static'&&!worldVisible&&[78000001,78000002,78000003,78000004,78000005,78000006].includes(f.model.stageId)?'本关专用动态画面未就绪；不替画。':worldVisible?'第 '+(s.scope.stageId%100)+' 关原素材动态重建（非实机、未验原材质与粒子音频）。':f.plane==='map-static'?'第 '+(f.model.stageId%100)+' 关原地图静态参照：动态人物、实际动画时序、粒子、实时材质参数和音频均未验收。':f.plane==='held'?(worldVisible?'原素材动态重建（非实机、无原版粒子音频）。':'诊断停留：不显示未经核验的动态战场、暂停或开战画面。'):
      f.plane==='choice'?'画布只显示已验真的弹窗图层；战场背景和原字形按缺项处理。':
      '画布使用原素材和稳定态坐标；缺原字体的文字不画到画布。';
    let preview=null;
    if(nativeFont&&['chooser','choice','outcome'].includes(f.plane)){
      try{
        preview=nativeFont.paint(f.model,f.plane);
        scope.textContent='原字形已加载 · 浏览器排版预览；未验证 Unity 字距、描边或动态帧。';
        if(preview.held.length)scope.textContent+=' '+exactFontHoldCopy(preview.held);
      }catch(error){fontFailure=String(error.message);nativeFont.close();nativeFont=null;}
    }
    if(!nativeFont&&fontFailure&&['chooser','choice','outcome'].includes(f.plane))
      scope.textContent='精确字型预览未通过，本画布仅保留原图；未使用替代字形。';
    const b=s.battle;
    status.textContent=[phaseCopy({phase:s.phase,worldVisible,hasNativeFont:!!nativeFont},title),b?('原规则帧 '+b.fixedFrame+' · 波数 '+b.curMonsterWave+' · 击杀 '+b.killEnemyCount):'',
      s.scope.stageId?'已验收原规则 · 当前第 '+(s.scope.stageId%100)+' 关；动画相位、粒子和音频未验收。':'已验收原规则 · 原版规则诊断。',
      b?.selfHp!==null&&b?.selfHp!==undefined?'防线 '+b.selfHp+'/'+b.selfMaxHp+' · '+b.speedIndex+'×':'',
      s.modal?s.modal.title+' · '+s.modal.description:'',
      s.result?.kind==='error'?s.result.text:''].filter(Boolean).join('\n');
    labels.textContent='';
    if(preview&&preview.held.length)
      labels.textContent='未绘文字（仅旁注）：'+preview.held.map(t=>t.text).join(' / ');
    else if(!preview&&f.plane==='choice')
      labels.textContent='原始文案（仅旁注）：'+f.model.labels.map(t=>t.text).join(' / ');
    else if(!preview&&f.plane==='outcome')labels.textContent='原始文案（仅旁注）：'+[s.result.title,s.result.waveLabel+' '+s.result.wave,s.result.killsLabel+' '+s.result.kills].join(' / ');
    else if(s.events.some(e=>e.kind==='warn')) labels.textContent=s.events.find(e=>e.kind==='warn').text;
    else if(s.events.some(e=>e.kind==='endless-opt-in-required')) labels.textContent='第 21 关默认关闭；可开启本机无尽验证，不增加进度。';
    else if(s.events.some(e=>e.kind==='held-scope')) labels.textContent='这一关尚未通过规则验收；不会加载替代关卡。';
    else if(s.events.some(e=>e.kind==='open'&&e.cardId)) labels.textContent='原版角色说明入口已核对；说明页画面未合成。';
    q('#map-position').hidden=f.plane!=='chooser';
    if(f.plane==='chooser')scroll.value=f.model.scroll.position;
    q('#rule-lane').hidden=true;
    q('#source-mode').hidden=!['lobby','chooser'].includes(s.phase);
    q('#run-clock').hidden=!['battle','upgrade'].includes(s.phase);
    for(const b of controls)b.hidden=!(byPhase[s.phase]??[]).includes(b.dataset.action)||(b.dataset.action==='enable-endless'&&s.scope.endlessEnabled);
  }
  for(const b of controls)b.disabled=pending;
  lane.disabled=pending;
}
async function operate(action){
  if(!shell||pending||dead)return;
  pending=true;render();message.textContent='';
  try{const out=action();render();await out;}
  catch(error){message.textContent='本机验证停止：'+(error.code??'检查输入')+' · '+String(error.message).slice(0,350);}
  finally{pending=false;render();}
}
function loop(at){
  if(dead)return;
  if(auto.checked&&shell&&!pending&&['battle','upgrade'].includes(shell.frame().state.phase)){
    // Coalesce host frames while a read is active, never create a backlog.
    void operate(()=>shell.tick(at,{hidden:document.hidden}));
  }
  world?.tick();
  raf=requestAnimationFrame(loop);
}
const point=e=>{const p=canvasPoint(e.clientX,e.clientY,canvas.getBoundingClientRect());return [p.x,p.y];};
canvas.addEventListener('pointerup',e=>{
  if(e.button!==0||!e.isPrimary)return;
  void operate(()=>shell.pointer(...point(e)));
});
canvas.addEventListener('pointermove',e=>{
  canvas.classList.toggle('actionable',Boolean(shell&&!pending&&shell.hover(...point(e))));
});
canvas.addEventListener('pointerleave',()=>canvas.classList.remove('actionable'));
scroll.addEventListener('input',()=>{if(shell&&!pending){shell.setScroll(Number(scroll.value));render();}});
auto.addEventListener('change',()=>shell?.resetClock());
document.addEventListener('visibilitychange',()=>shell?.resetClock());
async function buildLane(name){
  if(name!=='qualified-rules')throw Error('未显式开放的规则路径');
  const session=await openMultistageGameSession({activityCatalogBytes:inputs.activityCatalogBytes,choiceCatalogBytes:inputs.choiceCatalogBytes,WorkerClass:world?.WorkerClass});
  const candidate=createMultistageShell({session,screenManifest:inputs.screenManifest,
    makeRng:stageId=>({tape:Array(50).fill(Number(rng.value)),globalRngSeeds:[70441022,stageId]})});
  try{
    if(dead)throw Error('页面已经关闭');
    await candidate.command('snapshot',snapshot);
    if(dead)throw Error('页面已经关闭');
    shell?.dispose();shell=candidate;currentLane=name;renderKey='';
  }catch(error){candidate.dispose();throw error;}
}
lane.addEventListener('change',()=>void operate(async()=>{
  const wanted=lane.value;
  if(wanted===currentLane)return;
  try{await buildLane(wanted);}catch(error){lane.value=currentLane;throw error;}
}));
for(const b of controls)b.addEventListener('click',()=>{
  const action=b.dataset.action, raw=b.dataset.value;
  void operate(()=>shell.command(action,raw===undefined?undefined:action==='ack'?raw:Number(raw)));
});
addEventListener('pagehide',()=>{dead=true;if(raf!==undefined)cancelAnimationFrame(raf);shell?.dispose();scene?.close();choice?.close();nativeFont?.close();staticMap?.close();world?.close();},{once:true});

try{
  const [activityCatalogBytes,choiceCatalogBytes,screenBytes,laneBytes]=await Promise.all([
    fetchLocalBytes('/activity-flow/activity-catalog.json'),
    fetchLocalBytes('/hud-choice/choice-data.json',CHOICE_SHA),
    fetchLocalBytes('/screen-shell/shell-data.json',SCREEN_SHA),
    fetchLocalBytes('/qualified-game/revisions/r6/site/lane-config.json'),
  ]);
  if(dead)throw Error('Page closed while loading');
  scene=await loadScreenShell(canvas);
  if(dead)throw Error('Page closed while loading');
  choice=await makeChoicePainter(canvas,JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(choiceCatalogBytes)));
  if(dead)throw Error('Page closed while loading');
  const parse=x=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(x));
  const config=parse(laneBytes);
  if(config.schema!=='starfall.multistage.diagnostic-lane/1'||config.defaultLane!=='qualified-rules'||
     config.nativeFontEnabled!==undefined&&config.nativeFontEnabled!==true)
    throw Error('未知多关卡规则路径配置');
  staticMap=await loadStaticMaps(canvas);
  if(dead){staticMap.close();throw Error('页面已经关闭');}
  if(config.nativeFontEnabled===true){
    try{
      const {loadNativeLabelOverlay}=await import('../../../../native-font-shell/native-labels.mjs');
      if(dead)throw Error('页面已经关闭');
      nativeFont=await loadNativeLabelOverlay(canvas);
      if(dead){nativeFont.close();throw Error('页面已经关闭');}
    }catch(error){fontFailure=String(error.message);}
  }
  world=openWorldLayer(q('#canonical-world'),q('#world-preview-status'),()=>queueMicrotask(render));
  inputs={activityCatalogBytes,choiceCatalogBytes,screenManifest:parse(screenBytes)};
  await buildLane('qualified-rules');q('#tools').hidden=false;
  render();raf=requestAnimationFrame(loop);
}catch(error){shell?.dispose();scene?.close();choice?.close();nativeFont?.close();staticMap?.close();world?.close();if(!dead)message.textContent='未通过本机素材验收：'+error.message;}

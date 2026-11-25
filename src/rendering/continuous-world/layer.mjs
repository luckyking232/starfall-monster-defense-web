import {P as __p} from "../../../../portable.mjs";
const {URL,fetch,location,Worker}=__p;
import {openCanonicalObserver as fx10,EXPLICIT_LANE as FX10} from '../stage10-fx-only-summons/observer.mjs';
import {openCanonicalObserver as fx9,EXPLICIT_LANE as FX9} from '../stage9-fx-only-summons/observer.mjs';
import {openCanonicalObserver as openFrost78,EXPLICIT_LANE as FROST78} from '../stage78-frost-source-witness/observer.mjs';
import {openCanonicalObserver as openRecoverable910,EXPLICIT_LANE as R910} from '../temporary-20108-die/observer.mjs';
import {openCanonicalObserver as openEarlyFx,EXPLICIT_LANE as EARLY_FX} from '../early-fx-only-summons/observer.mjs';
import {openCanonicalObserver as openStage2Slow,EXPLICIT_LANE as STAGE2_SLOW} from '../stage2-2011-source-witness/observer.mjs';
import {createStage11to20CpuRenderer} from '../../../../stage11to20-cpu-canvas/stage11to20-cpu.mjs';
import {createStage910CpuRenderer} from '../../../../stage910-cpu-canvas/stage910-cpu.mjs';
import {createStage78CpuRenderer} from '../../../../stage78-cpu-canvas/stage78-cpu.mjs';
import {chooseMap3Cpu,permitMap3Cpu,MAP3_CPU_LANE,map3Stage} from '../cloud-stage1to20-cpu/group-admission.mjs';
import {createStage3CpuRenderer} from '../../../../stage3-cpu-canvas/stage3-cpu.mjs';
import {createStage456GenericCpuRenderer} from '../../../../stage456-generic-cpu/stage456-cpu.mjs';
import {openCanvasFront} from '../../../../src/rendering/continuous-world/frame-front.mjs';
import {captureGpuStage} from '../../../../src/rendering/continuous-world/gpu-stage.mjs';
import {captureStagePixels} from '../../../../src/rendering/continuous-world/stage-pixels.mjs';
import {createStage2CpuRenderer} from '../../../../stage2-cpu-canvas/stage2-cpu.mjs';
import {selectStage2,permitStage2,STAGE2_CPU_LANE} from '../cloud-stage12-canvas2d/stage2-admission.mjs';
import {createStage1CpuRenderer as openCpuRenderer} from '../../../../stage1-cpu-canvas/stage1-cpu.mjs';
import {routeStage1Renderer,permitCpuFrame,STAGE1_CANVAS_LANE} from '../cloud-stage1-canvas2d/admission.mjs';
/** One canonical authority with stage-exact visual admission. */
import {attachPublishedWorker} from '../cloud-stage12-no-flash/attachment.mjs';
import {SCENES} from '../composed-stage20-full-early-hud/scene-profiles.mjs';
import {EXPLICIT_LANE,openCanonicalObserver} from '../composed-stage78-body/stock-observer.mjs';
import {openCanonicalObserver as openHudObserver} from '../stage1-2011-companion-probe/observer.mjs';
import {createStageRenderer} from '../../../../stage-renderer/native-stage.mjs';
import {createStockStage2Renderer,LANE as STOCK_LANE} from '../../../../stage2-qualification/materials/live/renderer.mjs';
import {fetchLocalBytes} from '../../../../offline-shell/paint.mjs';
import {openStage1HudLayer} from '../stage1-hp-autosize/stage1-live-layer.mjs';
import {createStockStage78Renderer,LANE as BODY_LANE} from '../composed-stage78-body/stock-stage78.mjs';
import {openCanonicalObserver as openSlowBody,EXPLICIT_LANE as SLOW_LANE} from '../composed-stage78-body/slow-stock-observer.mjs';
import {openCanonicalObserver as open910,EXPLICIT_LANE as OBS910} from '../stage910-body-probe/stock-observer.mjs';
import {createStockStage910Renderer,LANE as BODY910} from '../stage910-body-probe/stock-stage910.mjs';
import {createStockStage910Renderer as renderFour,LANE as renderFourLane} from '../later-body-probe/stock-later.mjs';
import {createStockStage910Renderer as renderSix,LANE as renderSixLane} from '../later-body-six/stock-later.mjs';
import {openCanonicalObserver as observeFour,EXPLICIT_LANE as observeFourLane} from '../later-body-probe/stock-observer.mjs';
import {openCanonicalObserver as observeSix,EXPLICIT_LANE as observeSixLane} from '../later-body-six/stock-observer.mjs';
import {openStage78PartialHud} from '../composed-stage20-edge-hp/live-78.mjs';
import {openStage9to20PartialHud} from '../composed-stage20-edge-hp/live-finite.mjs';
import {openStage2to6PartialHud} from '../composed-stage20-edge-hp/live-early.mjs';
const stageEarlyHud=id=>Number.isSafeInteger(id)&&id>=78000002&&id<=78000006;
const stageFiniteHud=id=>Number.isSafeInteger(id)&&id>=78000009&&id<=78000020;
const stage78=id=>id===78000007||id===78000008;
const withScopedHud=id=>stageEarlyHud(id)||stage78(id)||stageFiniteHud(id);
const inFour=id=>[78000013, 78000015, 78000018, 78000020].includes(id);
const inSix=id=>[78000011, 78000012, 78000014, 78000016, 78000017, 78000019].includes(id);
const worldLater=id=>inFour(id)||inSix(id);
const bodyLater=Object.freeze({mode:'stock-body-prefix-no-native-effects',nativeUnity:false,choiceLayers:'original-chooser-only'});
const world910=id=>id===78000009||id===78000010;
const stockCpuStage=id=>map3Stage(id)&&id>=78000007;
const S1=78000001,S2=78000002;
const hasWorld=id=>Number.isSafeInteger(id)&&Object.hasOwn(SCENES,id);
export const ASSEMBLED_PROFILE='starfall-private-assembled-presentation/1';
export const CAPABILITIES=Object.freeze({
 ...Object.fromEntries([78000011, 78000012, 78000013, 78000014, 78000015, 78000016, 78000017, 78000018, 78000019, 78000020].map(id=>[id,bodyLater])),
 [78000010]:Object.freeze({mode:'stock-body-prefix-empty-die-held',nativeUnity:false,choiceLayers:'original-chooser-only'}),
 [78000009]:Object.freeze({mode:'stock-body-prefix-empty-die-held',nativeUnity:false,choiceLayers:'original-chooser-only'}),
 [78000008]:Object.freeze({mode:'stock-body-source-diagnostic-no-particles',nativeUnity:false,choiceLayers:'original-chooser-only'}),
 [78000007]:Object.freeze({mode:'stock-body-source-diagnostic-no-particles',nativeUnity:false,choiceLayers:'original-chooser-only'}),
 [S1]:Object.freeze({mode:'authored-stage1-sprite-clock-hud-packed-blur',nativeUnity:false,choiceLayers:'captured-previous-layer-if-qualified'}),
 [S2]:Object.freeze({mode:'map2-and-78000202-original-gles100-stock',nativeUnity:false,choiceLayers:'original-chooser-only'}),
 [78000003]:Object.freeze({mode:'generic-pinned-source-art-no-particles',nativeUnity:false,choiceLayers:'original-chooser-only'}),
 [78000004]:Object.freeze({mode:'generic-pinned-source-art-no-particles',nativeUnity:false,choiceLayers:'original-chooser-only'}),
 [78000005]:Object.freeze({mode:'generic-pinned-source-art-no-particles',nativeUnity:false,choiceLayers:'original-chooser-only'}),
 [78000006]:Object.freeze({mode:'generic-pinned-source-art-no-particles',nativeUnity:false,choiceLayers:'original-chooser-only'}),
});
const DEST_PROOF='b131491a7cdd91c6786a8e277336cfd424b63d6a9bbf935c40ba1249a097cb9b';
export async function createAssembledStageRenderer(canvas,stageId,{generic=createStageRenderer,stock=createStockStage2Renderer,body=createStockStage78Renderer,body910=createStockStage910Renderer}={}){
 const scene=SCENES[stageId];
 if(!scene||!hasWorld(stageId))throw Object.assign(Error('No dynamic presentation execution for this stage'),{code:'assembled-static-held'});
 const {input,nativeIndexSha256}=scene;
 if(stageId===S2){
   // Never fall back to generic world if the Stage2 stock shader fails.
   return stock(canvas,input,{indexSha256:nativeIndexSha256,lane:STOCK_LANE,readback:true});
 }
 if(inFour(stageId))return renderFour(canvas,input,{stageId,indexSha256:nativeIndexSha256,lane:renderFourLane,readback:true});
 if(inSix(stageId))return renderSix(canvas,input,{stageId,indexSha256:nativeIndexSha256,lane:renderSixLane,readback:true});
 if(world910(stageId))return body910(canvas,input,{stageId,indexSha256:nativeIndexSha256,lane:BODY910,readback:true});
 if(scene.bodyOnlyDiagnostic)return body(canvas,input,{stageId,indexSha256:nativeIndexSha256,lane:BODY_LANE,readback:true});
 return generic(canvas,input,{indexSha256:nativeIndexSha256,readback:true});
}
export function createAssembledObserver(stageId,opts){
 if(stageId===S1)return openHudObserver({...opts,stageId,lane:EXPLICIT_LANE});
 if(inFour(stageId))return observeFour({...opts,stageId,lane:observeFourLane,onCommit:undefined});
 if(inSix(stageId))return observeSix({...opts,stageId,lane:observeSixLane,onCommit:undefined});
 if(world910(stageId))return open910({...opts,stageId,lane:OBS910,onCommit:undefined});
 if(SCENES[stageId]?.bodyOnlyDiagnostic)return openSlowBody({...opts,stageId,lane:SLOW_LANE,onCommit:undefined});
 if(hasWorld(stageId))return openCanonicalObserver({...opts,stageId,lane:EXPLICIT_LANE,onCommit:undefined});
 throw Object.assign(Error('No dynamic observer for this stage'),{code:'assembled-static-held'});
}
export function exactWorldVisible(active,p,stageId,b,phases){
 return Boolean(!p.error&&p.state&&p.frame&&active&&p.frame.stageId===stageId&&p.state.fixedFrame===b?.fixedFrame&&p.state.paused===b?.paused&&p.state.speedIndex===b?.speedIndex&&phases);
}
export function slowWithheldFor({stageId,visible,frame,receipt}){
 return Boolean(stageId===S1&&visible&&frame?.stageId===S1&&typeof frame.runId==='string'&&
  Number.isSafeInteger(frame.requestId)&&receipt?.runId===frame.runId&&receipt.requestId===frame.requestId&&
  receipt.effectStatus==='exact_2011_original_requests_not_drawn'&&receipt.rendered===false&&
  receipt.drawable===false&&Number.isSafeInteger(receipt.active)&&receipt.active>0);
}
export function stage2SlowWithheld({stageId,visible,frame,receipt,cpu}){
 return cpu===true&&stageId===S2&&visible===true&&frame?.stageId===S2&&receipt?.stageId===S2&&
   typeof frame.runId==='string'&&frame.runId===receipt.runId&&Number.isSafeInteger(frame.requestId)&&frame.requestId===receipt.requestId&&
   frame.display?.fixedFrame===receipt.sourceFixed&&frame.display?.displayFrame===receipt.sourceDisplay&&
   receipt.effectStatus==='exact_2011_original_requests_not_drawn'&&receipt.rendered===false&&receipt.drawable===false&&
   Number.isSafeInteger(receipt.active)&&receipt.active>0;
}
export function qualifyingOmissions({stageId,visible,frame,evidence,cpu}){
 return cpu===true&&visible===true&&[78000003,78000004,78000005,78000006,78000009,78000010].includes(stageId)&&
  frame!==null&&frame!==undefined&&frame.stageId===stageId&&evidence?.frame===frame&&
  evidence.authority?.stageId===stageId&&evidence.authority.runId===frame.runId&&evidence.authority.requestId===frame.requestId&&
  Array.isArray(evidence.omissions)&&evidence.omissions.length>0&&
  evidence.omissions.every(o=>o.cardId===([78000005,78000006].includes(stageId)?78000303:78000302))
   ?evidence.omissions.length:0;
}
export function qualifyingDeathHold({stageId,receipt,lineage,battle,cpu}){
 return cpu===true&&world910(stageId)&&receipt?.stageId===stageId&&lineage?.stageId===stageId&&
  receipt.runId===lineage.runId&&receipt.requestId===lineage.requestId&&receipt.fixed===battle?.fixedFrame&&
  receipt.rendered===false&&receipt.reason==='original_20108_state3_no_draw_until_actual_remove';
}
export function openWorldLayer(canvas,hint,refresh){
 const panel=canvas.parentElement,cpuCanvas=panel.querySelector('#stage1-cpu-world'),cpu2Canvas=panel.querySelector('#stage2-cpu-world'),map3Canvas=panel.querySelector('#map3-cpu-world'),stockCanvas=panel.querySelector('#stock78-cpu-world'),hudCanvas=panel.querySelector('#canonical-hud'),partialCanvas=panel.querySelector('#stage78-hud'),hudHint=document.querySelector('#hud-preview-status');
 let hud=null,diagnosis=null,opening=0,partial=null,slowReceipt=null,omittedFx=null,deathReceipt=null,frostReceipt=null,rendererLane=null,cpuVisible=false,stage2CpuVisible=false,stage2Attempt=false,map3Attempt=false,map3CpuVisible=false,front=null,syncing=false;
 const display=openCanvasFront(panel.querySelector('#presentation-front'),{onChange:refresh,invalidateStaging:()=>front?.invalidate()});
 let wake=null;
 function stopWake(){if(wake!==null){clearTimeout(wake);wake=null;}}
 function clearFront(){display.front.reset();syncing=false;stopWake();}
 const hook=attachPublishedWorker({BaseWorker:__p.Worker,isHidden:()=>document.hidden,onChange:refresh,
  async openFor(stageId){
   const turn=++opening;clearFront();slowReceipt=null;omittedFx=null;deathReceipt=null;frostReceipt=null;stage2Attempt=false;map3Attempt=false;let localHud=null,localDiagnosis=null,localPartial=null;
   const {input:indexURL,nativeIndexSha256}=SCENES[stageId];
   const b=await fetchLocalBytes(indexURL,nativeIndexSha256);
   const chosen=chooseMap3Cpu({stageId,webglCanvas:canvas,canvas:stockCpuStage(stageId)?stockCanvas:map3Canvas,enabled:true})??selectStage2({stageId,webglCanvas:canvas,cpuCanvas:cpu2Canvas,enabled:true})??
    routeStage1Renderer({stageId,webglCanvas:canvas,cpuCanvas});
   const cpu2=chosen.lane===STAGE2_CPU_LANE;
   if(turn===opening)stage2Attempt=cpu2;
   const cpu=chosen.lane===STAGE1_CANVAS_LANE;
   const map3=chosen.lane===MAP3_CPU_LANE;
   if(turn===opening)map3Attempt=map3;
   let capture=cpu||cpu2||map3?captureStagePixels(chosen.canvas,{alpha:cpu2||(map3&&stockCpuStage(stageId))}):null;
   const r=map3?await (stage78(stageId)?createStage78CpuRenderer:world910(stageId)?createStage910CpuRenderer:worldLater(stageId)?createStage11to20CpuRenderer:stageId===78000003?createStage3CpuRenderer:createStage456GenericCpuRenderer)(capture.sink,indexURL,{indexSha256:nativeIndexSha256}):cpu2?await createStage2CpuRenderer(capture.sink,indexURL,{indexSha256:nativeIndexSha256}):cpu?await openCpuRenderer(capture.sink,indexURL,{indexSha256:nativeIndexSha256}):await createAssembledStageRenderer(canvas,stageId);
   try{
    if(!capture)capture=captureGpuStage(canvas,r,{onChange:refresh});
    const presenter=capture.renderer??r;
    const isHud=stageId===S1;
    if(isHud&&!cpu){
      try{localHud=await openStage1HudLayer({worldCanvas:canvas,hudCanvas,frameProof:DEST_PROOF});}
      catch(e){localDiagnosis='原战斗 HUD 未通过：'+String(e.message).slice(0,180);}
    }
    if(withScopedHud(stageId)&&!cpu2&&!map3){
      const open=stageEarlyHud(stageId)?openStage2to6PartialHud:stage78(stageId)?openStage78PartialHud:openStage9to20PartialHud;
      try{localPartial=await open({stageId,canvas:partialCanvas,nativeIndexBytes:b,renderer:presenter,isCurrent:()=>turn===opening});}
      catch(e){localDiagnosis='部分 HUD 未通过：'+String(e.message).slice(0,175);}
    }
    const earlyFx=map3&&stageId>=78000003&&stageId<=78000006;
    const buildObserver=cpu2?(_id, opts)=>openStage2Slow({...opts,stageId:S2,lane:STAGE2_SLOW}):
     map3&&world910(stageId)?(id,opts)=>(id===78000009?fx9:fx10)({...opts,stageId:id,lane:id===78000009?FX9:FX10,
      onDeathStatus:x=>{if(turn===opening)deathReceipt=x;},
      onOmissions:x=>{if(turn===opening)omittedFx=x;}}):
     map3&&stage78(stageId)?(id,opts)=>openFrost78({...opts,stageId:id,lane:FROST78,onFrostEvidence:x=>{if(turn===opening)frostReceipt=x;}}):
     earlyFx?(id,opts)=>openEarlyFx({...opts,stageId:id,lane:EARLY_FX,onOmissions:x=>{if(turn===opening)omittedFx=x;}}):createAssembledObserver;
    const normalObserver=localPartial?.observer??await buildObserver(stageId,{nativeIndexBytes:b,renderer:presenter,expectedOrigin:location.origin,onCommit:cpu2?undefined:x=>localHud?.commit(x),
      onFrostEvidence:stageId===S1?x=>{if(turn===opening)frostReceipt=x;}:undefined,
      onSlowEvidence:stageId===S1||cpu2?x=>{if(turn===opening)slowReceipt=x;}:undefined});
    const observer=capture.wrap(normalObserver);
    if(turn===opening){hud=localHud;partial=localPartial;diagnosis=localDiagnosis;rendererLane=chosen.lane;front=capture;}
    return {observer,close(){localHud?.close();localPartial?.observer.close();if(turn===opening){front=null;hud=null;partial=null;diagnosis=null;slowReceipt=null;omittedFx=null;deathReceipt=null;frostReceipt=null;rendererLane=null;}r.destroy();capture?.destroy();}};
   }catch(e){localHud?.close();localPartial?.observer.close();if(turn===opening){front=null;hud=null;partial=null;diagnosis=null;slowReceipt=null;omittedFx=null;deathReceipt=null;frostReceipt=null;rendererLane=null;}r.destroy();capture?.destroy();throw e;}
  }
 });
 return {WorkerClass:hook.WorkerClass,tick:hook.tick,presentationBusy:()=>hook.peek().working,presentationError:()=>hook.peek().error,close(){clearFront();display.close();hook.close();},syncing:()=>syncing,cpuVisible:()=>cpuVisible,stage2CpuVisible:()=>stage2CpuVisible,map3CpuVisible:()=>map3CpuVisible,update(f){
  const p=hook.peek(),s=f.state,b=s.battle,stageId=s.scope.stageId;
  const active=hasWorld(stageId),isHud=stageId===S1;
  const phases=['battle-ready','battle','paused','exit-confirm'].includes(s.phase)||(isHud&&s.phase==='upgrade'&&hud?.status.blur);
  const match=exactWorldVisible(active,p,stageId,b,phases);
  const cpu=stageId===S1&&rendererLane===STAGE1_CANVAS_LANE;
  const cpu2=stageId===S2&&rendererLane===STAGE2_CPU_LANE;
  const map3=map3Stage(stageId)&&rendererLane===MAP3_CPU_LANE;
  const awaitingRetirement=qualifyingDeathHold({stageId,receipt:deathReceipt,lineage:p.lineage,battle:b,cpu:map3});
  const owner={generation:opening,stageId,runId:s.runId};
  display.front.scope(owner,s.phase);
  let committed=false,failed=!!p.error||front?.available?.()===false;
  if(front&&display.alive()){
   const authority=p.lineage;
   const exact=authority?.runId===s.runId&&match&&p.frame?.runId===s.runId&&p.frame.requestId===authority.requestId;
   const admitted=!awaitingRetirement&&(cpu?permitCpuFrame({stageId,phase:s.phase,rendererLane,presentationMatched:exact,held:failed}):
    map3?permitMap3Cpu({stageId,phase:s.phase,rendererLane,presentationMatched:exact,held:failed}):cpu2?permitStage2({stageId,phase:s.phase,rendererLane,presentationMatched:exact,held:failed}):exact&&!failed);
   if(admitted&&!document.hidden)try{
    committed=display.front.submit(owner,s.phase,p.frame,front.read(p.frame));
   }catch{failed=true;}
  }
  const displayState=display.front.view(owner,s.phase,{exact:committed,error:failed,hidden:document.hidden});
  const painted=display.alive()&&['current','previous','stale','frozen','fault'].includes(displayState);
  syncing=displayState==='previous';
  if(syncing&&wake===null)wake=setTimeout(()=>{wake=null;refresh();},2250);
  if(!syncing)stopWake();
  cpuVisible=cpu&&painted;
  stage2CpuVisible=cpu2&&painted;
  map3CpuVisible=map3&&painted;
  const visible=painted;
  panel.dataset.retainedWorld=painted?'true':'false';
  panel.dataset.presentationState=displayState;
  panel.dataset.worldVisible=visible?'true':'false';
  hint.hidden=!active;hudHint.hidden=(!isHud&&!withScopedHud(stageId))||s.phase==='battle-ready';
  const withPartial=withScopedHud(stageId)&&partial?.presenter.update(p.frame,{visible:visible&&committed,phase:s.phase});
  if(withScopedHud(stageId))hudHint.textContent=diagnosis??partial?.presenter.error??(withPartial?
    '部分原 HUD 重建：真实同帧原技能栏与原空位，不绘制实时 DPS 填充；非原生画面。':
    '未显示部分 HUD；升级窗只画原选择，不使用假底图。');
  hint.textContent=p.error?.code==='preview-20108-empty-die'&&(worldLater(stageId)||world910(stageId))?'20108 原死亡片段没有可核验的可绘制帧；停止战场画面。原规则、选卡与结算照常，不替画。':p.error?'该关动态模块停止：'+String(p.error.message).slice(0,190)+'。原规则继续，未使用替代画面。':
   visible?((worldLater(stageId)||world910(stageId))?'只预览原 Map3 和已核验的单位身体。部分 HUD 仅在同一已验早期显示回调可用；F1 出场粒子、音频与原生特效不绘制。20108 死亡或未知资源停止战场及 HUD。':SCENES[stageId]?.bodyOnlyDiagnostic?'只预览已核验身体和原地图；F1 原出场粒子、减速特效与音频不绘制，部分 HUD 单独验收。':stageId===S2?'第 2 关 Map2 与 78000202 执行原 GLES100；其他单位为原素材重建，不是原生 Unity 画面。':
    '第 '+(stageId%100)+' 关原地图与角色重建；原生 Unity 时序、粒子与混音未通过。'):
   s.phase==='upgrade'&&active&&!isHud?'该关只绘制原选卡窗；尚不提供可验收的原 HUD 与模糊底图。':SCENES[stageId]?.bodyOnlyDiagnostic?'等待身体诊断帧；首个原出场粒子 F1 不绘制。':'等待已验收的显示帧。';
  if(map3&&!p.error){
   hint.textContent=map3CpuVisible&&stockCpuStage(stageId)?'显示原 Map3 和已核验原身体；列蒂西雅与已核验精英含原阴影。F1 出场、减速粒子、HUD、模糊及声音不绘制。':map3CpuVisible?'显示原 Map3 和已核验原单位身体。未执行原生材质、阴影、粒子、HUD 或音频。':'仅在同帧通过画面核验时显示；升级沿用原选卡层。';
   hudHint.textContent='兼容模式不绘战斗 HUD 或升级背景模糊。';
  }
  if(map3Stage(stageId)&&map3Attempt&&p.error?.code==='preview-partial-render-held'){
   const ids=[...new Set((p.error.actors??[]).map(x=>x.cardId))].filter(Number.isSafeInteger);
   hint.textContent='原单位 '+(ids.length?ids.join('、'):'尚未核验')+' 没有通过画面验收，已停止战场画面。规则及选卡继续，不替画。';
  }
  if(cpu2&&!p.error){
   hint.textContent=stage2CpuVisible?'第 2 关显示原 Map2、已核验单位及 78000202 原身体和倾斜阴影；不画原生粒子或声音。':'仅可显示同帧核验的战场；升级界面不配假底图。';
   hudHint.textContent='第 2 关兼容模式不绘战斗 HUD 和升级模糊。';
  }
  if(stageId===S2&&stage2Attempt&&p.error?.message.includes('Minigame022_slowmotion_buff.prefab')){
   hint.textContent='遇到此关未通过的原减速特效，已停止显示战场；战斗规则、选卡和结算照常。';
   hudHint.textContent='战场未替画；原 HUD、升级模糊和声音未启用。';
  }
  if(cpu&&!p.error){
   hint.textContent=cpuVisible?'第 1 关仅显示原地图与已核验的单位身体（Canvas2D 兼容）；不显示原生粒子、HUD 或声音。':'Canvas2D 兼容画面仅显示同帧的已核验战场；选卡不配假底图。';
   hudHint.textContent='此兼容模式不绘战斗 HUD 和升级模糊。';
  }
  if(slowWithheldFor({stageId,visible,frame:p.frame,receipt:slowReceipt}))
    hint.textContent+=' 当帧减速粒子未绘制；其余只显示已核验的图层。';
  if(stage2SlowWithheld({stageId,visible,frame:p.frame,receipt:slowReceipt,cpu:cpu2}))
    hint.textContent+=' 原减速状态已核对；粒子未绘制，战场继续显示。';
  const absent=qualifyingOmissions({stageId,visible,frame:p.frame,evidence:omittedFx,cpu:map3});
  if(absent)hint.textContent+=' 当前 '+absent+' 个原召唤体仅由粒子构成，未绘；召唤与伤害照常结算。';
  if(awaitingRetirement&&!p.error)
    hint.textContent='20108 原死亡动画无可核验画面，战场暂时隐藏。规则照常；原对象移除后才显示新画面。';
  const frozen=(cpuVisible&&stageId===S1||map3&&stage78(stageId)&&visible)&&p.frame&&frostReceipt?.frame===p.frame&&frostReceipt.stageId===stageId&&
    frostReceipt.runId===p.frame.runId&&frostReceipt.requestId===p.frame.requestId&&frostReceipt.fixed===b?.fixedFrame&&
    frostReceipt.evidence?.drawable===false&&frostReceipt.evidence.activeTargets.length;
  if(frozen)hint.textContent+=' 原冻结已核对；单位动作随原规则停走，冰冻粒子未绘制。';
  if(syncing)hint.textContent='画面同步中，保留本局最近一帧。';
  if(displayState==='stale')hint.textContent='暂未收到可呈现的新画面，仍显示本局最近一帧。';
  if(displayState==='fault')hint.textContent='动态画面中断，保留本局最近一帧。原规则不受影响；可暂停或返回选关。';
  if(displayState==='frozen')hint.textContent='背景保留本局最近一帧。';
  if(isHud&&!cpu)hudHint.textContent=diagnosis??(hud?.status.blur?'原七步模糊 · 同一旧战斗 HUD 和重建世界，不是 Unity 原捕获。':
      hud?.status.error?'原战斗 HUD 未通过：'+hud.status.error:
   hud?.status.blurError?(hud?.status.hud&&s.phase!=='upgrade'?'原 HUD 已显示；':'')+'背景模糊暂不可用：'+hud.status.blurError:
   hud?.status.hud?'原法术与 DPS HUD 重建；无原生 Unity 时序宣称。':'等待同帧 HUD。');
  return visible;
 }};
}

/** One canonical authority with stage-exact visual admission. */
import {attachPublishedWorker} from './canonical-attachment.mjs';
import {SCENES} from './scene-profiles.mjs';
import {EXPLICIT_LANE,openCanonicalObserver} from '../composed-stage78-body/stock-observer.mjs';
import {openCanonicalObserver as openHudObserver} from '../composed-stage78-body/hud-observer.mjs';
import {createStageRenderer} from '../../../../stage-renderer/native-stage.mjs';
import {createStockStage2Renderer,LANE as STOCK_LANE} from '../../../../stage2-qualification/materials/live/renderer.mjs';
import {fetchLocalBytes} from '../../../../offline-shell/paint.mjs';
import {openStage1HudLayer} from '../../../presentation-capability/scene-profiles/stage1-hud/live-layer.mjs';
import {createStockStage78Renderer,LANE as BODY_LANE} from '../composed-stage78-body/stock-stage78.mjs';
import {openCanonicalObserver as openSlowBody,EXPLICIT_LANE as SLOW_LANE} from '../composed-stage78-body/slow-stock-observer.mjs';
import {openCanonicalObserver as open910,EXPLICIT_LANE as OBS910} from '../stage910-body-probe/stock-observer.mjs';
import {createStockStage910Renderer,LANE as BODY910} from '../stage910-body-probe/stock-stage910.mjs';
import {createStockStage910Renderer as renderFour,LANE as renderFourLane} from '../later-body-probe/stock-later.mjs';
import {createStockStage910Renderer as renderSix,LANE as renderSixLane} from '../later-body-six/stock-later.mjs';
import {openCanonicalObserver as observeFour,EXPLICIT_LANE as observeFourLane} from '../later-body-probe/stock-observer.mjs';
import {openCanonicalObserver as observeSix,EXPLICIT_LANE as observeSixLane} from '../later-body-six/stock-observer.mjs';
import {openStage78PartialHud} from './live-layer.mjs';
const stage78=id=>id===78000007||id===78000008;
const inFour=id=>[78000013, 78000015, 78000018, 78000020].includes(id);
const inSix=id=>[78000011, 78000012, 78000014, 78000016, 78000017, 78000019].includes(id);
const worldLater=id=>inFour(id)||inSix(id);
const bodyLater=Object.freeze({mode:'stock-body-prefix-no-native-effects',nativeUnity:false,choiceLayers:'original-chooser-only'});
const world910=id=>id===78000009||id===78000010;
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
export function openWorldLayer(canvas,hint,refresh){
 const panel=canvas.parentElement,hudCanvas=panel.querySelector('#canonical-hud'),partialCanvas=panel.querySelector('#stage78-hud'),hudHint=document.querySelector('#hud-preview-status');
 let hud=null,diagnosis=null,opening=0,partial=null;
 const hook=attachPublishedWorker({BaseWorker:globalThis.Worker,isHidden:()=>document.hidden,onChange:refresh,
  async openFor(stageId){
   const turn=++opening;let localHud=null,localDiagnosis=null,localPartial=null;
   const {input:indexURL,nativeIndexSha256}=SCENES[stageId];
   const b=await fetchLocalBytes(indexURL,nativeIndexSha256);
   const r=await createAssembledStageRenderer(canvas,stageId);
   try{
    const isHud=stageId===S1;
    if(isHud){
      try{localHud=await openStage1HudLayer({worldCanvas:canvas,hudCanvas,frameProof:DEST_PROOF});}
      catch(e){localDiagnosis='原战斗 HUD 未通过：'+String(e.message).slice(0,180);}
    }
    if(stage78(stageId)){
      try{localPartial=await openStage78PartialHud({stageId,canvas:partialCanvas,nativeIndexBytes:b,renderer:r,isCurrent:()=>turn===opening});}
      catch(e){localDiagnosis='部分 HUD 未通过：'+String(e.message).slice(0,175);}
    }
    const observer=localPartial?.observer??await createAssembledObserver(stageId,{nativeIndexBytes:b,renderer:r,expectedOrigin:location.origin,onCommit:x=>localHud?.commit(x)});
    if(turn===opening){hud=localHud;partial=localPartial;diagnosis=localDiagnosis;}
    return {observer,close(){localHud?.close();localPartial?.observer.close();if(turn===opening){hud=null;partial=null;diagnosis=null;}r.destroy();}};
   }catch(e){localHud?.close();localPartial?.observer.close();if(turn===opening){hud=null;partial=null;diagnosis=null;}r.destroy();throw e;}
  }
 });
 return {WorkerClass:hook.WorkerClass,tick:hook.tick,close:hook.close,update(f){
  const p=hook.peek(),s=f.state,b=s.battle,stageId=s.scope.stageId;
  const active=hasWorld(stageId),isHud=stageId===S1;
  const phases=['battle-ready','battle','paused','exit-confirm'].includes(s.phase)||(isHud&&s.phase==='upgrade'&&hud?.status.hud);
  const visible=exactWorldVisible(active,p,stageId,b,phases);
  panel.dataset.worldVisible=visible?'true':'false';hint.hidden=!active;hudHint.hidden=(!isHud&&!stage78(stageId))||s.phase==='battle-ready';
  const withPartial=stage78(stageId)&&partial?.presenter.update(p.frame,{visible,phase:s.phase});
  if(stage78(stageId))hudHint.textContent=diagnosis??partial?.presenter.error??(withPartial?
    '部分原 HUD 重建：真实同帧五人技能栏，不绘制实时 DPS 填充；非原生画面。':
    '未显示部分 HUD；升级窗只画原选择，不使用假底图。');
  hint.textContent=p.error?.code==='preview-20108-empty-die'&&(worldLater(stageId)||world910(stageId))?'20108 原死亡片段没有可核验的可绘制帧；停止战场画面。原规则、选卡与结算照常，不替画。':p.error?'该关动态模块停止：'+String(p.error.message).slice(0,190)+'。原规则继续，未使用替代画面。':
   visible?((worldLater(stageId)||world910(stageId))?'只预览原 Map3 和已核验的单位身体。F1 出场粒子、原 HUD、音频与原生特效不绘制；20108 死亡或未知资源停止整个战场画面。':SCENES[stageId]?.bodyOnlyDiagnostic?'只预览已核验身体和原地图；F1 原出场粒子、减速特效与音频不绘制，部分 HUD 单独验收。':stageId===S2?'第 2 关 Map2 与 78000202 执行原 GLES100；其他单位为原素材重建，不是原生 Unity 画面。':
    '第 '+(stageId%100)+' 关原地图与角色重建；原生 Unity 时序、粒子与混音未通过。'):
   s.phase==='upgrade'&&active&&!isHud?'该关只绘制原选卡窗；尚不提供可验收的原 HUD 与模糊底图。':SCENES[stageId]?.bodyOnlyDiagnostic?'等待身体诊断帧；首个原出场粒子 F1 不绘制。':'等待已验收的显示帧。';
  if(isHud)hudHint.textContent=diagnosis??(hud?.status.blur?'原七步模糊 · 同一旧战斗 HUD 和重建世界，不是 Unity 原捕获。':
   hud?.status.error?'同上下文模糊未通过：'+hud.status.error:
   hud?.status.hud?'原法术与 DPS HUD 重建；无原生 Unity 时序宣称。':'等待同帧 HUD。');
  return visible;
 }};
}

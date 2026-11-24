import {fetchLocalBytes} from '../../../../offline-shell/paint.mjs';
import {openStage78HudProjection,LANE} from '../stage78-hud-live/authority.mjs';
import {openCanonicalObserver,EXPLICIT_LANE} from '../stage78-hud-live/hud-observer.mjs';
import {openBattleHudLayout} from '../../../../battle-hud-presentation/plan.mjs';
import {openHudPreviewPainter} from './paint-finite.mjs';
import {openHudPresenter} from '../composed-stage20-stage78-hud/presenter.mjs';
const ledger='/qualified-game/revisions/r6/stage78-hud-probe/VERIFICATION.json';
const assetsSha='fd5b7266b2f76b9b31adff21a1a8a878c55287d15e20085d651ba1a044734916';
const layoutURL='/battle-hud-presentation/LAYOUT.json';
const layoutSHA='c5be1d92913db571514b17f2603c58f5462ccb217fedc28ffd0398b8369bdcf7';
const pinRoutes=[
  ['layoutBytes',layoutURL,layoutSHA],
  ['sourceAssetsReceiptBytes',ledger,assetsSha],
  ['bindingBytes','/hud-renderer/bindings.json','1b06eb5d2c4684b59f7644c1000337b329493b9366c09a0559140fea86d1a837'],
  ['stageConfigBytes','/source-runtime/stage-config.json','663e0421e80f077094b8ad13ded7f9f7070629bec3ae81f3738c71c0182b6ab4'],
  ['fontManifestBytes','/native-font-shell/FONT-GATE.json','fd94e7d2dd477065e2e730a6d4c1093f162db064414f643bd34f6bce43dee109']
];
export async function openStage78PartialHud({stageId,canvas,nativeIndexBytes,renderer,isCurrent=()=>true}){
 if(![78000007,78000008].includes(stageId))throw Error('Stage7/8 HUD scope required');
 const inputs=Object.fromEntries(await Promise.all(pinRoutes.map(async([k,path,h])=>[k,new Uint8Array(await fetchLocalBytes(path,h))])));
 const authority=await openStage78HudProjection({...inputs,stageId,lane:LANE});
 let presenter;
 try{
  const layout=structuredClone(await openBattleHudLayout(inputs.layoutBytes));
  const c=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(inputs.sourceAssetsReceiptBytes)).assetsAndAuthoredAnchors.byObservedLoader;
  for(const [uri,a] of Object.entries(c)){
   if(layout.images[a.item])continue;
   const name=uri.split(':')[1];if(!/^[BS]_\d+$/u.test(name))throw Error('Unqualified Stage7/8 loader');
   layout.images[a.item]={name,basename:a.path.split('/').at(-1),sha256:a.cropSha256,sourceSize:a.size,originalSize:a.size,offset:[0,0],smoothing:true};
  }
  const staging=document.createElement('canvas');staging.width=1334;staging.height=750;
  const painter=await openHudPreviewPainter(staging,layout,{nativeFace:true,stageId});
  try{presenter=openHudPresenter({canvas,staging,painter,isCurrent});}catch(e){painter.dispose();throw e;}
  const original=await openCanonicalObserver({stageId,nativeIndexBytes,renderer,hudAuthority:authority,lane:EXPLICIT_LANE,expectedOrigin:location.origin});
  const observer={close(){original.close();presenter.close();}};
  for(const op of ['begin','observe','display']){
   observer[op]=async(...v)=>{
    const committed=await original[op](...v);
    await presenter.commit(committed);
    return committed;
   };
  }
  return Object.freeze({observer,presenter});
 }catch(e){presenter?.close();authority.close();throw e;}
}

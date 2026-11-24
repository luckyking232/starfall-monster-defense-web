/** Exact static art for the canonical qualified profiles only. */
import {fetchLocalBytes,wipe} from '../../../../offline-shell/paint.mjs';
import {STAGE_ART} from '../art-profile.mjs';
const crop=Object.freeze([167,127,1334,750]);
const holds=Object.freeze(['original_native_pass_scheduling','original_shader_overrides',
 'original_unity_animation_clock','original_battle_actors','original_particles_and_effects',
 'original_scene_audio_and_mixing','actual_browser_pixel_acceptance']);
export const MAPS=Object.freeze(Object.fromEntries([
  ['map2','b4394d19343421a679596e9e610af48bc22f4760e97305afc8b698996d614051'],
  ['map3','e4776d23b1333c162ba43851dcd9fdb708ccf8ad26ea83dc4d2cf69e2ab3dea3']
].map(([id,pin])=>[id,Object.freeze({crop,holds,pin,path:'/qualified-game/revisions/r6/site/art/'+id+'.png'})])));
export const STATIC_MAPS=Object.freeze(Object.fromEntries(Object.entries(STAGE_ART).flatMap(([id,key])=>key?
  [[id,Object.freeze({stageId:Number(id),...MAPS[key],key})]]:[])));
export async function loadStaticMaps(canvas){
  const ctx=canvas?.width===1334&&canvas?.height===750?canvas.getContext('2d'):null;
  if(!ctx)throw Error('Original 1334×750 preview canvas required');
  const opened=new Map();
  try{
    for(const [id,data] of Object.entries(MAPS)){
      const bytes=await fetchLocalBytes(data.path,data.pin);
      const img=await createImageBitmap(new Blob([bytes],{type:'image/png'}),{colorSpaceConversion:'none',premultiplyAlpha:'none'});
      if(img.width!==1668||img.height!==1004){img.close();throw Error('Original static image dimensions drifted');}
      opened.set(id,img);
    }
  }catch(e){for(const i of opened.values())i.close();throw e;}
  let disposed=false;
  return Object.freeze({
    paint(id){
      const stageArt=STATIC_MAPS[id];
      if(disposed||!stageArt||!opened.has(stageArt.key))throw Error('No exact open static original source for this stage');
      wipe(canvas);ctx.save();try{
        ctx.setTransform(1,0,0,1,0,0);ctx.imageSmoothingEnabled=false;
        ctx.drawImage(opened.get(stageArt.key),...stageArt.crop,0,0,1334,750);
      }finally{ctx.restore();}
    },
    close(){if(!disposed){disposed=true;for(const i of opened.values())i.close();opened.clear();}},
  });
}

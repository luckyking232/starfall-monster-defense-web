import {WEBGL_OPTIONS,CPU_PRESENTABLE_PHASES} from '../cloud-stage1-canvas2d/admission.mjs';
export const MAP3_CPU_LANE='explicit-stage3to8-admitted-original-map3-cpu';
export const map3Stage=id=>Number.isSafeInteger(id)&&id>=78000003&&id<=78000008;
export function chooseMap3Cpu({stageId,webglCanvas,canvas,enabled=false}){
 if(enabled!==true||!map3Stage(stageId))return null;
 if(webglCanvas.getContext('webgl2',WEBGL_OPTIONS)!==null)return null;
 if(!canvas||canvas===webglCanvas||canvas.width!==1334||canvas.height!==750)
  throw Error('Exact independent Map3 surface required');
 return {lane:MAP3_CPU_LANE,canvas};
}
export function permitMap3Cpu({stageId,phase,rendererLane,presentationMatched,held}){
 return map3Stage(stageId)&&rendererLane===MAP3_CPU_LANE&&presentationMatched===true&&held===false&&CPU_PRESENTABLE_PHASES.includes(phase);
}

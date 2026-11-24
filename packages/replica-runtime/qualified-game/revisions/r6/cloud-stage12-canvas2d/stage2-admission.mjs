import {WEBGL_OPTIONS,CPU_PRESENTABLE_PHASES} from '../cloud-stage1-canvas2d/admission.mjs';
export const STAGE2_CPU_LANE='stage2-exact-stock-source-canvas2d';
export function selectStage2({stageId,webglCanvas,cpuCanvas,enabled=false}){
 if(enabled!==true||stageId!==78000002)return null;
 if(webglCanvas.getContext('webgl2',WEBGL_OPTIONS)!==null)return null;
 if(!cpuCanvas||cpuCanvas===webglCanvas||cpuCanvas.width!==1334||cpuCanvas.height!==750)
  throw Error('Missing independent original Stage2 logical Canvas2D');
 return {lane:STAGE2_CPU_LANE,canvas:cpuCanvas};
}
export function permitStage2({stageId,phase,rendererLane,presentationMatched,held}){
 return stageId===78000002&&rendererLane===STAGE2_CPU_LANE&&presentationMatched===true&&held===false&&CPU_PRESENTABLE_PHASES.includes(phase);
}

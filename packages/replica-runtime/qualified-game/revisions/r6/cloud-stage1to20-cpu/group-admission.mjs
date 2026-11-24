import {WEBGL_OPTIONS,CPU_PRESENTABLE_PHASES} from '../cloud-stage1-canvas2d/admission.mjs';
export const MAP3_CPU_LANE='explicit-stage3to20-admitted-original-map3-cpu';
export const map3Stage=id=>Number.isSafeInteger(id)&&id>=78000003&&id<=78000020;
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

export function map3CpuStatus(id){
 if(!map3Stage(id))return '关卡未通过兼容画面核验。';
 return id>=78000007?'第 '+(id%100)+' 关兼容：原 Map3、已核验原身体和部分原阴影。未绘原生粒子、HUD、模糊或音频。':
  '第 3–6 关 Map3 与已核验原身体的 Canvas2D 兼容；原生材质、阴影、粒子、HUD、模糊和声音未加入。';
}

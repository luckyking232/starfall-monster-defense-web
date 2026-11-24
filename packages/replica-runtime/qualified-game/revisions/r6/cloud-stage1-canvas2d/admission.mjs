const STAGE1=78000001;
export const STAGE1_CANVAS_LANE='stage1-admitted-original-canvas2d';
export const WEBGL_OPTIONS=Object.freeze({alpha:true,antialias:false,premultipliedAlpha:true,
 preserveDrawingBuffer:true,depth:false,stencil:false,powerPreference:'low-power'});
export const CPU_PRESENTABLE_PHASES=Object.freeze(['battle-ready','battle','paused','exit-confirm']);
/** Only a literal null from the Stage1 native canvas is a capability denial. Exceptions/asset errors propagate. */
export function routeStage1Renderer({stageId,webglCanvas,cpuCanvas,enabled=true}){
 if(!enabled||stageId!==STAGE1)return {lane:'native',canvas:webglCanvas};
 const gl=webglCanvas.getContext('webgl2',WEBGL_OPTIONS);
 if(gl!==null)return {lane:'native',canvas:webglCanvas};
 if(!cpuCanvas||cpuCanvas===webglCanvas||cpuCanvas.width!==1334||cpuCanvas.height!==750)
  throw Error('Missing dedicated 1334×750 Stage1 Canvas2D surface');
 return {lane:STAGE1_CANVAS_LANE,canvas:cpuCanvas};
}
export function permitCpuFrame({stageId,phase,rendererLane,presentationMatched,held}){
 return stageId===STAGE1&&rendererLane===STAGE1_CANVAS_LANE&&presentationMatched===true&&held===false&&CPU_PRESENTABLE_PHASES.includes(phase);
}

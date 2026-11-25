/** The WebGL canvas is staging, never the visible surface. A receipt is issued
 * only for a successful world draw and a completed observer operation. */
export function captureGpuStage(canvas, renderer, {onChange=()=>{}}={}){
 const gl=canvas.getContext('webgl2');
 if(!gl)throw Error('WebGL staging context unavailable');
 let live=true,lost=false,epoch=0,draws=0,proof=null,pending=false;
 const available=()=>live&&!lost&&!gl.isContextLost();
 function invalidate(){epoch++;proof=null;}
 function loss(event){event.preventDefault();lost=true;invalidate();onChange();}
 // Restoring a browser context does not restore textures, programs or meshes.
 // This step retains the 2D front; resource recreation is a separate phase.
 function restoration(){invalidate();onChange();}
 canvas.addEventListener('webglcontextlost',loss);
 canvas.addEventListener('webglcontextrestored',restoration);
 const staged=Object.freeze({...renderer,render(...args){
  proof=null;
  const result=renderer.render(...args);
  if(pending&&available())draws++;
  return result;
 }});
 function wrap(observer){
  return Object.freeze({close(){observer.close();},...Object.fromEntries(['begin','observe','display'].map(op=>[op,async(...args)=>{
   if(!live||pending)throw Error('WebGL draw operations must be serialized');
   const turn=epoch,before=draws;
   pending=true;proof=null;
   try{
    const result=await observer[op](...args);
    if(available()&&turn===epoch&&draws>before&&result.frame)
     proof={frame:result.frame,surface:{width:canvas.width,height:canvas.height,source:canvas}};
    return result;
   }finally{pending=false;}
  }]))});
 }
 return {renderer:staged,wrap,invalidate,available,
  read(frame){return available()&&!pending&&frame&&proof?.frame===frame?proof.surface:null;},
  destroy(){live=false;invalidate();canvas.removeEventListener('webglcontextlost',loss);canvas.removeEventListener('webglcontextrestored',restoration);}};
}

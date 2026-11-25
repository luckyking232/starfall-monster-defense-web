/** Capture a complete authored CPU frame, never the painter's transient clear. */
export function captureStagePixels(reference,{alpha}){
 const ctx=reference.getContext('2d',{alpha});
 const {width,height}=reference;
 if(!ctx||width!==1334||height!==750)throw Error('Original independent CPU display surface unavailable');
 let live=true,pixels=null,revision=0,proof=null;
 const sink={width,height,getContext(kind,options){
  if(kind!=='2d'||options?.alpha!==alpha)throw Error('CPU painter requested different target');
  return {createImageData:(...args)=>ctx.createImageData(...args),
   putImageData(img,x,y){
    if(!live||x!==0||y!==0||img.width!==width||img.height!==height||
       !(img.data instanceof Uint8ClampedArray)||img.data.length!==width*height*4)
      throw Error('Invalid original staged CPU frame');
    pixels=img;revision++;
   },
   clearRect(){pixels=null;revision++;}
  };
 }};
 function wrap(observer){
  return Object.freeze({close(){observer.close();},...Object.fromEntries(['begin','observe','display'].map(op=>[op,async(...args)=>{
   const result=await observer[op](...args);
   proof=result.frame&&pixels?{frame:result.frame,revision}:null;
   return result;
  }]))});
 }
 return {sink,wrap,read(frame){return live&&frame&&proof?.frame===frame&&proof.revision===revision?pixels:null;},
  destroy(){live=false;pixels=proof=null;}};
}

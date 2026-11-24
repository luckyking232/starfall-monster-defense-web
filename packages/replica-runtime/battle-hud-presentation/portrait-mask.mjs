/** Explicit authored alpha-coverage reconstruction; not Unity stencil semantics. */
export const MASK_PREVIEW='starfall-stage1-card-authored-alpha-coverage/1';
export const MASK_LAYOUT=Object.freeze({maskItem:'n6021f',targetSize:Object.freeze([112,146]),
  // GComponent n6021c: child 0 is non-reversed mask. Its serialized opacity 0.7 is
  // not used as portrait opacity. This reconstruction uses intrinsic atlas coverage.
  maskXY:Object.freeze([1,0]),maskSize:Object.freeze([110,145]),portraitXY:Object.freeze([-6,-2]),portraitSize:Object.freeze([120,152])});
const require=(ok,m)=>{if(!ok)throw Error(m);};
const byte=(data,n)=> data instanceof Uint8Array&&data.length===n;
export function reconstructPortraitMask({mode,maskRgba,portraitRgba}={}){
 require(mode===MASK_PREVIEW,'Explicit portrait reconstruction required');
 const [mw,mh]=[112,145],[pw,ph]=MASK_LAYOUT.portraitSize,[w,h]=MASK_LAYOUT.targetSize;
 require(byte(maskRgba,mw*mh*4)&&byte(portraitRgba,pw*ph*4),'Exact decoded atlas dimensions required');
 const out=new Uint8ClampedArray(w*h*4);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   if(y>=145||x<1||x>=111)continue;
   // Pixel-centered resampling, pinned linear/clamp reconstruction of the 112→110 authored stretch.
   const u=Math.max(0,Math.min(mw-1,(x-1+.5)*mw/110-.5)),i=Math.floor(u),t=u-i;
   const a=maskRgba[(y*mw+i)*4+3]*(1-t)+maskRgba[(y*mw+Math.min(i+1,mw-1))*4+3]*t;
   const at=(y*w+x)*4,q=((y+2)*pw+x+6)*4;
   const alpha=Math.round(a*portraitRgba[q+3]/255);
   if(alpha===0)continue;
   out[at]=portraitRgba[q];out[at+1]=portraitRgba[q+1];out[at+2]=portraitRgba[q+2];out[at+3]=alpha;
 }
 return out;
}
/** Narrow lossless PNG decode keeps original straight RGB through translucent pixels. Input is separately SHA-verified. */
export async function decodeExactAtlasPng(bytes,width,height){
 const b=new Uint8Array(bytes), dv=new DataView(b.buffer,b.byteOffset,b.byteLength);
 require(b.length<1024*1024&&[137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v)&&width*height<=65536,'PNG scope');
 let at=8, first=true,end=false,parts=[],n=0;
 while(at+12<=b.length){
  const size=dv.getUint32(at),type=String.fromCharCode(...b.slice(at+4,at+8));at+=8;
  require(at+size+4<=b.length,'PNG chunk length');
  if(first){
   require(type==='IHDR'&&size===13&&dv.getUint32(at)===width&&dv.getUint32(at+4)===height&&
    b[at+8]===8&&b[at+9]===6&&b[at+10]===0&&b[at+11]===0&&b[at+12]===0,'PNG must be non-interlaced RGBA8');
   first=false;
  }else if(type==='IDAT'){parts.push(b.subarray(at,at+size));n+=size;}
  else if(type==='IEND'){require(size===0&&at+4===b.length,'IEND drift');end=true;break;}
  else require(type[0]===type[0].toLowerCase(),'Unverified critical PNG chunk');
  at+=size+4;
 }
 require(end&&n>0,'Missing PNG pixels');
 const stream=new Blob(parts).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
 const expected=(width*4+1)*height, packed=new Uint8Array(expected);let used=0;
 try{for(;;){const {value,done}=await stream.read();if(done)break;require(used+value.length<=expected,'PNG inflate size held');packed.set(value,used);used+=value.length;}}
 finally{await stream.cancel();}
 require(used===expected,'Truncated PNG scanlines');
 const p=new Uint8Array(width*height*4),pitch=width*4;
 const paeth=(a,b,c)=>{const q=a+b-c,da=Math.abs(q-a),db=Math.abs(q-b),dc=Math.abs(q-c);return da<=db&&da<=dc?a:(db<=dc?b:c);};
 for(let y=0;y<height;y++){
  const row=y*(pitch+1),filter=packed[row];require(filter<=4,'Unsupported PNG filter');
  for(let x=0;x<pitch;x++){
   const off=y*pitch+x,a=x>=4?p[off-4]:0,b=y?p[off-pitch]:0,c=y&&x>=4?p[off-pitch-4]:0;
   p[off]=packed[row+1+x]+(filter===0?0:filter===1?a:filter===2?b:filter===3?(a+b)>>1:paeth(a,b,c));
  }
 }
 return p;
}

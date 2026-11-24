/** Stage3-only software evaluation of the frozen admitted Stage3 generic sprite draw commands (not original stock materials), then one Canvas2D commit.
 * No Unity timing, materials, particles, gameplay ownership or blur support. */
import {compileStage,frameCommands,nativeProjection,} from '../stage-renderer/native-stage.mjs';
export const STAGE3_INDEX='/stage3-qualification/shared-sprites/stage-78000003.json';
const STAGE3_SHA256='bcb8bfdfc8b9835bf14379dd8ceaa438790d4c114274204f442148b46c8324e0';
const W=1334,H=750;
const ask=(ok,x)=>{if(!ok)throw Object.assign(Error(x),{code:'stage3-cpu-source-held'});};
const f=Math.fround;
const hash=async b=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(x=>x.toString(16).padStart(2,'0')).join('');
const crc32=(d,from,to)=>{let k=-1;for(let i=from;i<to;i++){k^=d[i];for(let j=0;j<8;j++)k=k>>>1^((k&1)?0xedb88320:0);}return (k^-1)>>>0;};
export async function readExactRgbaPng(d,w,h){
 ask(d instanceof Uint8Array&&d.length>40&&d.length<=2*1024*1024&&w*h<=1800000,'Stage3 PNG size budget');
 ask(String(d.subarray(0,8))==='137,80,78,71,13,10,26,10','Incorrect Stage3 PNG signature');
 const p=new DataView(d.buffer,d.byteOffset,d.byteLength), chunks=[];let offset=8,end=false;
 while(offset<d.length){
  ask(offset+12<=d.length,'Truncated PNG chunk');
  const n=p.getUint32(offset),a=offset+8,b=a+n,type=String.fromCharCode(...d.subarray(offset+4,a));
  ask(b+4<=d.length&&crc32(d,offset+4,b)===p.getUint32(b),'Stage3 PNG CRC mismatch');
  if(type==='IHDR')ask(offset===8&&n===13&&p.getUint32(a)===w&&p.getUint32(a+4)===h&&
    String(d.subarray(a+8,b))==='8,6,0,0,0','Unsupported original PNG format');
  else if(type==='IDAT'){ask(offset>8&&!end&&n>0&&chunks.length<64,'Invalid Stage3 PNG data');chunks.push(d.subarray(a,b));}
  else if(type==='IEND'){ask(n===0&&chunks.length>0&&b+4===d.length,'Invalid Stage3 PNG end');end=true;}
  else throw Error('Unqualified non-original PNG chunk: '+type);
  offset=b+4;
 }
 ask(end&&typeof DecompressionStream==='function','Stage3 lossless PNG decoder unavailable');
 const stride=w*4,expected=(stride+1)*h,raw=new Uint8Array(expected);
 const stream=new Blob(chunks).stream().pipeThrough(new DecompressionStream('deflate')).getReader();let k=0;
 try{
  for(;;){const x=await stream.read();if(x.done)break;ask(k+x.value.length<=expected,'Stage3 PNG payload over budget');raw.set(x.value,k);k+=x.value.length;}
 }finally{await stream.cancel();}
 ask(k===expected,'Stage3 PNG raster length mismatch');
 const rgba=new Uint8Array(stride*h);let s=0,y=0;
 for(;y<h;y++){
  const m=raw[s++];ask(m<=4,'Invalid PNG row filter');
  for(let j=0;j<stride;j++){
   const i=y*stride+j,a=j>=4?rgba[i-4]:0,b=y?rgba[i-stride]:0,c=y&&j>=4?rgba[i-stride-4]:0;
   let q=0;
   if(m===1)q=a;else if(m===2)q=b;else if(m===3)q=(a+b)>>>1;
   else if(m===4){const p=a+b-c,u=Math.abs(p-a),v=Math.abs(p-b),r=Math.abs(p-c);q=u<=v&&u<=r?a:v<=r?b:c;}
   rgba[i]=raw[s++]+q;
  }
 }
 return rgba;
}
const e=(x,y,u,v,p,q)=>(u-x)*(q-y)-(v-y)*(p-x);
const border=(x,y,u,v)=>v<y||(v===y&&u>x);
const grid=256, clamp=(n,m)=>Math.max(0,Math.min(n,m-1));
const pixel=(a,b,uv,t,xoff,yoff)=>{
 const sx=f(f(f(a[0]*f(b[0]))+f(a[2]*f(b[1])))+a[4]),sy=f(f(f(a[1]*f(b[0]))+f(a[3]*f(b[1])))+a[5]);
 const x=(f(sx/f(xoff))+1)*W/2,y=(1-f(sy/f(yoff)))*H/2;
 return [x,y,f(uv[0]/t.width),f(1-uv[1]/t.height),Math.round(x*grid),Math.round(y*grid)];
};
function tri(rgba,t,v,budget,diag){
 let a=v[0],b=v[1],c=v[2],area=e(a[4],a[5],b[4],b[5],c[4],c[5]);
 if(area===0)return budget;
 if(area<0){[b,c]=[c,b];area=-area;}
 const det=e(a[0],a[1],b[0],b[1],c[0],c[1]);
 ask(det>0,'Invalid Stage3 projected triangle');
 const minX=Math.max(0,Math.ceil(Math.min(a[4],b[4],c[4])/grid-.5));
 const maxX=Math.min(W-1,Math.floor(Math.max(a[4],b[4],c[4])/grid-.5));
 const minY=Math.max(0,Math.ceil(Math.min(a[5],b[5],c[5])/grid-.5));
 const maxY=Math.min(H-1,Math.floor(Math.max(a[5],b[5],c[5])/grid-.5));
 if(maxX<minX||maxY<minY)return budget;
 budget-=(maxX-minX+1)*(maxY-minY+1);
 ask(budget>=0,'Stage3 CPU raster cost cap exceeded; keep scene withheld');
 const m=border(b[4],b[5],c[4],c[5]),n=border(c[4],c[5],a[4],a[5]),p=border(a[4],a[5],b[4],b[5]);
 for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
  const q=(x+.5)*grid,k=(y+.5)*grid;
  const i=e(b[4],b[5],c[4],c[5],q,k),j=e(c[4],c[5],a[4],a[5],q,k),l=e(a[4],a[5],b[4],b[5],q,k);
  const inside=!(i<0||(i===0&&!m)||j<0||(j===0&&!n)||l<0||(l===0&&!p));
  // An independent audit of plausible separable nearest-sample tie variants; never drives the produced raster.
  const edge=diag&&(Math.abs(i)<=3*Math.hypot(c[4]-b[4],c[5]-b[5])||
     Math.abs(j)<=3*Math.hypot(a[4]-c[4],a[5]-c[5])||Math.abs(l)<=3*Math.hypot(b[4]-a[4],b[5]-a[5]));
  if(!inside&&!edge)continue;
  const wb=e(c[0],c[1],a[0],a[1],x+.5,y+.5)/det,wc=e(a[0],a[1],b[0],b[1],x+.5,y+.5)/det;
  const su=f(a[2]+wb*(b[2]-a[2])+wc*(c[2]-a[2]))*t.width,sv=f(a[3]+wb*(b[3]-a[3])+wc*(c[3]-a[3]))*t.height;
  const tx=clamp(Math.floor(su),t.width),ty=clamp(Math.floor(sv),t.height);
  const t0=(ty*t.width+tx)*4,a0=t.rgba[t0+3],z=(y*W+x)*4;
  if(diag){
   if(edge)diag.near[z/4]|=1;
   if(inside){
    const u=Math.round(su),v=Math.round(sv),epsilon=.006;
    const us=Math.abs(su-u)<=epsilon?[clamp(u-1,t.width),clamp(u,t.width)]:[tx];
    const vs=Math.abs(sv-v)<=epsilon?[clamp(v-1,t.height),clamp(v,t.height)]:[ty];
    if(us.length+vs.length>2)diag.near[z/4]|=2;
    if((diag.near[z/4]&2)||diag.candidates.has(z/4)){
     const prior=diag.candidates.get(z/4)??new Set([rgba[z]*65536+rgba[z+1]*256+rgba[z+2]]);
     const updated=new Set();
     for(const value of prior)for(const i of us)for(const j of vs){
      const tex=(j*t.width+i)*4, alpha=t.rgba[tex+3];
      const channel=(pix,k)=>Math.round((t.rgba[tex+k]*alpha+pix*(255-alpha))/255);
      updated.add(channel((value>>16)&255,0)*65536+channel((value>>8)&255,1)*256+channel(value&255,2));
     }
     ask(updated.size<=64,'Too many possible nearest boundary alternatives for exact comparison');
     diag.candidates.set(z/4,updated);
    }
    for(let k=0;k<3;k++){
     let lo=255,hi=0;
     for(const r of us)for(const s of vs){
      const j=(s*t.width+r)*4,alpha=t.rgba[j+3],src=t.rgba[j+k]*alpha;
      lo=Math.min(lo,Math.round((src+diag.lo[z+k]*(255-alpha))/255));
      hi=Math.max(hi,Math.round((src+diag.hi[z+k]*(255-alpha))/255));
     }
     diag.lo[z+k]=lo;diag.hi[z+k]=hi;
    }
   }
  }
  if(!inside||!a0)continue;
  if(a0===255){rgba[z]=t.rgba[t0];rgba[z+1]=t.rgba[t0+1];rgba[z+2]=t.rgba[t0+2];}
  else for(let k=0;k<3;k++)rgba[z+k]=Math.round((t.rgba[t0+k]*a0+rgba[z+k]*(255-a0))/255);
 }
 return budget;
}
/** Internal atlas closure only. Runtime entry owns SHA pins before invoking this function. */
export function compileCpuRaster(stage,rgbaByTexture){
 ask(stage.input.stageId===78000003&&stage.prefabs.size===7,'CPU rendering scoped to Stage3 only');
 const projection=nativeProjection(stage.input.camera,W,H),textures=new Map(),meshes=new Map();
 for(const p of stage.prefabs.values()){
  for(const [k,t] of p.tex){
   const rgba=rgbaByTexture.get(t.url);
   ask(rgba instanceof Uint8Array&&rgba.length===t.width*t.height*4&&!textures.has(t.url),'Invalid Stage3 linearly addressed atlas');
   textures.set(t.url,{...t,rgba});
  }
  for(const [id,m] of p.meshes)meshes.set(p.source.bundle+'/'+id,m);
 }
 const mapOnly=frameCommands(stage,{frame:0,units:[]});
 ask(mapOnly.length===1&&mapOnly[0].isMap&&mapOnly[0].order===-4000&&
  String(mapOnly[0].matrix)==='1,0,0,1,0,0,0'&&String(mapOnly[0].tint)==='1,1,1,1','Unknown original Stage3 map transform');
 const map=mapOnly[0],atlas=textures.get(map.texture),mesh=meshes.get(map.prefab+'/'+map.sprite);
 ask(atlas?.width===1668&&atlas.height===1004&&atlas.filterMode===1&&mesh?.localXY.length===4&&mesh.sourcePixelsPerUnit===75&&
  mesh.atlasPixelsBottomLeft.every(([u,v],i)=>Math.abs(mesh.localXY[i][0]-(u-834)/75)<1e-5&&Math.abs(mesh.localXY[i][1]-(v-502)/75)<1e-5),
  'Map3 centre crop no longer represents original texel-centre geometry');
 const background=new Uint8Array(W*H*4);
 for(let y=0;y<H;y++){
  const off=((127+y)*atlas.width+167)*4;background.set(atlas.rgba.subarray(off,off+W*4),y*W*4);
 }
 for(let i=3;i<background.length;i+=4)ask(background[i]===255,'Original stage map unexpectedly translucent');
 return Object.freeze({projection,render(snapshot,target=null,{diagnoseNearest=false}={}){
  const cmds=frameCommands(stage,snapshot);
  ask(cmds.length<=3000&&JSON.stringify(cmds[0])===JSON.stringify(map),'Unknown map ordering or sprite draw budget');
  const out=target??new Uint8ClampedArray(background.length);
  ask(out instanceof Uint8ClampedArray&&out.length===background.length,'Invalid native Stage3 framebuffer');
  out.set(background);
  let budget=13_000_000;
  const diag=diagnoseNearest?{lo:new Uint8Array(background),hi:new Uint8Array(background),near:new Uint8Array(W*H),candidates:new Map()}:null;
  for(const q of cmds.slice(1)){
   const t=textures.get(q.texture),s=meshes.get(q.prefab+'/'+q.sprite);
   ask(!q.isMap&&s&&t&&t.filterMode===0&&String(q.tint)==='1,1,1,1','Unverified original sprite blend, filtering or tint');
   const matrix=q.matrix.map(f),v=s.localXY.map((b,i)=>pixel(matrix,b,s.atlasPixelsBottomLeft[i],t,projection.halfWidth,projection.halfHeight));
   for(let i=0;i<s.triangles.length;i+=3){
    const a=s.triangles[i],b=s.triangles[i+1],c=s.triangles[i+2];
    budget=tri(out,t,[v[a],v[b],v[c]],budget,diag);
   }
  }
  return {rgba:out,commands:cmds,projection,diag};
 }});
}
export async function createStage3CpuRenderer(canvas,indexURL,{indexSha256,signal=null}={}){
 const origin=globalThis.location?.origin,index=new URL(indexURL,globalThis.location?.href);
 ask(/^http:\/\/127\.0\.0\.1:\d+$/u.test(origin??'')&&index.origin===origin&&!index.username&&!index.password&&!index.search&&!index.hash&&
   index.pathname===STAGE3_INDEX&&indexSha256===STAGE3_SHA256,'Stage3 CPU renderer requires the strict pinned same-origin original');
 const bytes=async(url,pin,len,sizeMax)=>{
  ask(url.origin===origin&&!url.username&&!url.password&&!url.search&&!url.hash,'Only exact local Stage3 assets');
  const r=await fetch(url,{signal,redirect:'error',credentials:'same-origin'});
  ask(r.ok&&r.type!=='opaque','Cannot read original Stage3 asset');
  const b=new Uint8Array(await r.arrayBuffer());
  ask(b.length>0&&b.length<=sizeMax&&(len===null||b.length===len)&&await hash(b)===pin,'Original Stage3 asset SHA or length mismatch');
  return b;
 };
 const stage=compileStage(JSON.parse(new TextDecoder().decode(await bytes(index,indexSha256,null,2_000_000))));
 const atlases=new Map();
 for(const p of stage.prefabs.values())for(const t of p.tex.values()){
  const asset=stage.input.files[t.url],url=new URL(t.url,index);
  const b=await bytes(url,asset.sha256,asset.bytes,2_000_000);
  atlases.set(t.url,await readExactRgbaPng(b,t.width,t.height));
 }
 const core=compileCpuRaster(stage,atlases);
 const ctx=canvas?.getContext('2d',{alpha:false});
 ask(ctx&&typeof ctx.createImageData==='function'&&typeof ctx.putImageData==='function','Stage3 Canvas2D cannot initialize');
 canvas.width=W;canvas.height=H;
 const scratch=ctx.createImageData(W,H);
 let closed=false;
 return Object.freeze({stage,backend:'stage3-original-sprite-cpu-canvas2d',supportsPackedBlur:false,
  resize(w,h){ask(!closed&&w===W&&h===H&&canvas.width===W&&canvas.height===H,'Stage3 CPU only qualifies the native logical frame');return core.projection;},
  render(snapshot){ask(!closed&&canvas.width===W&&canvas.height===H,'Stage3 CPU canvas unavailable');
    const result=core.render(snapshot,scratch.data);ctx.putImageData(scratch,0,0);
    return {commands:result.commands,projection:result.projection};},
  destroy(){if(!closed){closed=true;ctx.clearRect(0,0,W,H);}}
 });
}

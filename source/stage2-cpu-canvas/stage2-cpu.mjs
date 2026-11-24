import {compileStage,nativeProjection} from '../stage-renderer/native-stage.mjs';
import {qualifyStockInput,drawPlan,STOCK_URL,STOCK_PIN} from '../stage2-qualification/materials/live/renderer.mjs';
import {readExactRgbaPng} from '../stage1-cpu-canvas/stage1-cpu.mjs';
import {tri,pixel} from './triangles.mjs';
const INDEX='/stage2-qualification/visuals/stage-inputs.json';
const PIN='2ca7f8d88ae43fc5cf6411f16158a8bfb00badd0143f8ff7891f709129403ae2';
const W=1334,H=750,f=Math.fround;
const ask=(b,m)=>{if(!b)throw Object.assign(Error(m),{code:'stage2-stock-cpu-held'});};
const sha=async b=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(x=>x.toString(16).padStart(2,'0')).join('');
const knownShadow=Object.freeze([0.17599999904632568,0.17599999904632568,0.17599999904632568].map(v=>v*255));
const shadowX=f(.2),shadowY=f(.4);
export function compileStage2StockCpu(admitted,rgbaByTexture){
 // drawPlan performs private membership authentication before accepting the plan.
 const [only]=drawPlan(admitted,{frame:0,units:[]});
 const {input,policy}=admitted,stage=compileStage(input);
 const projection=nativeProjection(input.camera,W,H),textures=new Map(),meshes=new Map();
 const map=only.command;
 ask(only.kind==='map'&&map.isMap&&String(map.matrix)==='1,0,0,1,0,0,0'&&map.order===-4000,'Map2 transform outside exact source');
 const a=policy.profile.map.passes.Body,e=policy.profile.enemy.passes.Body,s=policy.profile.enemy.passes.Shadow;
 ask(String(a.blend)==='5,10,5,10'&&a.uniforms._RevertColorRatio===0&&
  ['_MultiColorExt','_MaxColorBeforeRevert','_ScaleRatioBeyondMaxColor','_Color','_VertColor'].every(k=>String(a.uniforms[k])==='1,1,1,1'),'Unqualified Map2 material');
 ask(String(e.blend)==='1,10,1,10'&&String(e.uniforms._DarkColorExt)==='1,1,1,1'&&String(e.uniforms._TwinkleColor)==='0,0,0,0'&&String(e.uniforms._Color)==='1,1,1,1','Unqualified 78000202 stock body');
 ask(String(s.blend)==='5,10,5,10'&&s.uniforms._IsMirr===0&&s.uniforms._XTilt===shadowX&&s.uniforms._YScale===shadowY&&
  String(s.uniforms._ShadowColor.slice(0,3).map(x=>x*255))===String(knownShadow)&&s.uniforms._ShadowFalloff===f(.1),'Unqualified 78000202 stock shadow');
 for(const p of stage.prefabs.values()){
  for(const t of p.tex.values()){
   const rgba=rgbaByTexture.get(t.url);
   ask(rgba instanceof Uint8Array&&rgba.length===t.width*t.height*4&&!textures.has(t.url),'Invalid original Stage2 atlas');
   textures.set(t.url,{...t,rgba});
  }
  for(const [id,m] of p.meshes)meshes.set(p.source.bundle+'/'+id,m);
 }
 const atlas=textures.get(map.texture),mesh=meshes.get(map.prefab+'/'+map.sprite);
 ask(atlas?.width===1668&&atlas.height===1004&&atlas.filterMode===1&&mesh?.localXY.length===4&&mesh.sourcePixelsPerUnit===75&&
  mesh.atlasPixelsBottomLeft.every(([u,v],i)=>Math.abs(mesh.localXY[i][0]-(u-834)/75)<1e-5&&Math.abs(mesh.localXY[i][1]-(v-502)/75)<1e-5),'Map2 texture-pixel geometry not exact');
 const background=new Uint8ClampedArray(W*H*4);
 for(let y=0;y<H;y++){const off=((127+y)*atlas.width+167)*4;background.set(atlas.rgba.subarray(off,off+W*4),y*W*4);}
 for(let i=3;i<background.length;i+=4)ask(background[i]===255,'Map2 source is not opaque');
 return Object.freeze({stage,projection,render(snapshot,out=new Uint8ClampedArray(background.length),{audit=null,diagnoseNearest=false}={}){
  const rows=drawPlan(admitted,snapshot);
  ask(rows.length<=3000&&JSON.stringify(rows[0])===JSON.stringify(only),'Stage2 command order/size outside source bounds');
  ask(out instanceof Uint8ClampedArray&&out.length===background.length,'Invalid Stage2 pixel target');
  out.set(background);let budget=13_000_000;
  const diag=diagnoseNearest?{lo:new Uint8Array(background),hi:new Uint8Array(background),near:new Uint8Array(W*H),candidates:new Map()}:null;
  if(audit)audit(rows[0],out,diag);
  for(const row of rows.slice(1)){
   const {kind,command:q}=row,t=textures.get(q.texture),m=meshes.get(q.prefab+'/'+q.sprite);
   ask(['shadow','enemy','generic'].includes(kind)&&!q.isMap&&m&&t?.filterMode===0&&String(q.tint)==='1,1,1,1','Unadmitted original Stage2 sprite or tint');
   const shadow=kind==='shadow',matrix=q.matrix.map(f);
   // Stock vertex tilts X with the real sign of object-to-world X and scales Y.
   // The stock fragment writes texture A (vertex falloff W is not used).
   if(shadow)ask(matrix[0]!==0&&q.cardId===78000202,'Invalid stock shadow matrix');
   const v=m.localXY.map(([x,y],i)=>pixel(matrix,shadow?[f(f(x)+f(f(y)*(matrix[0]<0?-shadowX:shadowX))),f(f(y)*shadowY)]:[x,y],
     m.atlasPixelsBottomLeft[i],t,projection.halfWidth,projection.halfHeight));
   for(let i=0;i<m.triangles.length;i+=3){
    const [a,b,c]=m.triangles.slice(i,i+3);
    budget=tri(out,t,[v[a],v[b],v[c]],budget,diag,shadow?knownShadow:null);
   }
   if(audit)audit(row,out,diag);
  }
  return {commands:rows,projection,rgba:out};
 }});
}
export async function createStage2CpuRenderer(canvas,indexURL,{indexSha256,signal}={}){
 const origin=globalThis.location?.origin,index=new URL(indexURL,globalThis.location?.href);
 ask(/^http:\/\/127\.0\.0\.1:\d+$/u.test(origin??'')&&index.origin===origin&&index.pathname===INDEX&&!index.username&&!index.password&&!index.search&&!index.hash&&indexSha256===PIN,'Exact Stage2 CPU source scope required');
 const take=async(url,pin,len=null,max=2_000_000)=>{
  ask(url.origin===origin&&!url.username&&!url.password&&!url.search&&!url.hash,'Only exact local source URL');
  const r=await fetch(url,{redirect:'error',credentials:'same-origin',signal});ask(r.ok&&r.type!=='opaque','Missing exact Stage2 asset');
  const b=new Uint8Array(await r.arrayBuffer());
  ask(b.length&&b.length<=max&&(len===null||b.length===len)&&await sha(b)===pin,'Wrong Stage2 source size or bytes');return b;
 };
 const a=await qualifyStockInput(await take(index,PIN),await take(new URL(STOCK_URL,index),STOCK_PIN,null,40000));
 const atlas=new Map();
 for(const p of a.input.prefabs)for(const t of p.textures){
  const k=a.input.files[t.url],b=await take(new URL(t.url,index),k.sha256,k.bytes);
  atlas.set(t.url,await readExactRgbaPng(b,t.width,t.height));
 }
 const core=compileStage2StockCpu(a,atlas),ctx=canvas.getContext('2d',{alpha:true});
 ask(canvas.width===W&&canvas.height===H&&ctx&&typeof ctx.createImageData==='function'&&typeof ctx.putImageData==='function','Exact native logical Canvas2D required');
 const rgba=ctx.createImageData(W,H);let opened=true;
 return Object.freeze({stage:core.stage,backend:'stage2-stock-source-canvas2d',supportsPackedBlur:false,
  resize(w,h){ask(opened&&w===W&&h===H&&canvas.width===W&&canvas.height===H,'Scope is fixed to original logical dimensions');return core.projection;},
  render(snapshot){ask(opened&&canvas.width===W&&canvas.height===H,'Closed fixed Stage2 surface');const v=core.render(snapshot,rgba.data);
   ctx.putImageData(rgba,0,0);return {commands:v.commands,projection:v.projection};},
  destroy(){if(opened){opened=false;ctx.clearRect(0,0,W,H);}}});
}

import {compileStage,nativeProjection} from '../stage-renderer/native-stage.mjs';
import {qualifyStockInput as q1,drawPlan as d1} from '../qualified-game/revisions/r6/later-body-probe/stock-later.mjs';
import {qualifyStockInput as q2,drawPlan as d2} from '../qualified-game/revisions/r6/later-body-six/stock-later.mjs';
import {readExactRgbaPng} from '../stage1-cpu-canvas/stage1-cpu.mjs';
import {tri,pixel} from '../stage2-cpu-canvas/triangles.mjs';
const BINDINGS=Object.freeze({"78000013":["later-body-probe","e11b58d35a14f79a19685f379071317125e013c1481b64388eabb9653760572f","54e07367cc6c9c7c45f3d38f62a69abd01676e886996f06b6b333037e0bf1fcf"],"78000015":["later-body-probe","9f86c861be763d0f16a1fc14afe6c436ec5b3b0aeb50868916794d7cae6b2185","54e07367cc6c9c7c45f3d38f62a69abd01676e886996f06b6b333037e0bf1fcf"],"78000018":["later-body-probe","2132a3dab81e08489069ddc7cc30e356f649bbc93b9d85b25541f017080d5cc2","54e07367cc6c9c7c45f3d38f62a69abd01676e886996f06b6b333037e0bf1fcf"],"78000020":["later-body-probe","6051188ea3328092fedd5e7238f5d1ae5278be404493cc10ece07507d53f01cd","54e07367cc6c9c7c45f3d38f62a69abd01676e886996f06b6b333037e0bf1fcf"],"78000011":["later-body-six","741239b65e066f82049eac0a9e8db5737e1928a159b2a906186bd7858c8f200b","14be9c6bce579ab3fb4a9c5ef6c7d40340b24483e906bd0b56d2344adede86ea"],"78000012":["later-body-six","c6076a23eecafbe77380abe4654d52b72865b420c6a899032e34866cdbc4a01f","14be9c6bce579ab3fb4a9c5ef6c7d40340b24483e906bd0b56d2344adede86ea"],"78000014":["later-body-six","dc1e166e8a86a024418b3ebf90eb727b12e7b5967a2f9081f8a1841bea5e7320","14be9c6bce579ab3fb4a9c5ef6c7d40340b24483e906bd0b56d2344adede86ea"],"78000016":["later-body-six","24b73b5a0e04f7ae1b4994b39e90dd31df5a9b6928309d1b5e745cb43edc122e","14be9c6bce579ab3fb4a9c5ef6c7d40340b24483e906bd0b56d2344adede86ea"],"78000017":["later-body-six","451ff8329c0135ea1402aa15a36e44c5e9187a1546cfc89d8dc3a114c3ed95df","14be9c6bce579ab3fb4a9c5ef6c7d40340b24483e906bd0b56d2344adede86ea"],"78000019":["later-body-six","c67ea1d669b56c27eab272763fd226a90d17df262a1fa377b92bd09ed9f64205","14be9c6bce579ab3fb4a9c5ef6c7d40340b24483e906bd0b56d2344adede86ea"]});
const ROOT='/qualified-game/revisions/r6/';
const family=group=>group==='later-body-probe'?[q1,d1]:[q2,d2];
const W=1334,H=750,f=Math.fround;
const ask=(b,m)=>{if(!b)throw Object.assign(Error(m),{code:'stage11to20-stock-cpu-held'});};
const sha=async b=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(x=>x.toString(16).padStart(2,'0')).join('');
const knownShadow=Object.freeze([0.17599999904632568,0.17599999904632568,0.17599999904632568].map(v=>v*255));
const shadowX=f(.2),shadowY=f(.4);
export function compileStage11to20StockCpu(admitted,rgbaByTexture){
 // drawPlan performs private membership authentication before accepting the plan.
 const binding=BINDINGS[admitted?.stageId];
 ask(binding,'Only allowed later finite source stages');
 const [,drawPlan]=family(binding[0]);
 const [only]=drawPlan(admitted,{frame:0,units:[]});
 const {input,policy}=admitted,stage=compileStage(input);
 const projection=nativeProjection(input.camera,W,H),textures=new Map(),meshes=new Map();
 const map=only.command;
 ask(only.kind==='generic'&&map.isMap&&String(map.matrix)==='1,0,0,1,0,0,0'&&map.order===-4000,'Map3 transform outside exact source');
 const e=policy.passes.Body,s=policy.passes.Shadow;
 ask(String(e.blend)==='1,10,1,10'&&String(e.uniforms._DarkColorExt)==='1,1,1,1'&&String(e.uniforms._TwinkleColor)==='0,0,0,0'&&String(e.uniforms._Color)==='1,1,1,1','Unqualified stock actor stock body');
 ask(String(s.blend)==='5,10,5,10'&&s.uniforms._IsMirr===0&&s.uniforms._XTilt===shadowX&&s.uniforms._YScale===shadowY&&
  String(s.uniforms._ShadowColor.slice(0,3).map(x=>x*255))===String(knownShadow)&&s.uniforms._ShadowFalloff===f(.1),'Unqualified stock actor stock shadow');
 for(const p of stage.prefabs.values()){
  for(const t of p.tex.values()){
   const rgba=rgbaByTexture.get(t.url);
   ask(rgba instanceof Uint8Array&&rgba.length===t.width*t.height*4&&!textures.has(t.url),'Invalid original Stage11to20 atlas');
   textures.set(t.url,{...t,rgba});
  }
  for(const [id,m] of p.meshes)meshes.set(p.source.bundle+'/'+id,m);
 }
 const atlas=textures.get(map.texture),mesh=meshes.get(map.prefab+'/'+map.sprite);
 ask(atlas?.width===1668&&atlas.height===1004&&atlas.filterMode===1&&mesh?.localXY.length===4&&mesh.sourcePixelsPerUnit===75&&
  mesh.atlasPixelsBottomLeft.every(([u,v],i)=>Math.abs(mesh.localXY[i][0]-(u-834)/75)<1e-5&&Math.abs(mesh.localXY[i][1]-(v-502)/75)<1e-5),'Map3 texture-pixel geometry not exact');
 const background=new Uint8ClampedArray(W*H*4);
 for(let y=0;y<H;y++){const off=((127+y)*atlas.width+167)*4;background.set(atlas.rgba.subarray(off,off+W*4),y*W*4);}
 for(let i=3;i<background.length;i+=4)ask(background[i]===255,'Map3 source is not opaque');
 return Object.freeze({stage,projection,render(snapshot,out=new Uint8ClampedArray(background.length),{audit=null,diagnoseNearest=false}={}){
  const rows=drawPlan(admitted,snapshot);
  ask(rows.length<=3000&&JSON.stringify(rows[0])===JSON.stringify(only),'Stage11to20 command order/size outside source bounds');
  ask(out instanceof Uint8ClampedArray&&out.length===background.length,'Invalid Stage11to20 pixel target');
  out.set(background);let budget=13_000_000;
  const diag=diagnoseNearest?{lo:new Uint8Array(background),hi:new Uint8Array(background),near:new Uint8Array(W*H),candidates:new Map()}:null;
  if(audit)audit(rows[0],out,diag);
  for(const row of rows.slice(1)){
   const {kind,command:q}=row,t=textures.get(q.texture),m=meshes.get(q.prefab+'/'+q.sprite);
   ask(['shadow','enemy','generic'].includes(kind)&&!q.isMap&&m&&t?.filterMode===0&&String(q.tint)==='1,1,1,1','Unadmitted original Stage11to20 sprite or tint');
   const shadow=kind==='shadow',matrix=q.matrix.map(f);
   // Stock vertex tilts X with the real sign of object-to-world X and scales Y.
   // The stock fragment writes texture A (vertex falloff W is not used).
   if(shadow)ask(matrix[0]!==0&&[78000105,78000205,78000206].includes(q.cardId),'Invalid stock shadow matrix');
   const v=m.localXY.map(([x,y],i)=>pixel(matrix,shadow?[f(f(x)+f(f(y)*(matrix[0]<0?-shadowX:shadowX))),f(f(y)*shadowY)]:[x,y],
     m.atlasPixelsBottomLeft[i],t,projection.halfWidth,projection.halfHeight));
   for(let i=0;i<m.triangles.length;i+=3){
    const [a,b,c]=m.triangles.slice(i,i+3);
    budget=tri(out,t,[v[a],v[b],v[c]],budget,diag,shadow?knownShadow:null);
   }
   if(audit)audit(row,out,diag);
  }
  return {commands:rows,projection,rgba:out,diag};
 }});
}
export async function createStage11to20CpuRenderer(canvas,indexURL,{indexSha256,signal}={}){
 const origin=globalThis.location?.origin,index=new URL(indexURL,globalThis.location?.href);
 const match=/^\/qualified-game\/revisions\/r6\/(later-body-(?:probe|six))\/stage-(780000(?:1\d|20))\.json$/u.exec(index.pathname);
 const id=Number(match?.[2]),binding=BINDINGS[id];
 ask(binding&&match[1]===binding[0],'Exact stage and group identity required');
 const [group,PIN,STOCK_PIN]=binding;
 const STOCK_URL=ROOT+group+'/stock-bindings.json';
 const [qualifyStockInput]=family(group);
 ask(/^http:\/\/127\.0\.0\.1:\d+$/u.test(origin??'')&&index.origin===origin&&PIN&&!index.username&&!index.password&&!index.search&&!index.hash&&indexSha256===PIN,'Exact Stage11to20 CPU source scope required');
 const take=async(url,pin,len=null,max=2_000_000)=>{
  ask(url.origin===origin&&!url.username&&!url.password&&!url.search&&!url.hash,'Only exact local source URL');
  const r=await fetch(url,{redirect:'error',credentials:'same-origin',signal});ask(r.ok&&r.type!=='opaque','Missing exact Stage11to20 asset');
  const b=new Uint8Array(await r.arrayBuffer());
  ask(b.length&&b.length<=max&&(len===null||b.length===len)&&await sha(b)===pin,'Wrong Stage11to20 source size or bytes');return b;
 };
 const a=await qualifyStockInput(id,await take(index,PIN),await take(new URL(STOCK_URL,index),STOCK_PIN,null,40000));
 const atlas=new Map();
 for(const p of a.input.prefabs)for(const t of p.textures){
  const k=a.input.files[t.url],b=await take(new URL(t.url,index),k.sha256,k.bytes);
  atlas.set(t.url,await readExactRgbaPng(b,t.width,t.height));
 }
 const core=compileStage11to20StockCpu(a,atlas),ctx=canvas.getContext('2d',{alpha:true});
 ask(canvas.width===W&&canvas.height===H&&ctx&&typeof ctx.createImageData==='function'&&typeof ctx.putImageData==='function','Exact native logical Canvas2D required');
 const rgba=ctx.createImageData(W,H);let opened=true;
 return Object.freeze({stage:core.stage,backend:'stage11to20-stock-source-canvas2d',supportsPackedBlur:false,
  resize(w,h){ask(opened&&w===W&&h===H&&canvas.width===W&&canvas.height===H,'Scope is fixed to original logical dimensions');return core.projection;},
  render(snapshot){ask(opened&&canvas.width===W&&canvas.height===H,'Closed fixed Stage11to20 surface');const v=core.render(snapshot,rgba.data);
   ctx.putImageData(rgba,0,0);return {commands:v.commands,projection:v.projection};},
  destroy(){if(opened){opened=false;ctx.clearRect(0,0,W,H);}}});
}

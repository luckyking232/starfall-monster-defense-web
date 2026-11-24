/** Stage7/8 body-only diagnostic; never authorizes original effects or HUD. */
import {compileStage,frameCommands,nativeProjection,FRAG,VERT} from '../../../../stage-renderer/native-stage.mjs';
const ROUTE="/qualified-game/revisions/r6/stage910-body-probe/";
const KIND="/qualified-game/revisions/r6/stage910-body-probe/stock-bindings.json";
export const LANE='explicit-stage910-stock-bodies-no-effects/1';
const ARM=[[78000105,'left'],[78000206,'right']];
const ORDER=['generic map','stock shadows','stable bodies'];
const ensure=(p,msg)=>{if(!p)throw Object.assign(Error(msg),{code:'stock-stage910-held'});};
const pins=Object.freeze({"78000009":"e6c3a6cb52709956d0a6e5bbd9fd3bceb00fca35b49a79eee030a6c1cfb2cff1","78000010":"88045dcbc679a51bc4f34e60c660d57d5c4ddf6f34277e8f087c496ce0e95433"});
const vertexBytes=new TextEncoder();
const sha=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),v=>v.toString(16).padStart(2,'0')).join('');
const seenBundles=new WeakMap();
async function parsed(b,h,max){
  ensure((b instanceof ArrayBuffer||b instanceof Uint8Array)&&b.byteLength>0&&b.byteLength<=max,'Stage910 stock byte size gate');
  const c=new Uint8Array(b instanceof ArrayBuffer?b.slice(0):b);
  ensure(await sha(c)===h,'Stage910 stock integrity gate');
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(c));
}
function freeze(o){if(o&&typeof o==='object'&&!Object.isFrozen(o)){Object.values(o).forEach(freeze);Object.freeze(o);}return o;}
export async function qualifyStockInput(stageId,indexBytes,materialBytes){
  ensure(Number.isSafeInteger(stageId)&&Object.hasOwn(pins,stageId),'Stage910 unknown profile');
  const [i,m]=await Promise.all([parsed(indexBytes,pins[stageId],800000),parsed(materialBytes,"f97aa3e0da26f9b351c323c3d15d2cd3c73983eb1682932b2977ac298ff258c2",40000)]);
  ensure(i.stageId===stageId&&m.schema==='starfall.stage910.stock-body-only/1'&&m.assets[stageId],'Stage910 source identity');
  const stage=compileStage(i), actors=m.assets[stageId];
  for(const [id] of ARM){
    const p=actors[id], prefab=stage.units.get(id)?.prefab;
    ensure(prefab?.source.bundle===p.prefab&&prefab.renderers.has(p.renderer)&&[...prefab.tex.values()].some(t=>t.url===p.texture),
      'Wrong Stage910 stock body '+id);
  }
  ensure(JSON.stringify(m.order)===JSON.stringify(ORDER)&&Object.keys(m.passes).sort().join(',')==='Body,Shadow','Stage910 stock pass scope');
  for(const v of Object.values(m.passes)){
    ensure(v.vertex.startsWith('#version 100')&&v.fragment.startsWith('#version 100')&&
      await sha(vertexBytes.encode(v.vertex))===v.vertexSha256&&await sha(vertexBytes.encode(v.fragment))===v.fragmentSha256,
      'Stage910 only byte-exact original shader');
    ensure(v.blend.length===4&&v.blend.every(x=>[1,5,10].includes(x)),'Unsupported Stage910 blend');
  }
  const accepted=freeze({input:i,policy:m,stageId});seenBundles.set(accepted,stage);return accepted;
}
const matrix4=([a,b,c,d,x,y,z])=>Array.from(new Float32Array([a,b,0,0,c,d,0,0,0,0,1,0,x,y,z,1]));
export function drawPlan(admitted,snapshot){
  ensure(seenBundles.has(admitted),'Stage910 draw requires immutable admitted body packet');
  const {stageId,policy}=admitted, stage=seenBundles.get(admitted);
  const metadata=new Map();
  for(const u of snapshot.units){ensure(stage.units.has(u.cardId)&&!metadata.has(u.uid),'Unknown or duplicate stage body');metadata.set(u.uid,u);}
  const scoped=policy.assets[stageId],reserved=new Set(Object.values(scoped).map(x=>x.prefab));
  const elite=78000206;
  ensure(!snapshot.units.some(x=>x.cardId===elite&&x.stateName==='die'),'Original 20108 death clip is empty; no death pose admitted');
  const cmds=frameCommands(stage,snapshot),map=cmds.filter(q=>q.isMap),rest=cmds.filter(q=>!q.isMap),stock=[];
  ensure(map.length===1&&map[0].prefab===stage.background.source.bundle,'Wrong Map3 scope');
  for(const q of rest){
    const p=Object.hasOwn(scoped,q.cardId)?scoped[q.cardId]:null;
    if(!p){ensure(!reserved.has(q.prefab),'Stock body cannot be generic');continue;}
    const camp=ARM.find(x=>x[0]===q.cardId)[1];
    const unit=metadata.get(q.uid);
    ensure(q.prefab===p.prefab&&q.renderer===p.renderer&&q.texture===p.texture&&q.tint.every(v=>v===1)&&
      unit?.camp===camp&&unit.flipX===(camp==='right'),'Stock body identity, tint or facing outside verified scope');
    stock.push(q);
  }
  const q0=(kind,command)=>({kind,command,world:matrix4(command.matrix)});
  return [q0('generic',map[0]),...stock.map(c=>q0('shadow',c)),...rest.map(c=>q0(Object.hasOwn(scoped,c.cardId)?'enemy':'generic',c))];
}
function program(gl,source,store){
  const pg=gl.createProgram();ensure(pg,'Stock shader program unavailable');store.programs.push(pg);
  for(const [kind,txt] of [[gl.VERTEX_SHADER,source.vertex],[gl.FRAGMENT_SHADER,source.fragment]]){
    const s=gl.createShader(kind);ensure(s,'Stock shader allocation');store.shaders.push(s);
    gl.shaderSource(s,txt); // byte-exact; never prepend defines, port, or repair
    gl.compileShader(s);ensure(gl.getShaderParameter(s,gl.COMPILE_STATUS),'Exact stock shader compile held: '+gl.getShaderInfoLog(s));
    gl.attachShader(pg,s);
  }
  gl.linkProgram(pg);ensure(gl.getProgramParameter(pg,gl.LINK_STATUS),'Exact stock shader link held: '+gl.getProgramInfoLog(pg));
  const u=n=>gl.getUniformLocation(pg,n);
  const generic=source.blend===undefined;
  const attrs=generic?[['pos',2,0],['uv',2,16]]:[['in_POSITION0',4,0],['in_TEXCOORD0',2,16],['in_COLOR0',4,24]];
  const uniforms=generic?null:{world:u('hlslcc_mtx4x4unity_ObjectToWorld[0]'),proj:u('hlslcc_mtx4x4unity_MatrixVP[0]')};
  ensure(generic||(uniforms.world!==null&&uniforms.proj!==null&&u('_MainTex')!==null),'Required original vertex/sampler bindings missing');
  const a=attrs.map(([key,w,offset])=>[gl.getAttribLocation(pg,key),w,offset]).filter(x=>x[0]>=0);
  ensure(a.length>=2,'Original mesh attributes not linked');
  return {pg,a,u,generic,uniforms,source};
}
const pin=/^[0-9a-f]{64}$/;
async function getExact(url,pin0,size,signal){
  ensure(url.origin===location.origin&&!url.username&&!url.password&&!url.search&&!url.hash&&pin.test(pin0),'Only explicitly pinned same-origin stock inputs');
  const r=await fetch(url,{signal,redirect:'error',credentials:'same-origin'});
  ensure(r.ok&&r.type!=='opaque','Exact stock asset route missing: '+url.pathname);
  const b=await r.arrayBuffer();ensure((size===null||size===b.byteLength)&&await sha(b)===pin0,'Exact stock asset byte mismatch');
  return b;
}
export async function createStockStage910Renderer(canvas,indexURL,{lane,indexSha256,stageId,signal,readback=false}={}){
  ensure(lane===LANE&&Object.hasOwn(pins,stageId)&&indexSha256===pins[stageId],'Explicit Stage910 exact body-only lane required');
  const url=new URL(indexURL,location.href);
  ensure(url.pathname===ROUTE+'stage-'+stageId+'.json','Unexpected Stage910 scene route');
  const b=await Promise.all([getExact(url,indexSha256,null,signal),getExact(new URL(KIND,url),"f97aa3e0da26f9b351c323c3d15d2cd3c73983eb1682932b2977ac298ff258c2",null,signal)]);
  const a=await qualifyStockInput(stageId,...b);
  const {input,policy}=a,stage=compileStage(input);
  const gl=canvas.getContext('webgl2',{alpha:true,antialias:false,premultipliedAlpha:true,preserveDrawingBuffer:readback,depth:false,stencil:false,powerPreference:'low-power'});
  ensure(gl,'WebGL2 unavailable; no generic fallback for Stage910 stock profile');
  const store={programs:[],shaders:[],textures:[],buffers:[],vaos:[]};
  const tex=new Map(), mesh=new Map();
  let closed=false;
  const dispose=()=>{
    if(closed)return;closed=true;
    for(const [items,kind] of Object.entries({programs:'Program',shaders:'Shader',textures:'Texture',buffers:'Buffer',vaos:'VertexArray'}))
      for(const obj of store[items])gl['delete'+kind](obj);
  };
  const alloc=(kind,items)=>{
    const v=gl['create'+kind]();ensure(v,'Exact stock resource allocation failed '+kind);
    store[items].push(v);return v;
  };
  try{
    const pass={shadow:program(gl,policy.passes.Shadow,store),
      enemy:program(gl,policy.passes.Body,store),generic:program(gl,{vertex:VERT,fragment:FRAG},store)};
    for(const p of stage.prefabs.values()){
      for(const t of p.tex.values()){
        const a0=stage.input.files[t.url];
        const raw=await getExact(new URL(t.url,url),a0.sha256,a0.bytes,signal);
        const bitmap=await createImageBitmap(new Blob([raw],{type:'image/png'}),{colorSpaceConversion:'none',premultiplyAlpha:'none'});
        try{
          ensure(bitmap.width===t.width&&bitmap.height===t.height,'Exact stock texture dimension mismatch');
          const tex0=alloc('Texture','textures');
          tex.set(t.url,tex0);gl.bindTexture(gl.TEXTURE_2D,tex0);
          gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.NONE);
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
          for(const q of ['TEXTURE_WRAP_S','TEXTURE_WRAP_T'])gl.texParameteri(gl.TEXTURE_2D,gl[q],gl.CLAMP_TO_EDGE);
          for(const q of ['TEXTURE_MIN_FILTER','TEXTURE_MAG_FILTER'])gl.texParameteri(gl.TEXTURE_2D,gl[q],t.filterMode===0?gl.NEAREST:gl.LINEAR);
          gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,bitmap);
        }finally{bitmap.close();}
      }
      for(const s of p.meshes.values()){
        const t=p.tex.get(s.texturePathId);
        const v=new Float32Array(s.localXY.length*10);
        const indices=Uint16Array.from(s.triangles);
        s.localXY.forEach(([x,y],i)=>{
          const [u0,v0]=s.atlasPixelsBottomLeft[i];
          v.set([x,y,0,1,u0/t.width,1-v0/t.height,1,1,1,1],i*10);
        });
        const vb=alloc('Buffer','buffers'),ib=alloc('Buffer','buffers');
        const map=new Map();
        for(const [name,d] of Object.entries(pass)){
          if((name==='generic')===Object.values(policy.assets[stageId]).some(a=>a.prefab===p.source.bundle))continue;
          const vao=alloc('VertexArray','vaos');gl.bindVertexArray(vao);
          gl.bindBuffer(gl.ARRAY_BUFFER,vb);gl.bufferData(gl.ARRAY_BUFFER,v,gl.STATIC_DRAW);
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ib);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,indices,gl.STATIC_DRAW);
          for(const [i,width,offset] of d.a){gl.enableVertexAttribArray(i);gl.vertexAttribPointer(i,width,gl.FLOAT,false,40,offset);}
          map.set(name,vao);
        }
        mesh.set(p.source.bundle+'/'+s.pathId,{map,count:indices.length});
      }
    }
    ensure(gl.getError()===gl.NO_ERROR,'Exact stock GL setup held');
    const colors={1:gl.ONE,5:gl.SRC_ALPHA,10:gl.ONE_MINUS_SRC_ALPHA};
    return Object.freeze({stage,destroy:dispose,
      resize(w,h){
        ensure(!closed&&!gl.isContextLost()&&w===1334&&h===750,'Exact stock reference 1334×750 canvas only');
        if(canvas.width!==w)canvas.width=w;if(canvas.height!==h)canvas.height=h;
        return nativeProjection(stage.input.camera,w,h);
      },
      render(snapshot){
        ensure(!closed&&!gl.isContextLost()&&gl.drawingBufferWidth===1334&&gl.drawingBufferHeight===750,'Stage910 stock world surface held');
        const plan=drawPlan(a,snapshot),p=nativeProjection(stage.input.camera,1334,750);
        const proj=Float32Array.from([1/p.halfWidth,0,0,0,0,1/p.halfHeight,0,0,0,0,1,0,0,0,0,1]);
        for(const x of ['CULL_FACE','DEPTH_TEST','DITHER','STENCIL_TEST','SCISSOR_TEST'])gl.disable(gl[x]);
        gl.enable(gl.BLEND);gl.blendEquation(gl.FUNC_ADD);gl.colorMask(true,true,true,true);
        gl.activeTexture(gl.TEXTURE0);gl.viewport(0,0,1334,750);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
        for(const {kind,command:q,world} of plan){
          const c=pass[kind],d=mesh.get(q.prefab+'/'+q.sprite);
          ensure(d?.map.has(kind)&&tex.has(q.texture),'Stock pose or texture not admitted');
          gl.bindVertexArray(d.map.get(kind));gl.useProgram(c.pg);
          gl.bindTexture(gl.TEXTURE_2D,tex.get(q.texture));
          if(c.generic){
            gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
            gl.uniform1i(c.u('tex'),0);
            const [x0,y0,x1,y1,x2,y2]=q.matrix;
            gl.uniformMatrix3fv(c.u('xf'),false,[x0,y0,0,x1,y1,0,x2,y2,1]);
            gl.uniform2f(c.u('ext'),p.halfWidth,p.halfHeight);gl.uniform4fv(c.u('tint'),q.tint);
          }else{
            gl.blendFuncSeparate(...c.source.blend.map(x=>colors[x]));
            gl.uniform1i(c.u('_MainTex'),0);gl.uniform4fv(c.uniforms.world,Float32Array.from(world));gl.uniform4fv(c.uniforms.proj,proj);
            for(const [key,value] of Object.entries(c.source.uniforms)){
              const loc=c.u(key);if(loc===null)continue;
              if(Array.isArray(value))gl.uniform4fv(loc,Float32Array.from(value));
              else if(key==='_IsMirr')gl.uniform1i(loc,value);
              else gl.uniform1f(loc,value);
            }
          }
          gl.drawElements(gl.TRIANGLES,d.count,gl.UNSIGNED_SHORT,0);
        }
        ensure(gl.getError()===gl.NO_ERROR&&!gl.isContextLost(),'Exact stock scene GL draw held');
        return {plan,projection:p,originalNativePassScheduling:false};
      }
    });
  }catch(e){dispose();throw e;}
}

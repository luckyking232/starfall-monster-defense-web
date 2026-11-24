/** Explicit Stage2-only stock GLES100 for Map2 and 78000202. Other actors are reconstruction. */
import {compileStage,frameCommands,nativeProjection,FRAG,VERT} from '../../../stage-renderer/native-stage.mjs';
const INPUT_PIN='2ca7f8d88ae43fc5cf6411f16158a8bfb00badd0143f8ff7891f709129403ae2';
export const STOCK_PIN='ac78ec28e7f3375e13c2eecbcd8f470d0ee7b619dc926ca75cae42bed222ebe8';
export const LANE='explicit-stage2-stock-gles100-reconstruction/1';
export const STOCK_URL='/stage2-qualification/materials/live/STOCK.json';
const STAGE=78000002,ENEMY=78000202,ORDER=['map','stock enemy shadows','stable source bodies'];
const ensure=(p,msg)=>{if(!p)throw Object.assign(Error(msg),{code:'stock-stage2-held'});};
const vertexBytes=new TextEncoder();
const sha=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),v=>v.toString(16).padStart(2,'0')).join('');
const seenBundles=new WeakMap();
const pin=/^[0-9a-f]{64}$/;
async function parsed(b,h,max){
  ensure((b instanceof ArrayBuffer||b instanceof Uint8Array)&&b.byteLength>0&&b.byteLength<=max,'Stock input byte-size gate');
  const c=new Uint8Array(b instanceof ArrayBuffer?b.slice(0):b);
  ensure(await sha(c)===h,'Exact original stock input SHA gate');
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(c));
}
export async function qualifyStockInput(indexBytes,materialBytes){
  const [i,m]=await Promise.all([parsed(indexBytes,INPUT_PIN,800000),parsed(materialBytes,STOCK_PIN,40000)]);
  ensure(i.stageId===STAGE&&m.stageId===STAGE&&m.sceneIndexSha256===INPUT_PIN&&
         m.schema==='starfall.stage2.stock-gles100-scene-binding/1','Wrong stock scene identity');
  ensure(JSON.stringify(m.testedPassOrder)===JSON.stringify(ORDER),'Unapproved stock pass ordering');
  const stage=compileStage(i);
  const bindings={map:[m.profile.map,stage.background],enemy:[m.profile.enemy,stage.units.get(ENEMY)?.prefab]};
  for(const [kind,[p,prefab]] of Object.entries(bindings)){
    ensure(prefab?.source.bundle===p.prefab&&prefab.renderers.has(p.renderer)&&[...prefab.tex.values()].some(t=>t.url===p.texture),
      'Wrong stock binding '+kind);
    ensure(Object.keys(p.passes).sort().join(',')===(kind==='map'?'Body':'Body,Shadow'),'Unqualified stock program selection');
    for(const v of Object.values(p.passes)){
      ensure(v.vertex.startsWith('#version 100')&&v.fragment.startsWith('#version 100')&&
        await sha(vertexBytes.encode(v.vertex))===v.vertexSha256&&await sha(vertexBytes.encode(v.fragment))===v.fragmentSha256,
        'Unchanged original stock program required');
      ensure(v.blend.length===4&&v.blend.every(x=>[1,5,10].includes(x)),'Unsupported stock blend');
    }
  }
  function freeze(o){if(o&&typeof o==='object'&&!Object.isFrozen(o)){Object.values(o).forEach(freeze);Object.freeze(o);}return o;}
  // The exact verified raw inputs remain private to the painter. No caller can mutate a hash-verified program.
  const policy=freeze(m);
  const input=freeze(i);
  const admitted=Object.freeze({policy,input});
  seenBundles.set(admitted,stage);return admitted;
}
const matrix4=([a,b,c,d,x,y,z])=>Array.from(new Float32Array([a,b,0,0,c,d,0,0,0,0,1,0,x,y,z,1]));
export function drawPlan(admitted,snapshot){
  ensure(seenBundles.has(admitted),'Stock planner requires exact admitted Stage2 source');
  // The unexposed compiled stage came from verified immutable typed data.
  const {policy}=admitted,stage=seenBundles.get(admitted);
  const cmds=frameCommands(stage,snapshot);
  const map=cmds.filter(q=>q.isMap);
  const stock=[];
  const valid=(q,p)=>q.prefab===p.prefab&&q.renderer===p.renderer&&q.texture===p.texture&&q.tint.every(v=>v===1);
  ensure(map.length===1&&valid(map[0],policy.profile.map),'Stock Map2 renderer or per-instance tint changed');
  for(const d of cmds){
    if(d.isMap)continue;
    if(d.cardId===ENEMY){
      ensure(valid(d,policy.profile.enemy),'Stock 78000202 renderer or per-instance tint changed');
      stock.push(d);
    }else ensure(d.prefab!==policy.profile.enemy.prefab,'Stock enemy cannot be resent through generic presentation');
  }
  const source=(kind,q)=>({kind,command:q,world:matrix4(q.matrix)});
  return [source('map',map[0]),...stock.map(q=>source('shadow',q)),
    ...cmds.filter(q=>!q.isMap).map(q=>source(q.cardId===ENEMY?'enemy':'generic',q))];
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
async function getExact(url,pin0,size,signal){
  ensure(url.origin===location.origin&&!url.username&&!url.password&&!url.search&&!url.hash&&pin.test(pin0),'Only explicitly pinned same-origin stock inputs');
  const r=await fetch(url,{signal,redirect:'error',credentials:'same-origin'});
  ensure(r.ok&&r.type!=='opaque','Exact stock asset route missing: '+url.pathname);
  const b=await r.arrayBuffer();ensure((size===null||size===b.byteLength)&&await sha(b)===pin0,'Exact stock asset byte mismatch');
  return b;
}
export async function createStockStage2Renderer(canvas,indexURL,{lane,indexSha256,signal,readback=false}={}){
  ensure(lane===LANE&&indexSha256===INPUT_PIN,'Stage2 stock renderer requires explicit exact reconstruction lane');
  const url=new URL(indexURL,location.href);
  ensure(url.pathname==='/stage2-qualification/visuals/stage-inputs.json','Exact scoped Stage2 index route required');
  const b=await Promise.all([getExact(url,INPUT_PIN,null,signal),getExact(new URL(STOCK_URL,url),STOCK_PIN,null,signal)]);
  const a=await qualifyStockInput(...b);
  const {input,policy}=a,stage=compileStage(input);
  const gl=canvas.getContext('webgl2',{alpha:true,antialias:false,premultipliedAlpha:true,preserveDrawingBuffer:readback,depth:false,stencil:false,powerPreference:'low-power'});
  ensure(gl,'WebGL2 unavailable; no generic fallback for Stage2 stock profile');
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
    const pass={map:program(gl,policy.profile.map.passes.Body,store),shadow:program(gl,policy.profile.enemy.passes.Shadow,store),
      enemy:program(gl,policy.profile.enemy.passes.Body,store),generic:program(gl,{vertex:VERT,fragment:FRAG},store)};
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
          if(name==='map'&&p!==stage.background||['shadow','enemy'].includes(name)&&p.source.bundle!==policy.profile.enemy.prefab||
            name==='generic'&&(p===stage.background||p.source.bundle===policy.profile.enemy.prefab))continue;
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
        ensure(!closed&&!gl.isContextLost()&&gl.drawingBufferWidth===1334&&gl.drawingBufferHeight===750,'Stage2 stock world surface held');
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

import {nativeSpriteAt} from '../native-assets/sprite-key.mjs';

const TARGET='134377281279792758';
export const STAGE1_SHA256='52f95b62602e2381e01af438e3ea293bbd003ddd57ded8ab2b7066448b53674d';
const PIN=/^[a-f\d]{64}$/;
const ID=/^-?\d+$/;
const bundlePattern=/^[a-f\d]{32}$/;
const filePattern=/^textures\/[a-f\d]{32}_-?\d+\.png$/;
const ident=[1,0,0,1,0,0,0];
const CAM_CLEAR=[.24264705181121826,.24264705181121826,.24264705181121826,0];
const bounded=(n)=>Number.isFinite(n)&&Math.abs(n)<=10000000;
const ensure=(yes,msg)=>{if(!yes) throw new Error(msg);};
const arrayOf=(a,n)=>Array.isArray(a)&&a.length===n&&a.every(bounded);
const uniqueMap=(arr,key,label)=>{
  ensure(Array.isArray(arr),'Expected array: '+label);
  const m=new Map();
  for(const x of arr){const k=key(x);ensure(!m.has(k),'Duplicate '+label+': '+k);m.set(k,x);}
  return m;
};

export function nativeProjection(camera,width,height) {
  ensure(Number.isInteger(width)&&Number.isInteger(height)&&width>0&&height>0,'Invalid framebuffer size');
  ensure(camera.orthographicSize===5 && arrayOf(camera.position,3)&&arrayOf(camera.viewport,4)&&arrayOf(camera.referenceWidthHeight,2)&&camera.referenceWidthHeight[0]===1334 && camera.referenceWidthHeight[1]===750 &&
         camera.position.every((v,i)=>v===[0,0,-100][i]) && camera.viewport.every((v,i)=>v===[0,0,1,1][i]),
         'Unknown serialized camera projection');
  const ratio=width/height;
  const halfHeight=camera.orthographicSize*Math.max(1,(1334/750)/ratio);
  const halfWidth=halfHeight*ratio;
  return Object.freeze({halfWidth,halfHeight,
    pixelsPerWorldUnit:height/(2*halfHeight),
    pixel:(x,y)=>[(x/halfWidth+1)*width/2,(1-y/halfHeight)*height/2]});
}
function compose(a,b) {
  return [
    a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],
    a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],
    a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5],a[6]+b[6],
  ];
}
function local(t) {
  const p=t.localPosition,s=t.localScale,q=t.localRotation;
  ensure(arrayOf(p,3)&&arrayOf(s,3)&&arrayOf(q,4)&&q[0]===0&&q[1]===0&&s[2]===1&&
    Math.abs(q[2]*q[2]+q[3]*q[3]-1)<1e-6, 'Unsupported nonplanar transform');
  const sin=2*q[2]*q[3], cos=1-2*q[2]*q[2];
  return [s[0]*cos,s[0]*sin,-s[1]*sin,s[1]*cos,p[0],p[1],p[2]];
}
function compilePrefab(p, files) {
  ensure(bundlePattern.test(p.bundle) && !p.openIssues?.length, 'Unverified prefab closure');
  const nodes=new Map(), go=new Map();
  for(const t of p.transformsParentFirst) {
    ensure(ID.test(t.pathId)&&ID.test(t.gameObjectPathId)&&
      typeof t.gameObjectActive==='boolean'&&!nodes.has(t.pathId)&&!go.has(t.gameObjectPathId),'Invalid transform identity');
    const parent=t.parentPathId===null?{world:ident,active:true}:nodes.get(t.parentPathId);
    ensure(parent,'Invalid parent order');
    const row={world:compose(parent.world,local(t)),active:parent.active&&t.gameObjectActive,index:nodes.size};
    nodes.set(t.pathId,row); go.set(t.gameObjectPathId,row);
  }
  ensure(nodes.has(p.rootTransformPathId)&&go.has(p.rootPathId),'Missing exact game root');
  const tex=uniqueMap(p.textures,x=>x.pathId,'texture');
  for(const t of tex.values()) {
    const binding=files[t.url];
    ensure(ID.test(t.pathId)&&Number.isSafeInteger(t.width)&&Number.isSafeInteger(t.height)&&
      t.width>0&&t.height>0&&t.width<=8192&&t.height<=8192&&[0,1].includes(t.filterMode)&&
      filePattern.test(t.url)&&t.url===`textures/${p.bundle}_${t.pathId}.png`&&
      binding&&PIN.test(binding.sha256)&&Number.isSafeInteger(binding.bytes)&&binding.bytes>0&&binding.bytes<=32*1024*1024,
      'Unverified or unsupported texture: '+t.pathId);
  }
  const meshes=uniqueMap(p.sprites,x=>x.pathId,'mesh');
  for(const s of meshes.values()) {
    const t=tex.get(s.texturePathId);
    ensure(t&&ID.test(s.pathId)&&s.localXY.length>=3&&s.localXY.length<=65535&&
      s.localXY.length===s.atlasPixelsBottomLeft.length&&s.localXY.every(a=>arrayOf(a,2))&&
      s.atlasPixelsBottomLeft.every(a=>arrayOf(a,2)&&a[0]>=-.01&&a[1]>=-.01&&a[0]<=t.width+.01&&a[1]<=t.height+.01)&&
      s.triangles.length>=3&&s.triangles.length%3===0&&s.triangles.every(i=>Number.isSafeInteger(i)&&i>=0&&i<s.localXY.length),'Invalid native sprite mesh');
  }
  const renderers=uniqueMap(p.spriteRenderers,x=>x.pathId,'renderer');
  for(const r of renderers.values()) {
    ensure(go.has(r.gameObjectPathId)&&
      (r.defaultSpritePathId===null||meshes.has(r.defaultSpritePathId))&&
      r.sortingLayer===0&&r.sortingLayerId===0&&Number.isSafeInteger(r.sortingOrder)&&
      typeof r.flipX==='boolean'&&typeof r.flipY==='boolean'&&arrayOf(['r','g','b','a'].map(k=>r.color[k]),4),'Unknown authored renderer fields');
  }
  const animators=p.animators.filter(a=>a.enabled&&go.get(a.gameObjectPathId)?.active);
  ensure(animators.length<=1,'Multiple active Animators not verified');
  if(animators.length) nativeSpriteAt(p,animators[0].pathId,null,0);
  return {source:p,go,tex,meshes,renderers,animator:animators[0]??null};
}

export function compileStage(input) {
  ensure(input?.schema==='starfall.monsters-defense.render-inputs/1'&&input.targetVersion===TARGET&&input.verifiedSourceAssets===true&&
      input.fixedFps===30&&input.grid.logicPixelsPerUnit===75&&Number.isSafeInteger(input.stageId),'Unsupported pinned native inputs');
  nativeProjection(input.camera,1334,750);
  const prefabs=uniqueMap(input.prefabs.map(x=>compilePrefab(x,input.files)),p=>p.source.bundle,'prefab');
  const background=prefabs.get(input.backgroundBundle);
  ensure(background&&!background.animator,'Missing static background');
  const units=new Map(Object.entries(input.units).map(([id,u])=>{
    const p=prefabs.get(u.bundle);
    ensure(/^\d+$/.test(id)&&p&&bounded(u.spriteScaleTenThousandths)&&u.spriteScaleTenThousandths>0,'Unverified card resource');
    return [Number(id),{...u,prefab:p}];
  }));
  return {input,prefabs,background,units};
}

/** Exact layout commands for one caller-supplied original display state, not simulated. */
export function frameCommands(stage,snapshot) {
  ensure(Number.isSafeInteger(snapshot?.frame)&&snapshot.frame>=0&&Array.isArray(snapshot.units)&&snapshot.units.length<=5000,
         'Invalid 30 Hz state snapshot');
  const cmds=[];
  const IDs=new Set();
  function submit(p,anim,at,global,order,isMap=false,u=null) {
    const change=anim===null?null:nativeSpriteAt(p.source,p.animator.pathId,anim,at);
    for(const r of p.renderers.values()){
      const node=p.go.get(r.gameObjectPathId);
      if(!node.active||!r.enabled) continue;
      const sprite=change?.rendererPathId===r.pathId?change.spritePathId:r.defaultSpritePathId;
      if(sprite===null)continue; // explicit null in exact SpriteRenderer/clip
      ensure(p.meshes.has(sprite),'Unresolved authored Sprite binding');
      const s=p.meshes.get(sprite), t=p.tex.get(s.texturePathId);
      const nativeFlip=[r.flipX?-1:1,0,0,r.flipY?-1:1,0,0,0];
      const matrix=compose(compose(global,node.world),nativeFlip);
      cmds.push({uid:u?.uid??null,cardId:u?.cardId??null,prefab:p.source.bundle,sprite:s.pathId,renderer:r.pathId,
             texture:t.url,matrix,keyTimeSeconds:change?.keyTimeSeconds??null,
             tint:['r','g','b','a'].map(k=>r.color[k]),
             order,siblingOrder:r.sortingOrder,hierarchyIndex:node.index,isMap});
    }
  }
  submit(stage.background,null,null,ident,-4000,true);
  for(const u of snapshot.units){
    ensure(u&&Number.isSafeInteger(u.uid)&&u.uid>0&&!IDs.has(u.uid)&&
      Number.isSafeInteger(u.cardId)&&arrayOf([u.x,u.y,u.z],3)&&['left','right'].includes(u.camp)&&
      (u.visible===undefined||typeof u.visible==='boolean')&&(u.flipX===undefined||typeof u.flipX==='boolean')&&
      (u.fixedSortingOrder===undefined||Number.isSafeInteger(u.fixedSortingOrder)),'Invalid/duplicate unit in exact snapshot');
    IDs.add(u.uid);
    const role=stage.units.get(u.cardId);
    ensure(role,'No verified prefab for card '+u.cardId);
    const p=role.prefab, anim=p.animator;
    ensure(anim?typeof u.stateName==='string'&&u.stateName.length>0&&bounded(u.animationElapsedSeconds)&&u.animationElapsedSeconds>=0:
      u.stateName==null&&u.animationElapsedSeconds==null,'Snapshot must carry authored Animator state and clock (or null for static)');
    if(u.visible===false)continue;
    const scale=Math.fround(role.spriteScaleTenThousandths/10000); // CARD_SCALE = 1, Unity Transform float32
    const flip=u.flipX??u.camp==='right';
    const f=[flip?-scale:scale,0,0,scale,Math.fround(u.x/75),Math.fround(u.y/75),Math.fround(u.z/75)];
    const sortingOrder=u.fixedSortingOrder??Math.ceil(-1000-u.y);
    submit(p,anim?u.stateName:null,u.animationElapsedSeconds,f,sortingOrder,false,u);
  }
  // Base draw group comes from Lua dynamic Y. Preserve authored sub-renderer priority in a prefab;
  // other perfectly tied objects use stable input identities, not a claim about Unity allocation order.
  return cmds.sort((a,b)=>a.order-b.order||b.matrix[6]-a.matrix[6]||
    (a.uid??0)-(b.uid??0)||a.siblingOrder-b.siblingOrder||a.hierarchyIndex-b.hierarchyIndex);
}

export function initialStageSnapshot(stage) {
  const units=[];
  for(const [cardId,u] of stage.units){
    if(u.encodedCell===undefined)continue;
    const [cols,rows]=stage.input.grid.size;
    const x=-cols*20+(Math.floor(u.encodedCell/100)-.5)*40;
    const y=rows*20+75-(u.encodedCell%100-.5)*40;
    ensure(Math.abs(x/75-u.scenePosition[0])<1e-12&&Math.abs(y/75-u.scenePosition[1])<1e-12,'Stage placement provenance mismatch');
    const a=u.prefab.animator;
    const defaultState=a?u.prefab.source.controllers.find(c=>c.pathId===a.controllerPathId)?.defaultState:null;
    ensure(!a||defaultState==='idle','Unverified stage Start display state');
    units.push({uid:cardId,cardId,x,y,z:0,camp:'left',stateName:defaultState,animationElapsedSeconds:a?0:null,cell:u.encodedCell});
  }
  // Test/display-only IDs in original Stage Init positions; do not represent runtime IDs.
  return {frame:0,units};
}

export const VERT=`#version 300 es
in vec2 pos; in vec2 uv; uniform mat3 xf; uniform vec2 ext; out vec2 st;
void main(){vec3 p=xf*vec3(pos,1.0);gl_Position=vec4(p.xy/ext,0.0,1.0);st=uv;}`;
export const FRAG=`#version 300 es
precision highp float; in vec2 st; uniform sampler2D tex; uniform vec4 tint; out vec4 px;
void main(){px=texture(tex,st)*tint;}`;
function shaders(gl) {
  function c(kind,src){
    const s=gl.createShader(kind);gl.shaderSource(s,src);gl.compileShader(s);
    ensure(gl.getShaderParameter(s,gl.COMPILE_STATUS),'Shader compilation: '+gl.getShaderInfoLog(s));return s;
  }
  const vs=c(gl.VERTEX_SHADER,VERT), fs=c(gl.FRAGMENT_SHADER,FRAG), p=gl.createProgram();
  gl.attachShader(p,vs);gl.attachShader(p,fs);gl.linkProgram(p);
  gl.deleteShader(vs);gl.deleteShader(fs);
  ensure(gl.getProgramParameter(p,gl.LINK_STATUS),'Shader link: '+gl.getProgramInfoLog(p));
  return p;
}
async function bytes(url,pin,size=null,signal=null) {
  ensure(PIN.test(pin),'Expected exact SHA-256 digest');
  const rsp=await fetch(url,{signal,redirect:'error',credentials:'same-origin'});
  ensure(rsp.ok&&rsp.type!=='opaque','Unable to open local pinned asset: '+url.pathname);
  const raw=await rsp.arrayBuffer();
  ensure(raw.byteLength>0&&raw.byteLength<=32*1024*1024&&(size===null||raw.byteLength===size),'Asset byte count mismatch');
  const hex=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw)),x=>x.toString(16).padStart(2,'0')).join('');
  ensure(pin===hex,'Asset SHA mismatch: '+url.pathname);
  return raw;
}

export async function createStageRenderer(canvas,indexURL,{indexSha256,signal=null,readback=false}={}) {
  const url=new URL(indexURL,location.href);
  ensure(url.origin===location.origin&&!url.username&&!url.password&&/^https?:$/.test(url.protocol),
    'Renderer requires local same-origin HTTP(S) stage input');
  const stage=compileStage(JSON.parse(new TextDecoder().decode(await bytes(url,indexSha256,null,signal))));
  const gl=canvas.getContext('webgl2',{alpha:true,antialias:false,premultipliedAlpha:true,preserveDrawingBuffer:readback,
    depth:false,stencil:false,powerPreference:'low-power'});
  ensure(gl,'WebGL 2 unavailable: no placeholder renderer');
  let destroyed=false, program;
  let textures=new Map(), meshes=new Map();
  try {
    program=shaders(gl);
    gl.useProgram(program);
    gl.uniform1i(gl.getUniformLocation(program,'tex'),0);
    gl.disable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.disable(gl.DITHER);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.NONE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
    const pos=gl.getAttribLocation(program,'pos'), uv=gl.getAttribLocation(program,'uv');
    const uXf=gl.getUniformLocation(program,'xf'), uExt=gl.getUniformLocation(program,'ext'), uTint=gl.getUniformLocation(program,'tint');
    for(const p of stage.prefabs.values()){
      for(const t of p.tex.values()){
        const imageURL=new URL(t.url,url);
        const pin=stage.input.files[t.url];
        const raw=await bytes(imageURL,pin.sha256,pin.bytes,signal);
        const img=await createImageBitmap(new Blob([raw],{type:'image/png'}),{colorSpaceConversion:'none',premultiplyAlpha:'none'});
        try {
          ensure(img.width===t.width&&img.height===t.height,'PNG decode dimension mismatch: '+t.url);
          const tex=gl.createTexture();textures.set(t.url,tex);
          gl.bindTexture(gl.TEXTURE_2D,tex);
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
          for(const pname of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D,pname,t.filterMode===0?gl.NEAREST:gl.LINEAR);
          gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);
        } finally {img.close();}
      }
      for(const s of p.meshes.values()){
        const t=p.tex.get(s.texturePathId);
        const d=new Float32Array(s.localXY.length*4);
        s.localXY.forEach(([x,y],i)=>{
          const [u,v]=s.atlasPixelsBottomLeft[i];
          d.set([x,y,u/t.width,1-v/t.height],i*4);
        });
        const vao=gl.createVertexArray(), vbo=gl.createBuffer(), ibo=gl.createBuffer();
        meshes.set(p.source.bundle+'/'+s.pathId,{vao,vbo,ibo,count:s.triangles.length});
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER,vbo);gl.bufferData(gl.ARRAY_BUFFER,d,gl.STATIC_DRAW);
        gl.enableVertexAttribArray(pos);gl.vertexAttribPointer(pos,2,gl.FLOAT,false,16,0);
        gl.enableVertexAttribArray(uv);gl.vertexAttribPointer(uv,2,gl.FLOAT,false,16,8);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ibo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,Uint16Array.from(s.triangles),gl.STATIC_DRAW);
      }
    }
    ensure(gl.getError()===gl.NO_ERROR,'WebGL source buffer setup failed');
    const destroy=()=>{
      if(destroyed)return;
      destroyed=true;
      for(const t of textures.values())gl.deleteTexture(t);
      for(const m of meshes.values()){gl.deleteVertexArray(m.vao);gl.deleteBuffer(m.vbo);gl.deleteBuffer(m.ibo);}
      gl.deleteProgram(program);
      textures.clear();meshes.clear();
    };
    return Object.freeze({stage, destroy, initialSnapshot:()=>initialStageSnapshot(stage),
      resize(width,height){
        ensure(!destroyed&&!gl.isContextLost(),'Renderer unavailable');
        const p=nativeProjection(stage.input.camera,width,height);
        const cap=gl.getParameter(gl.MAX_VIEWPORT_DIMS);
        ensure(width<=cap[0]&&height<=cap[1]&&width*height<=16*1024*1024,'Framebuffer too large');
        if(canvas.width!==width)canvas.width=width;
        if(canvas.height!==height)canvas.height=height;
        return p;
      },
      render(snapshot){
        ensure(!destroyed&&!gl.isContextLost(),'Renderer unavailable');
        const cmds=frameCommands(stage,snapshot);
        const w=gl.drawingBufferWidth,h=gl.drawingBufferHeight;
        const p=nativeProjection(stage.input.camera,w,h);
        gl.viewport(0,0,w,h);gl.clearColor(...CAM_CLEAR);gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(program);
        gl.uniform2f(uExt,p.halfWidth,p.halfHeight);gl.activeTexture(gl.TEXTURE0);
        for(const q of cmds){
          const m=meshes.get(q.prefab+'/'+q.sprite);
          gl.bindVertexArray(m.vao);
          gl.bindTexture(gl.TEXTURE_2D,textures.get(q.texture));
          const [a,b,c,d,x,y]=q.matrix;
          gl.uniformMatrix3fv(uXf,false,[a,b,0,c,d,0,x,y,1]);
          gl.uniform4fv(uTint,q.tint);
          gl.drawElements(gl.TRIANGLES,m.count,gl.UNSIGNED_SHORT,0);
        }
        ensure(gl.getError()===gl.NO_ERROR,'Native stage draw failed');
        return {commands:cmds,projection:p};
      },
      rgbaReadback(){
        ensure(readback&&!destroyed&&!gl.isContextLost(),'Readback not enabled');
        const w=gl.drawingBufferWidth,h=gl.drawingBufferHeight;
        const dst=new Uint8Array(w*h*4);
        gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,dst);
        return dst; // lower-left first, raw physical pixels
      }});
  } catch(e) {
    for(const t of textures.values())gl.deleteTexture(t);
    for(const m of meshes.values()){gl.deleteVertexArray(m.vao);gl.deleteBuffer(m.vbo);gl.deleteBuffer(m.ibo);}
    if(program)gl.deleteProgram(program);
    throw e;
  }
}

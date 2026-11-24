/** Private exact 7-step popup blur. Allocate only packed R11F_G11F_B10F intermediates. */
const SHA='43b5251dbd9e5de9df12c7d0fc7d524b6f55f5dbece4c256c103712cc6ba8aa3';
const objectSHA='31edb8c93fc7c913612182480d791130d3e451e71c1037f050724d8687f7d451';
const sourcePins=[
  '743cf2f4dd43b13f6e2ba07aaf2bddd6157a6919408b2c17b5bca4614b622996',
  'dea724b38be38dfb516da8b3b1cc52b7b77a06b3dffe18444cc5574c1bb7fa32',
  '4ab4e5de44b65e7bf4357d68c83098725fd0ebcf25b9dd8d850ad2a120091fab',
];
const check=(ok,message)=>{if(!ok)throw Error(message);};
const packedUnavailable=()=>Object.assign(Error('Packed float blur unavailable; no lower precision fallback'),{code:'packed-float-unavailable'});
const digest=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),v=>v.toString(16).padStart(2,'0')).join('');
const vbytes=s=>new TextEncoder().encode(s);
export const ORIGINAL_BLUR_PROGRAMS=Object.freeze({bytesSHA256:SHA,shaderObjectSHA256:objectSHA});
export async function verifiedPrograms(bytes){
  check(bytes instanceof ArrayBuffer&&bytes.byteLength>0&&bytes.byteLength<32768&&await digest(bytes)===SHA,'Original packed blur program bytes differ');
  const m=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  check(m.schema==='starfall.blur-programs/1'&&m.shaderObjectSha===objectSHA&&m.programs.length===3&&m.programPins.join(',')===sourcePins.join(','),'Wrong source shader identity');
  const out=[];
  for(let i=0;i<3;i++){
    const s=m.programs[i];
    check(await digest(vbytes(s))===sourcePins[i]&&s.startsWith('#ifdef VERTEX\n'),'Original pass differs');
    const parts=s.slice('#ifdef VERTEX'.length).split('#ifdef FRAGMENT');
    check(parts.length===2,'Unqualified source stage layout');
    const [v,f]=parts.map(x=>{const n=x.lastIndexOf('#endif');check(n>0,'Unclosed source stage');return x.slice(0,n).trim();});
    // Select the shader's own standards-compatible uniform declaration branch.
    const from='#define UNITY_SUPPORTS_UNIFORM_LOCATION 1';
    check(f.split(from).length===2,'Original standard binding branch missing');
    out.push(Object.freeze([v,f.replace(from,'#define UNITY_SUPPORTS_UNIFORM_LOCATION 0')]));
  }
  return Object.freeze(out);
}
export function originalPassSchedule(w,h){
  check(Number.isSafeInteger(w)&&Number.isSafeInteger(h)&&w>=4&&h>=4&&w<=4096&&h<=4096&&w*h<=4096*2160,'Unsupported source framebuffer extent');
  const width=w>>2,height=h>>2;
  return Object.freeze({width,height,passes:Object.freeze([0,1,2,1,2,1,2].map((pass,i)=>
    Object.freeze({pass,step:i===0?null:(i-1)>>1,from:i===0?'source':i%2?'ping':'pong',to:i%2?'pong':'ping'})))});
}
function link(gl,text){
  const p=gl.createProgram(),sh=[];
  if(!p)throw packedUnavailable();
  try{
    for(let i=0;i<2;i++){
      const q=gl.createShader(i?gl.FRAGMENT_SHADER:gl.VERTEX_SHADER);
      if(!q)throw packedUnavailable();
      sh.push(q);
      gl.shaderSource(q,text[i]);gl.compileShader(q);
      if(!gl.getShaderParameter(q,gl.COMPILE_STATUS))throw packedUnavailable();
      gl.attachShader(p,q);
    }
    gl.linkProgram(p);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw packedUnavailable();
    return p;
  }catch(err){gl.deleteProgram(p);throw err;}
  finally{for(const q of sh)gl.deleteShader(q);}
}
const mat=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
const quad=new Float32Array([-1,-1,0,1,0,0,1,-1,0,1,1,0,-1,1,0,1,0,1,1,1,0,1,1,1]);
/**
 * Requires its own WebGL2 context (the only sharing is the injected same-context presenter).
 * Low-resolution RGB float texture is retained until removal of this exact popup.
 */
export async function createPackedBlur(gl,programBytes){
  const host=globalThis.location;
  if(host)check(host.protocol==='http:'&&host.hostname==='127.0.0.1'&&!host.username&&!host.password,'Private 127.0.0.1 only');
  const code=await verifiedPrograms(programBytes);
  if(!gl||typeof gl.createVertexArray!=='function'||gl.isContextLost()||
     !gl.getExtension('EXT_color_buffer_float')||!gl.getExtension('OES_texture_float_linear'))
    throw packedUnavailable();
  let closed=false,live=new Set(),passes=[],vbo=null,vao=null;
  function dispose(){if(closed)return;closed=true;
    for(const q of [...live])q.dispose();
    for(const p of passes)gl.deleteProgram(p);
    if(vbo)gl.deleteBuffer(vbo);if(vao)gl.deleteVertexArray(vao);
  }
  try{
    for(const c of code)passes.push(link(gl,c));
    vbo=gl.createBuffer();vao=gl.createVertexArray();
    if(!vbo||!vao)throw packedUnavailable();
    gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,vbo);
    gl.bufferData(gl.ARRAY_BUFFER,quad,gl.STATIC_DRAW);
    if(gl.getError()!==gl.NO_ERROR)throw packedUnavailable();
  }catch(err){dispose();throw err;}
  function capture(data,w,h){
    const schedule=originalPassSchedule(w,h);
    if(closed||gl.isContextLost())throw packedUnavailable();
    check(data instanceof Float32Array&&data.length===w*h*4,'Source frame data is not qualified');
    const max=gl.getParameter(gl.MAX_TEXTURE_SIZE);
    if(w>max||h>max||gl.getError()!==gl.NO_ERROR)throw packedUnavailable();
    const {width:tw,height:th}=schedule, textures={},keep=new Set();
    let fb=null;
    function startTexture(name,x,y,type,fmt,source){
      const q=gl.createTexture();if(!q)throw packedUnavailable();
      textures[name]=q;
      gl.bindTexture(gl.TEXTURE_2D,q);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D,0,type,x,y,0,fmt,gl.FLOAT,source);
      if(gl.getError()!==gl.NO_ERROR)throw packedUnavailable();
    }
    try{
      gl.activeTexture(gl.TEXTURE0);gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,vbo);
      gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER,null);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT,4);gl.pixelStorei(gl.UNPACK_ROW_LENGTH,0);gl.pixelStorei(gl.UNPACK_SKIP_PIXELS,0);gl.pixelStorei(gl.UNPACK_SKIP_ROWS,0);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.NONE);
      startTexture('source',w,h,gl.RGBA32F,gl.RGBA,data);
      for(const key of ['ping','pong'])startTexture(key,tw,th,gl.R11F_G11F_B10F,gl.RGB,null);
      fb=gl.createFramebuffer();if(!fb)throw packedUnavailable();
      gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
      gl.viewport(0,0,tw,th);
      for(const x of [gl.BLEND,gl.DITHER,gl.STENCIL_TEST,gl.DEPTH_TEST,gl.CULL_FACE,gl.SCISSOR_TEST,gl.RASTERIZER_DISCARD])gl.disable(x);
      gl.colorMask(true,true,true,true);
      for(const op of schedule.passes){
        const p=passes[op.pass];
        gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,textures[op.to],0);
        if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw packedUnavailable();
        gl.useProgram(p);gl.bindTexture(gl.TEXTURE_2D,textures[op.from]);
        const u=n=>{const l=gl.getUniformLocation(p,n);if(l===null)throw packedUnavailable();return l;};
        const [sw,sh]=op.from==='source'?[w,h]:[tw,th];
        gl.uniform1i(u('_MainTex'),0);gl.uniform4f(u('_MainTex_TexelSize'),1/sw,1/sh,sw,sh);
        if(op.step!==null)gl.uniform1f(u('_DownSampleValue'),op.step);
        for(const n of ['hlslcc_mtx4x4unity_ObjectToWorld[0]','hlslcc_mtx4x4unity_MatrixVP[0]'])
          gl.uniform4fv(u(n),mat);
        const configure=[[gl.getAttribLocation(p,'in_POSITION0'),4,0],[gl.getAttribLocation(p,'in_TEXCOORD0'),2,16]];
        for(const [i,n,o] of configure){
          if(i<0)throw packedUnavailable();
          gl.enableVertexAttribArray(i);gl.vertexAttribPointer(i,n,gl.FLOAT,false,24,o);
        }
        gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
        for(const [i] of configure)gl.disableVertexAttribArray(i);
        if(gl.getError()!==gl.NO_ERROR||gl.isContextLost())throw packedUnavailable();
      }
      keep.add(textures.ping);
      let gone=false;
      const token=Object.freeze({
        present(presenter){
          if(gone||closed||gl.isContextLost())throw packedUnavailable();
          check(typeof presenter==='function','Private same-context destination required');
          check(presenter(gl,textures.ping,Object.freeze({width:tw,height:th,sourceWidth:w,sourceHeight:h,format:'rgb111110float',orientation:'bottom-left'}))===true,'Destination did not acknowledge packed float presentation');
          if(gl.getError()!==gl.NO_ERROR)throw packedUnavailable();
          return true;
        },
        dispose(){if(!gone){gone=true;gl.deleteTexture(textures.ping);live.delete(token);}},
      });
      live.add(token);return token;
    }finally{
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindTexture(gl.TEXTURE_2D,null);gl.bindVertexArray(null);
      if(fb)gl.deleteFramebuffer(fb);
      for(const q of Object.values(textures))if(!keep.has(q))gl.deleteTexture(q);
    }
  }
  return Object.freeze({capture,dispose});
}

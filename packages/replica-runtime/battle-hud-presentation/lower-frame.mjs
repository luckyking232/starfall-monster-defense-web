/** Reconstructed lower-frame compositor. Not connected to the native popup capture authority. */
import {PROFILE} from '../presentation-blur-bridge/bridge.mjs';
import {DPS_PREVIEW} from './dps-preview.mjs';
import {MASK_PREVIEW} from './portrait-mask.mjs';
export const LAYER_STORAGE='RGBA8_unorm_non_sRGB_storage_with_authored_sRGB_RGB_and_straight_alpha';
export const LOWER_COLOR='world-hud-straight-srgb-textures-to-linear-opaque-output/1';
export const LOWER_VERT=`#version 300 es
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0.0,1.0);}`;
export const LOWER_FRAG=`#version 300 es
precision highp float; uniform highp sampler2D worldTex; uniform highp sampler2D hudTex;
layout(location=0) out vec4 rgba;
vec3 toLinear(vec3 v) { return mix(v/12.92,pow((v+0.055)/1.055,vec3(2.4)),greaterThan(v,vec3(0.04045))); }
void main(){ivec2 p=ivec2(gl_FragCoord.xy);vec4 w=texelFetch(worldTex,p,0),h=texelFetch(hudTex,p,0);
rgba=vec4(mix(toLinear(w.rgb),toLinear(h.rgb),h.a),w.a);}`;
const check=(v,m)=>{if(!v)throw Error(m);};
const SHA=/^[0-9a-f]{64}$/u;
const {width:W,height:H}=PROFILE;
function exactPlan(join,world){
 return join?.packet===world?.packet&&join?.frame===world?.frame&&
  world.packet?.state?.paused===false&&world.packet?.state?.terminal===null&&
  world.frame?.viewport?.width===W&&world.frame.viewport.height===H&&world.frame?.nativeRuntimePose===false&&
  join?.receipt?.pairedSamePreviousDisplay===true&&join?.receipt?.previousRequestId===world.packet.requestId&&
  join?.receipt?.displayFrame===world.frame.display.displayFrame&&join?.receipt?.fixedFrame===world.frame.display.fixedFrame&&
  join?.receipt?.kind==='reconstructed-lower-battle-HUD-plan-not-GL-capture'&&
  Array.isArray(join.plan?.held)&&join.plan.held.length===0&&join.plan?.dpsLane===DPS_PREVIEW&&join.plan?.portraitLane===MASK_PREVIEW&&
  join.receipt.nativeUnityFrame===false&&join.receipt.blurSourceQualified===false;
}
/** Registers a trusted producer and one independently qualified context proof at initialization, never from popup data. */
export function createLowerFrameSource({admission,graphics,hostProof}={}){
 check(hostProof&&hostProof.independentProducerVerified===true&&SHA.test(hostProof.sourceEvidenceSha256)&&
  hostProof.colorPolicy===LOWER_COLOR&&
  typeof admission?.verifyWorldHud==='function'&&typeof graphics?.capture==='function'&&graphics.context,'No admitted same-context GPU producer');
 const device=graphics.context,sha=hostProof.sourceEvidenceSha256;
 let live=null,closed=false;
 const minted=new WeakMap();
 function retain({world,join,textures}){
  check(!closed,'Source closed');
  // No stale capture after an unsupported frame; update is fail-closed.
  live=null;
  check(exactPlan(join,world),'Unqualified or mismatched reconstructed lower HUD');
  check(textures?.context===device&&textures.colorPolicy===LOWER_COLOR&&textures.orientation==='bottom-left'&&
   textures.storage===LAYER_STORAGE&&textures.worldFrame===world.frame&&textures.hudReceipt===join.receipt&&
   textures.prePopup===true&&textures.opaqueWorld===true&&textures.width===W&&textures.height===H&&
   textures.worldTexture&&textures.hudTexture&&textures.worldTexture!==textures.hudTexture&&
   admission.verifyWorldHud({world,join,textures})===true,'GPU layers lack independently qualified exact local outputs');
  live=Object.freeze({world,join,textures});return true;
 }
 function acquire(binding,signal){
  const a=live;
  check(!closed&&a&&!signal?.aborted&&binding.previousPacket===a.world.packet&&binding.previousFrame===a.world.frame&&
    binding.openingPacket.state.paused===true&&binding.openingPacket.state.choice!==null,'Capture does not match popup predecessor');
  check(admission.verifyWorldHud(a)===true,'Producer texture retention lost');
  const rgba=graphics.capture(a.textures);
  check(rgba instanceof Float32Array&&rgba.buffer instanceof ArrayBuffer&&rgba.length===W*H*4&&
   rgba.every((v,i)=>Number.isFinite(v)&&(i%4===3?v===1:v>=0&&v<=1)),'GPU linear opaque RGBA32F readback missing');
  const record=Object.freeze({binding,rgba,gl:device,captureProfile:PROFILE,nativeUnityFrame:false,worldHudPassesCommitted:true,
    currentPopupPresent:false,hudPacket:a.world.packet,hudDisplay:a.world.frame.display,worldFrame:a.world.frame,sourceEvidenceSha256:sha});
  minted.set(record,a);return record;
 }
 const authority=Object.freeze({acquire,qualify(r,b){return !closed&&r?.binding===b&&live&&minted.get(r)===live;}});
 return Object.freeze({retain,authority,invalidate(){live=null;},close(){live=null;closed=true;}});
}
export function createLowerGpuPipeline(gl){
 check(gl&&!gl.isContextLost()&&gl.getExtension('EXT_color_buffer_float'),'Float composite GL held');
 const make=(kind,code)=>{
   const s=gl.createShader(kind);gl.shaderSource(s,code);gl.compileShader(s);
   if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){gl.deleteShader(s);throw Error('Lower-frame shader failed');}return s;
 };
 const vs=make(gl.VERTEX_SHADER,LOWER_VERT),fs=make(gl.FRAGMENT_SHADER,LOWER_FRAG);
 const pg=gl.createProgram();gl.attachShader(pg,vs);gl.attachShader(pg,fs);gl.linkProgram(pg);gl.deleteShader(vs);gl.deleteShader(fs);
 check(gl.getProgramParameter(pg,gl.LINK_STATUS),'Lower-frame shader link held');
 const fn=gl.createFramebuffer(),tex=gl.createTexture(),vao=gl.createVertexArray();
 check(fn&&tex&&vao,'Float framebuffer unavailable');
 const drawState=()=>({
  draw:gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING),read:gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),
 });
 const restoreFramebuffer=f=>{gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,f.draw);gl.bindFramebuffer(gl.READ_FRAMEBUFFER,f.read);};
 const old=drawState(),oldTex=gl.getParameter(gl.TEXTURE_BINDING_2D);
 try{
  gl.bindTexture(gl.TEXTURE_2D,tex);
  gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA32F,W,H);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
  gl.bindFramebuffer(gl.FRAMEBUFFER,fn);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
  check(gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE&&gl.getError()===gl.NO_ERROR,'Float framebuffer incomplete');
 }catch(e){gl.deleteFramebuffer(fn);gl.deleteTexture(tex);gl.deleteProgram(pg);gl.deleteVertexArray(vao);throw e;}
 finally{restoreFramebuffer(old);gl.bindTexture(gl.TEXTURE_2D,oldTex);}
 let disposed=false;
 function capture(p){
  check(!disposed&&p.context===gl&&gl.isTexture(p.worldTexture)&&gl.isTexture(p.hudTexture)&&!gl.isContextLost(),'Foreign texture or lost context');
  const previous=drawState(), viewport=gl.getParameter(gl.VIEWPORT),program=gl.getParameter(gl.CURRENT_PROGRAM),
   vertex=gl.getParameter(gl.VERTEX_ARRAY_BINDING),textureUnit=gl.getParameter(gl.ACTIVE_TEXTURE),
   color=gl.getParameter(gl.COLOR_WRITEMASK),pack=gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
  const getTexture=i=>{gl.activeTexture(gl.TEXTURE0+i);return gl.getParameter(gl.TEXTURE_BINDING_2D);};
  const textures=[getTexture(0),getTexture(1)],
   caps=[gl.BLEND,gl.DITHER,gl.SCISSOR_TEST,gl.DEPTH_TEST,gl.STENCIL_TEST,gl.CULL_FACE,gl.RASTERIZER_DISCARD].map(x=>[x,gl.isEnabled(x)]),
   savedPacking=[gl.PACK_ALIGNMENT,gl.PACK_ROW_LENGTH,gl.PACK_SKIP_ROWS,gl.PACK_SKIP_PIXELS].map(x=>[x,gl.getParameter(x)]);
  try{
   gl.bindFramebuffer(gl.FRAMEBUFFER,fn);gl.viewport(0,0,W,H);gl.useProgram(pg);gl.bindVertexArray(vao);
   for(const [x] of caps)gl.disable(x);
   gl.colorMask(true,true,true,true);
   for(const [i,[texture,name]] of [[p.worldTexture,'worldTex'],[p.hudTexture,'hudTex']].entries()){
    gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,texture);gl.uniform1i(gl.getUniformLocation(pg,name),i);
   }
   gl.drawArrays(gl.TRIANGLES,0,3);
   const samples=new Float32Array(W*H*4);
   gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);
   for(const [x] of savedPacking)gl.pixelStorei(x,x===gl.PACK_ALIGNMENT?4:0);
   gl.readPixels(0,0,W,H,gl.RGBA,gl.FLOAT,samples);
   check(gl.getError()===gl.NO_ERROR&&samples.every((x,i)=>i%4===3?x===1:Number.isFinite(x)&&x>=0&&x<=1),
    'Unqualified real lower-frame output');
   return samples;
  }finally{
   restoreFramebuffer(previous);gl.viewport(...viewport);gl.useProgram(program);gl.bindVertexArray(vertex);
   for(const [i,t] of textures.entries()){gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,t);}
   gl.activeTexture(textureUnit);for(const [x,enabled] of caps)enabled?gl.enable(x):gl.disable(x);
   gl.colorMask(...color);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,pack);
   for(const [x,v] of savedPacking)gl.pixelStorei(x,v);
  }
 }
 return Object.freeze({context:gl,capture,dispose(){if(!disposed){disposed=true;gl.deleteFramebuffer(fn);gl.deleteTexture(tex);gl.deleteProgram(pg);gl.deleteVertexArray(vao);}}});
}

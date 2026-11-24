import {openBattleHudLayout,LAYOUT_SHA} from '../../../../battle-hud-presentation/plan.mjs';
import {openHudPreviewPainter} from './paint-stage1.mjs';
import {createLowerFrameSource,createLowerGpuPipeline,LOWER_COLOR,LAYER_STORAGE} from '../../../../battle-hud-presentation/lower-frame.mjs';
import {createReconstructedPopupBlur,DESTINATION} from '../../../../presentation-blur-bridge/bridge.mjs';
import {ORIGINAL_BLUR_PROGRAMS} from '../../../../blur-presentation/webgl.mjs';
import {fetchLocalBytes} from '../../../../offline-shell/paint.mjs';
import {capabilities,captureGlState,restoreGlState} from '../../../presentation-capability/scene-profiles/stage1-hud/gl-state.mjs';
import {createCanonicalHudAuthority} from '../../../presentation-capability/scene-profiles/stage1-hud/hud-authority.mjs';
const W=1334,H=750;
const require=(ok,msg)=>{if(!ok)throw Error(msg);};
const j=b=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));
export const PRESENTER_FRAG=`#version 300 es
precision highp float; uniform highp sampler2D src; out vec4 pixel;
vec3 encode(vec3 v){return mix(12.92*v,1.055*pow(v,vec3(1.0/2.4))-0.055,greaterThan(v,vec3(0.0031308)));}
void main(){vec3 v=clamp(texture(src,gl_FragCoord.xy/vec2(1334.,750.)).rgb,0.,1.);pixel=vec4(encode(v),1.);}`;
import {LOWER_VERT} from '../../../../battle-hud-presentation/lower-frame.mjs';
function shaderProgram(gl){
 const make=(k,src)=>{const x=gl.createShader(k);gl.shaderSource(x,src);gl.compileShader(x);require(gl.getShaderParameter(x,gl.COMPILE_STATUS),'Presenter shader held');return x;};
 const p=gl.createProgram(),v=make(gl.VERTEX_SHADER,LOWER_VERT),f=make(gl.FRAGMENT_SHADER,PRESENTER_FRAG);
 gl.attachShader(p,v);gl.attachShader(p,f);gl.linkProgram(p);gl.deleteShader(v);gl.deleteShader(f);
 require(gl.getProgramParameter(p,gl.LINK_STATUS),'Presenter link held');return p;
}
export async function openStage1HudLayer({worldCanvas,hudCanvas,frameProof}){
 const [layout,bind,stage,programBytes,lowerProof,presenterProof]=await Promise.all([
   fetchLocalBytes('/battle-hud-presentation/LAYOUT.json',LAYOUT_SHA).then(b=>openBattleHudLayout(new Uint8Array(b))),
   fetchLocalBytes('/hud-renderer/bindings.json','1b06eb5d2c4684b59f7644c1000337b329493b9366c09a0559140fea86d1a837').then(j),
   fetchLocalBytes('/source-runtime/stage-config.json','663e0421e80f077094b8ad13ded7f9f7070629bec3ae81f3738c71c0182b6ab4').then(j),
   fetchLocalBytes('/blur-presentation/programs.json',ORIGINAL_BLUR_PROGRAMS.bytesSHA256),
   fetchLocalBytes('/battle-hud-presentation/LOWER-GLES.json','14c65a6bd38221c246d14b6f1c8d84a8bec8b86b5efee26bca67c8da0aae6113').then(j),
   fetchLocalBytes('/qualified-game/presentation-capability/scene-profiles/stage1-hud/PRESENTER-GLES.json',frameProof).then(j),
 ]);
 const painter=await openHudPreviewPainter(hudCanvas,layout,{nativeFace:true});
 const model=createCanonicalHudAuthority({layout,bindingConfig:bind,stageConfig:stage,fontManifest:painter.fontManifest});
 const gl=worldCanvas.getContext('webgl2');
 let latest=null,blurApi=null,lower=null,presenter=null,glTextures=null,error=null,blurError=null,popupReason=null,disposed=false,hudVisible=false,blurVisible=false;
 const flags=()=>capabilities(gl);
 const state=()=>captureGlState(gl,[0,1]);
 const restore=s=>restoreGlState(gl,s);
 function show(){hudCanvas.dataset.hudVisible=hudVisible&&!blurVisible?'true':'false';}
 function initialize(){
  require(gl&&hudCanvas.getContext('2d').getContextAttributes().colorSpace==='srgb'&&!gl.isContextLost()&&gl.drawingBufferWidth===W&&gl.drawingBufferHeight===H&&gl.drawingBufferColorSpace==='srgb'&&
   gl.getExtension('EXT_color_buffer_float')&&gl.getExtension('OES_texture_float_linear'),'设备未通过浮点画布验证');
  require(lowerProof.schema==='fixed-frame-lower-composite-GLES-qualification-fixture/1'&&
   lowerProof.fixedFrame===296&&lowerProof.packedSevenPassOutput.passCount===7&&
   presenterProof?.schema==='canonical-stage1-reconstruction-presenter-color-witness/1'&&presenterProof.browserProof===false,'独立源合成证据不匹配');
  const old=state();lower=createLowerGpuPipeline(gl);
  try{
   const program=shaderProgram(gl),vao=gl.createVertexArray();
   presenter={program,vao};
   verifyPresenter();
   glTextures=[gl.createTexture(),gl.createTexture()];
   for(const t of glTextures){
    gl.bindTexture(gl.TEXTURE_2D,t);gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA8,W,H);
    for(const p of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,p,gl.NEAREST);
   }
  }finally{restore(old);}
  const sourceSha='14c65a6bd38221c246d14b6f1c8d84a8bec8b86b5efee26bca67c8da0aae6113';
  const source=createLowerFrameSource({graphics:lower,hostProof:{independentProducerVerified:true,sourceEvidenceSha256:sourceSha,colorPolicy:LOWER_COLOR},
   admission:{verifyWorldHud(byteBound){return latest?.world===byteBound.world&&latest?.join===byteBound.join&&latest?.textures===byteBound.textures;}}});
  // Runtime context/format probes gate rendering. EGL proof only admits shader arithmetic; not native pixels.
  const destSha=frameProof;
  blurApi={source,bridge:createReconstructedPopupBlur({programBytes,
    hostVerifiedPins:[{source:sourceSha,destination:destSha}],sourceAuthority:source.authority,
    destinationAuthority:{
      qualify(context,profile,pin){return context===gl&&profile===DESTINATION&&pin===frameProof&&!gl.isContextLost()&&gl.drawingBufferWidth===W&&gl.drawingBufferHeight===H;},
      present({gl:target,texture}){
        if(target!==gl||target.isContextLost())return false;
        const old=state();try{
          gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,W,H);
          for(const p of flags())gl.disable(p);
          gl.colorMask(true,true,true,true);gl.useProgram(presenter.program);gl.bindVertexArray(presenter.vao);
          gl.bindSampler(old.active-gl.TEXTURE0,null);
          gl.bindTexture(gl.TEXTURE_2D,texture);gl.uniform1i(gl.getUniformLocation(presenter.program,'src'),old.active-gl.TEXTURE0);
          gl.drawArrays(gl.TRIANGLES,0,3);return gl.getError()===gl.NO_ERROR;
        }finally{restore(old);}
      },
    }})};
 }
 function verifyPresenter(){
  const save=state(),f=gl.createFramebuffer(),src=gl.createTexture(),dst=gl.createTexture();
  const px=new Uint8Array(4);
  try{
    gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER,null);gl.pixelStorei(gl.UNPACK_ROW_LENGTH,0);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS,0);gl.pixelStorei(gl.UNPACK_SKIP_ROWS,0);
    gl.bindTexture(gl.TEXTURE_2D,dst);gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA8,1,1);
    gl.bindFramebuffer(gl.FRAMEBUFFER,f);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,dst,0);
    require(gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE,'本机颜色验证 framebuffer 不完整');
    gl.bindTexture(gl.TEXTURE_2D,src);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB10_A2,1,1,0,gl.RGBA,gl.UNSIGNED_INT_2_10_10_10_REV,
     new Uint32Array([184|(460<<10)|(768<<20)|(3<<30)]));
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.viewport(0,0,1,1);gl.useProgram(presenter.program);gl.bindVertexArray(presenter.vao);
    for(const x of flags())gl.disable(x);
    gl.colorMask(true,true,true,true);
    gl.uniform1i(gl.getUniformLocation(presenter.program,'src'),save.active-gl.TEXTURE0);
    gl.bindSampler(save.active-gl.TEXTURE0,null);
    gl.drawArrays(gl.TRIANGLES,0,3);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);gl.pixelStorei(gl.PACK_ALIGNMENT,4);
    gl.pixelStorei(gl.PACK_ROW_LENGTH,0);gl.pixelStorei(gl.PACK_SKIP_ROWS,0);gl.pixelStorei(gl.PACK_SKIP_PIXELS,0);
    gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);
    require(px[3]===255&&presenterProof.encodedRGBA8.every((v,i)=>Math.abs(v-px[i])<=1)&&gl.getError()===gl.NO_ERROR,
      '本机 sRGB 转换校验失败');
  }finally{restore(save);gl.deleteTexture(src);gl.deleteTexture(dst);gl.deleteFramebuffer(f);}
 }
 function transfer(){
  const saved=state();
  try{
   gl.bindFramebuffer(gl.READ_FRAMEBUFFER,null);
   gl.bindTexture(gl.TEXTURE_2D,glTextures[0]);gl.copyTexSubImage2D(gl.TEXTURE_2D,0,0,0,0,0,W,H);
   gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER,null);gl.pixelStorei(gl.UNPACK_ROW_LENGTH,0);gl.pixelStorei(gl.UNPACK_SKIP_ROWS,0);gl.pixelStorei(gl.UNPACK_SKIP_PIXELS,0);
   gl.bindTexture(gl.TEXTURE_2D,glTextures[1]);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
   gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.NONE);
   gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,gl.RGBA,gl.UNSIGNED_BYTE,hudCanvas);
   require(gl.getError()===gl.NO_ERROR,'未验收的浏览器 HUD 纹理上传');
  }finally{restore(saved);}
 }
 function disposeBlur(){
  blurApi?.bridge.dispose();blurApi?.source.close();blurApi=null;latest=null;lower?.dispose();lower=null;
  if(presenter){gl.deleteProgram(presenter.program);gl.deleteVertexArray(presenter.vao);}presenter=null;
  for(const t of glTextures??[])gl.deleteTexture(t);
  glTextures=null;blurVisible=false;
 }
 function failBlur(phase,e){blurError??=phase+'：'+String(e?.message??e);disposeBlur();}
 function observeBlur(world){
  const s=blurApi.bridge.observe(world);
  require(s.state!=='closed',s.reason??'Original blur lifecycle closed');
  return s;
 }
 async function commit(result){
  if(disposed)return;
  try{
   const {world,joined}=model.accept(result);
   if(!joined){
    hudVisible=blurVisible=false;popupReason=null;
    if(blurApi){try{blurApi.source.invalidate();observeBlur(world);}catch(e){failBlur('模糊生命周期',e);}}
    show();return;
   }
   if(!world.packet.state.paused){
    await painter.paint(joined.plan);if(disposed)return;
    hudVisible=true;blurVisible=false;popupReason=null;
    if(!blurApi&&!blurError){try{initialize();}catch(e){failBlur('模糊设备校验',e);}}
    if(blurApi){
     try{
      if(!world.packet.state.choice)observeBlur(world);
      transfer();
      const textures=Object.freeze({context:gl,colorPolicy:LOWER_COLOR,storage:LAYER_STORAGE,orientation:'bottom-left',width:W,height:H,
       worldFrame:world.frame,hudReceipt:joined.receipt,prePopup:true,opaqueWorld:true,worldTexture:glTextures[0],hudTexture:glTextures[1]});
      latest=Object.freeze({world,join:joined,textures});blurApi.source.retain(latest);
     }catch(e){failBlur('同帧模糊源',e);}
    }
   }else if(world.packet.state.choice&&blurApi){
    try{
     observeBlur(world);
     const before=state();
     try{
      gl.bindSampler(0,null);gl.bindSampler(1,null);await blurApi.bridge.capture();if(disposed)return;
      blurVisible=blurApi.bridge.present();popupReason=blurVisible?null:blurApi.bridge.state().reason;
     }finally{restore(before);}
    }catch(e){failBlur('升级弹窗模糊',e);}
   }
   show();
  }catch(e){
   error??=String(e?.message??e);hudVisible=blurVisible=false;show();
   if(blurApi)failBlur('HUD 源失效',e);
  }
 }
 return Object.freeze({commit, get status(){return {hud:hudVisible,blur:blurVisible,error,blurError:blurError??popupReason};},
   close(){disposed=true;hudVisible=blurVisible=false;show();painter.dispose();model.close();disposeBlur();}
 });
}

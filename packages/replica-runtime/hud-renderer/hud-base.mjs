/** A settled 1334x750 non-interactive native HUD subset, never substitutes text, popup or live Animator. */
import {createHudBinding} from './hud-fields.mjs';
const sha=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),v=>v.toString(16).padStart(2,'0')).join('');
const version='134377281279792758', resolution=[1334,750];
const check=(ok,msg)=>{if(!ok)throw new RangeError(msg);};
const pins={
  hud:['./hud-base.json','d9ecf6ccd9740ef4353a85839caeb97dd0be0fa9bb2051a1d8a2de0c4c721179'],
  bindings:['./bindings.json','1b06eb5d2c4684b59f7644c1000337b329493b9366c09a0559140fea86d1a837'],
  stages:['../source-runtime/stage-config.json','663e0421e80f077094b8ad13ded7f9f7070629bec3ae81f3738c71c0182b6ab4'],
};
export const rounding=raw=>{
  const floor=Math.floor(raw),frac=raw-floor;
  return frac===.5?floor+(floor%2):Math.round(raw);
};
export function barWidth(width,value) {
  check(Number.isInteger(width)&&width>0&&Number.isFinite(value),'Invalid native bar values');
  return rounding(Math.fround(width*Math.fround(Math.min(1,Math.max(0,value/100)))));
}
export function pieces(img,xy,size,scale) {
  const [w,h]=img.sourceSize,[dw,dh]=size,[x,y]=xy,[sx,sy]=scale;
  if(img.scaleOption===0)return [[0,0,w,h,x,y,dw*sx,dh*sy]];
  const [l,t,midX,midY]=img.scale9; const r=w-l-midX,b=h-t-midY;
  check(img.scaleOption===1&&img.tileParts===0&&l>=0&&t>=0&&midX>0&&midY>0&&r>=0&&b>=0&&dw>=l+r&&dh>=t+b,
    'Unverified nine-slice or tile size');
  const u=[0,l,l+midX,w],v=[0,t,t+midY,h],dx=[0,l,dw-r,dw],dy=[0,t,dh-b,dh];
  return dx.slice(0,3).flatMap((p,i)=>dy.slice(0,3).map((q,j)=>[
    u[i],v[j],u[i+1]-u[i],v[j+1]-v[j],x+p*sx,y+q*sy,(dx[i+1]-p)*sx,(dy[j+1]-q)*sy
  ]).filter(k=>k[2]>0&&k[3]>0&&k[6]>0&&k[7]>0));
}
export function createNativeHud(base,bindings,stages,runId) {
  check(base?.schema==='starfall.monsters-defense.hud-base/1'&&base.version===version&&base.stageId===78000001&&
    String(base.size)===String(resolution)&&base.source?.package==='1hbjipo6'&&base.source.root==='n6021'&&
    typeof runId==='string'&&runId.length,'Wrong Stage1 native HUD data/worker run');
  const binding=createHudBinding(bindings,stages);
  const staticNodes=base.painterOrder.map(n=>{
    const a=base.images[n.imageId];
    return {...n,pieces:pieces(a,n.xy,n.size,n.scale),smoothing:a.smoothing};
  });
  let prev=null, request=null;
  function accept(message) {
    const {state,protocol,type,gates,requestId}=message??{};
    check(protocol==='starfall-stage1-rules/1'&&runId===message.runId&&
      (type==='ready'&&request===null||type==='state'&&request!==null)&&Number.isSafeInteger(requestId)&&
      requestId>0&&(request===null||requestId>request)&&gates?.sourceState==='integrity_verified'&&
      state?.stageId===78000001,'Wrong, stale, or unverified Stage1 worker snapshot');
    const next=binding.snapshot(state,{nativeInit:type==='ready'});
    const updates=binding.diff(prev,next);
    const choice=state.choice==null?null:binding.choiceClock(state.choice);
    const filled=Object.fromEntries(next.fields.filter(f=>f.op==='set-progress-value').map(f=>[f.field,f.value]));
    const commands=next.status==='terminal_source_cleared'?[]:staticNodes.flatMap(n=>{
      if(!n.clip)return [n];
      const [w,h]=n.clip.size, width=barWidth(w,filled[n.clip.field]);
      return width===0?[]:[{...n,clipRect:[...n.clip.xy,width,h]}];
    });
    prev=next;request=requestId;
    return {state:next,updates,choice,commands,held:base.held};
  }
  return Object.freeze({accept});
}
export async function loadNativeHud(canvas,runId,here=new URL('.',import.meta.url)){
  check((canvas?.width===1334&&canvas?.height===750),'Native HUD reference requires 1334x750 backing canvas');
  check(here.origin===globalThis.location?.origin &&
    ['127.0.0.1','localhost','[::1]'].includes(here.hostname),'Native HUD asset reads are loopback same-origin only');
  async function bytes(relative,pin){
    const url=new URL(relative,here);
    check(url.origin===here.origin,'Wrong native HUD input origin');
    const r=await fetch(url,{redirect:'error',cache:'no-store'});
    check(r.ok,'Missing native HUD input '+url.pathname);
    const out=await r.arrayBuffer();
    check(await sha(out)===pin,'Native HUD input integrity mismatch '+url.pathname);
    return out;
  }
  const [base,cfg,stages]=await Promise.all(Object.values(pins).map(async ([name,hash])=>JSON.parse(new TextDecoder().decode(await bytes(name,hash)))));
  const owned=new Map();
  try{
    for(const [id,a] of Object.entries(base.images)){
      check(/^[^\\/]+\.png$/.test(a.basename),'Incorrect HUD PNG name');
      const b=await bytes('../native-assets/stage1-exact-inputs/hud/images/'+encodeURIComponent(a.basename),a.pngSha256);
      const image=await createImageBitmap(new Blob([b],{type:'image/png'}),{colorSpaceConversion:'none'});
      if(image.width!==a.sourceSize[0]||image.height!==a.sourceSize[1]){
        image.close();throw RangeError('Native HUD decoded image dimensions mismatch');
      }
      owned.set(id,image);
    }
    const reducer=createNativeHud(base,cfg,stages,runId),ctx=canvas.getContext('2d',{alpha:true});
    check(ctx,'No HUD Canvas2D context');
    let closed=false;
    return Object.freeze({
      accept(message) {
        check(!closed&&canvas.width===1334&&canvas.height===750,'Closed/resized fixed-canvas HUD');
        const result=reducer.accept(message); // All source validation finishes before touching display.
        paintNativeHud(ctx,result.commands,owned);
        return result;
      },
      close(){closed=true;for(const img of owned.values())img.close();owned.clear();ctx.clearRect(0,0,...resolution);},
    });
  }catch(e){for(const img of owned.values())img.close();throw e;}
}
export function paintNativeHud(ctx,commands,images) {
  ctx.save();
  try{
    ctx.setTransform(1,0,0,1,0,0);
    ctx.globalCompositeOperation='source-over';ctx.globalAlpha=1;
    ctx.clearRect(0,0,...resolution);
    for(const n of commands){
      ctx.save();
      try{
        if(n.clipRect){ctx.beginPath();ctx.rect(...n.clipRect);ctx.clip();}
        ctx.imageSmoothingEnabled=n.smoothing;
        for(const box of n.pieces)ctx.drawImage(images.get(n.imageId),...box);
      }finally{ctx.restore();}
    }
  }finally{ctx.restore();}
}

/** Fixed-size private Stage 1 chooser. Authoritative original Lua owns choices and timeouts. */
const VERSION='134377281279792758', PROTOCOL='starfall-stage1-rules/1', STAGE=78000001;
const PIN='bb83df2e9047aaa56053db3eec4392a23e99ddeeedc1a3e583259f40fd75bbe6';
const FONT='SOURCEHANSANSSC-NORMAL-2';
const HELD=Object.freeze(['missing_original_font','unresolved_native_blur_texture','unverified_unity_display_cadence','unverified_native_window_out_lifecycle','unverified_real_browser_pixels']);
const check=(v,m)=>{if(!v) throw new Error(m);};
const clamp=t=>Math.min(1,Math.max(0,t));
const f=Math.fround;
const int=(x,min=0,max=2147483647)=>Number.isInteger(x)&&x>=min&&x<=max;
const key=c=>c ? c.windowId+':'+c.generation : null;
const plus=([a,b],[c,d])=>[a+c,b+d];
const inside=([x,y,w,h],px,py)=>px>=x&&px<x+w&&py>=y&&py<y+h;
const width=(full,percent)=>{
  const x=f(full*f(percent)), n=Math.floor(x);
  return x-n===.5?n+n%2:Math.round(x);
};
const ease=(t,e)=>{check(e==='QuadOut','Unverified authored easing');return t*(2-t);};
function apply(actions,name,type,elapsed){
  const a=actions.filter(x=>x.targetName===name&&x.kind===type).at(-1);
  check(a&&a.durationSeconds>0&&!a.repeat&&!a.yoyo,'Unverified authored tween');
  const s=ease(clamp((elapsed/1000-a.timeSeconds)/a.durationSeconds),a.ease);
  if(type==='XY'){
    check(a.from.hasX&&a.from.hasY&&a.to.hasX&&a.to.hasY&&!a.from.usePercent&&!a.to.usePercent,'Unverified authored coordinates');
    return a.from.value.map((v,i)=>v+(a.to.value[i]-v)*s);
  }
  return a.from+(a.to-a.from)*s;
}
function stretched(path,asset,xy,wh,opacity,clip=null){
  const s=asset.sourceSize;
  if(!asset.scale9) return {path,opacity,clip,smoothing:asset.smoothing??true,pieces:[[0,0,...s,...xy,...wh]]};
  const [l,t,mx,my]=asset.scale9;
  // The original countdown strip uses a zero-height center with equal source/target heights.
  const axes=(n,d,l,m)=>n===d?[[0,n,0,d]]:[
    [0,l,0,l],[l,m,l,d-l-(n-l-m)],[l+m,n-l-m,d-(n-l-m),n-l-m],
  ].filter(([_,sw,__,dw])=>sw>0&&dw>0);
  check(asset.scaleOption===1&&asset.tileParts===0,'Unverified nine-slice');
  const pieces=axes(s[0],wh[0],l,mx).flatMap(([sx,sw,dx,dw])=>axes(s[1],wh[1],t,my)
    .map(([sy,sh,dy,dh])=>[sx,sy,sw,sh,xy[0]+dx,xy[1]+dy,dw,dh]));
  return {path,opacity,clip,smoothing:asset.smoothing,pieces};
}
function scaledGeom(g,origin){
  const pos=g.xy.map((p,k)=>p+g.pivot[k]*g.size[k]*(1-g.scale[k]));
  return [...plus(origin,pos),...g.size.map((s,k)=>s*g.scale[k])];
}
function validateChoice(c, data){
  check(int(c?.windowId,1)&&int(c.generation,1)&&int(c.level,1)&&int(c.remainingMs,0,30000)&&
    typeof c.touchable==='boolean'&&Array.isArray(c.offerIds)&&c.offerIds.length>=1&&c.offerIds.length<=3&&
    new Set(c.offerIds).size===c.offerIds.length&&c.offerIds.every(id=>int(id)&&Object.hasOwn(data.catalog,id))&&
    Array.isArray(c.visible)&&c.visible.length===c.offerIds.length&&c.visible.every(x=>typeof x==='boolean'),
    'Invalid qualified original skill offer');
}
export function createChoiceHud(data,{runId,client}){
  check(data?.schema==='starfall.monsters-defense.choice-assets/1'&&data.version===VERSION&&data.stage===STAGE&&
    data.size.join(',')==='1334,750'&&typeof runId==='string'&&runId&&typeof client?.select==='function','Wrong original chooser contract');
  const D=data.choice;
  let lastRequest=0, clock=0, active=null, pending=null, closed=false, selected=null, lastEpoch=null;
  function accept(message){
    const {state,requestId,type,events}=message??{};
    check(!closed&&message?.protocol===PROTOCOL&&message.runId===runId&&int(requestId,1)&&requestId>lastRequest&&
      (type==='ready'&&!lastRequest||type==='state'&&lastRequest>0)&&message.gates?.sourceState==='integrity_verified'&&
      state?.stageId===STAGE&&int(state.elapsedMs,clock)&&Array.isArray(events),'Wrong, stale or unverified original chooser snapshot');
    const c=state.choice;
    let next=null,nextEpoch=lastEpoch;
    if(c!==null){
      validateChoice(c,data);
      check(state.paused===true&&!state.terminal,'Original chooser must hold battle rules');
      const prevKey=key(active);
      if(prevKey===key(c)){
        check(c.level===active.level&&c.remainingMs<=active.remainingMs&&c.offerIds.join(',')===active.offerIds.join(',')&&
          c.visible.every((val,i)=>val||!active.visible[i])&&(!c.touchable||active.touchable),'Invalid same-generation chooser regression');
        next=selected;
      } else {
        check(lastEpoch===null || c.windowId>lastEpoch[0] || (active&&c.windowId===lastEpoch[0]&&c.generation>lastEpoch[1]),'Old chooser generation');
      }
      nextEpoch=[c.windowId,c.generation];
      // In the timeout route the authoritative original SaveSkill event is emitted during its 500 ms non-touchable hold.
      if(!c.touchable){
        const auto=events.filter(e=>e[0]==='learn'&&Number(e[2])===c.windowId&&Number(e[3])===c.generation);
        if(auto.length===1){
          const id=Number(auto[0][5]);check(c.offerIds.includes(id)&&data.catalog[id].owner===Number(auto[0][4]),'Authoritative choice outside offer');next=id;
        }
      }
      if(pending?.run===key(c)&&pending.skillId&&requestId===pending.resultId)next=pending.skillId;
    }
    active=c===null?null:{...c,offerIds:[...c.offerIds],visible:[...c.visible]};
    selected=next;lastEpoch=nextEpoch;clock=state.elapsedMs;lastRequest=requestId;
  }
  function frame({windowInMs=null}={}){
    if(closed||active===null)return {visible:false,commands:[],targets:[],held:HELD};
    const c=active, el=30000-c.remainingMs;
    // Use an explicit independent presenter clock for whole-window fade; null is the settled endpoint.
    check(windowInMs===null||(Number.isFinite(windowInMs)&&windowInMs>=0),'Explicit native presentation elapsed required');
    const phase=n=>windowInMs===null?1:apply(D.transitions.popupIn.actions,n,'Alpha',windowInMs);
    const commands=[],targets=[],labels=[];
    const pic=(id,xy,size,alpha,clip)=>{
      check(Object.hasOwn(data.images,id),'Unverified source image '+id);
      if(alpha>0)commands.push(stretched(id,data.images[id],xy,size,alpha,clip));
    };
    const label=(kind,xy,text,clip=null)=>labels.push({status:'held_missing_original_font',font:FONT,xy,clip,text,style:D.text[kind].style});
    const dimAlpha=phase('PopupBg');
    pic('dim',D.dim.xy,D.dim.size,dimAlpha);
    const listAlpha=phase('TipsList'), [tw,th]=D.tipSize, gap=D.list.columnGap;
    const span=tw*c.offerIds.length+gap*(c.offerIds.length-1);
    const start=Math.floor((D.list.size[0]-span)/2);
    for(const [i,id] of c.offerIds.entries()){
      if(!c.visible[i])continue;
      const t=el-i*200;
      check(t>=0,'Snapshot violates authored stagger');
      const a=apply(D.transitions.cardUp.actions,'Tips','Alpha',t)*listAlpha;
      const motion=apply(D.transitions.cardUp.actions,'Tips','XY',t);
      const anchor=plus(D.list.xy,[start+i*(tw+gap),0]), origin=plus(anchor,motion), record=data.catalog[id];
      const controllerPages=[D.controls[0].pages[selected===id?1:0].id,D.controls[1].pages[record.type===2||record.type===3?1:0].id];
      const on=k=>D.gears[k].pages.includes(controllerPages[D.gears[k].controller]);
      const L=D.layers;
      if(on('n1'))pic('gevl33',plus(origin,L.idle.xy),L.idle.size,a);
      if(on('n2'))pic('gevl35',plus(origin,L.selected.xy),L.selected.size,a);
      const sz=data.images[record.iconItem].sourceSize;
      pic(record.iconItem,plus(plus(origin,L.icon.xy),L.icon.size.map((v,i)=>(v-sz[i])/2)),sz,a);
      label('name',plus(origin,D.text.name.xy),record.name);
      const wordFrom=plus(origin,D.words.xy);
      label('desc',plus(wordFrom,D.text.desc.xy),record.description,[...wordFrom,...D.words.size]);
      const headFrom=plus(origin,L.headBlock.xy), h=D.head, part=plus(headFrom,h.clip.xy);
      const under=scaledGeom(h.under,headFrom), over=scaledGeom(h.over,headFrom);
      pic('gevl39',under.slice(0,2),under.slice(2),a);
      const hs=data.images[record.headItem].sourceSize;
      const hp=plus(plus(part,h.image.xy),h.image.size.map((v,i)=>((v-hs[i])/2)*h.image.scale[i]));
      pic(record.headItem,hp,hs.map((v,i)=>v*h.image.scale[i]),a,scaledGeom(h.mask,part));
      pic('gevl3f',over.slice(0,2),over.slice(2),a);
      if(on('n8'))pic('gevl31',plus(origin,L.new.xy),L.new.size,a);
      if(c.touchable&&a>0)targets.push({target:'offer',rect:[...anchor,tw,th],skillId:id});
    }
    const ta=phase('Time');
    for(const b of Object.values(D.bars)){
      let [x,y]=plus(D.time.xy,b.xy);
      const [w,h]=b.size,n=width(w,c.remainingMs/30000);
      if(b.reverse)x+=w-n;
      // Original GProgressBar shrinks and moves the container, not its child image.
      if(n>0)pic('gevl32',[x,y],b.size,ta,[x,y,n,h]);
    }
    const sureAt=plus(D.time.xy,D.sure.xy);
    pic('gevl34',sureAt,D.sure.size,ta);
    label('confirm',plus(sureAt,D.text.confirm.xy),D.textFormat.replace('%s',String(Math.ceil(c.remainingMs/1000))));
    if(c.touchable&&ta>0&&selected!==null)targets.push({target:'confirm',rect:[...sureAt,...D.sure.size],skillId:selected});
    return {visible:true,windowId:c.windowId,generation:c.generation,selected,commands,targets,labels,held:HELD,
      authoredOut:D.transitions.popupOut, nativeWindowLifecycleApplied:false};
  }
  async function dispatch(x,y,presentation){
    const hit=frame(presentation).targets.find(b=>inside(b.rect,x,y));
    if(!hit||pending)return false;
    const offer=active, snapshot=lastRequest;
    const req={windowId:offer.windowId,generation:offer.generation,skillId:hit.skillId,confirm:hit.target==='confirm'};
    const token={run:key(offer),skillId:hit.skillId, resultId:null};
    pending=token;
    try{
      const msg=await client.select(req);
      if(closed||pending!==token)return false;
      check(msg?.type==='state'&&msg.protocol===PROTOCOL&&msg.runId===runId&&int(msg.requestId,snapshot+1)&&
        msg.gates?.sourceState==='integrity_verified','Selection returned a non-authoritative reply');
      if(lastRequest>=msg.requestId){
        // A newer snapshot may have been consumed while the click reply was in flight.
        // Keep the accepted highlight only if its exact offer is still alive and unlocked.
        if(!req.confirm&&key(active)===token.run&&active.touchable&&key(msg.state?.choice)===token.run){
          selected=token.skillId; return true;
        }
        return false;
      }
      token.resultId=msg.requestId;
      accept(msg);
      return true;
    }finally{if(pending===token)pending=null;}
  }
  function close(){closed=true;active=null;selected=null;pending=null;}
  return Object.freeze({accept,frame,dispatch,close});
}
const sha=async data=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),b=>b.toString(16).padStart(2,'0')).join('');
export async function loadChoiceHud(canvas,{runId,client}){
  const home=new URL('.',import.meta.url);
  check(['127.0.0.1','localhost','[::1]'].includes(home.hostname)&&home.origin===globalThis.location?.origin&&home.protocol==='http:',
    'Native choice preview is local loopback only');
  check(canvas?.width===1334&&canvas?.height===750&&typeof canvas.getContext==='function','Original 1334×750 Canvas required');
  const ctx=canvas.getContext('2d');check(ctx,'Canvas2D missing');
  const bytes=async(path,pin)=>{
    const url=new URL(path,home);
    check(url.origin===home.origin,'Rejected nonlocal image');
    const r=await fetch(url,{redirect:'error',cache:'no-store',credentials:'omit'});check(r.ok,'Original chooser asset missing');
    const ab=await r.arrayBuffer();check(await sha(ab)===pin,'Original chooser asset integrity mismatch');return ab;
  };
  const manifest=new TextDecoder('utf-8',{fatal:true}).decode(await bytes('./choice-data.json',PIN));
  const data=JSON.parse(manifest), hud=createChoiceHud(data,{runId,client});
  const results=await Promise.allSettled(Object.entries(data.images).map(async([id,a])=>{
    const b=await createImageBitmap(new Blob([await bytes(a.file,a.sha256)],{type:'image/png'}),{premultiplyAlpha:'default',colorSpaceConversion:'none'});
    if(b.width!==a.sourceSize[0]||b.height!==a.sourceSize[1]){b.close();throw new Error('Unexpected original image dimensions');}
    return [id,b];
  }));
  const images=new Map(results.filter(r=>r.status==='fulfilled').map(r=>r.value));
  if(images.size!==results.length){for(const b of images.values())b.close();throw new Error('Original chooser image loading failed');}
  function render(presentation){
    const model=hud.frame(presentation);
    ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,1334,750);
    for(const c of model.commands){
      ctx.save();
      ctx.globalAlpha=c.opacity; ctx.imageSmoothingEnabled=c.smoothing;
      if(c.clip){ctx.beginPath();ctx.rect(...c.clip);ctx.clip();}
      for(const p of c.pieces)ctx.drawImage(images.get(c.path),...p);
      ctx.restore();
    }
    ctx.restore();
    return model;
  }
  async function pointer(clientX,clientY,presentation){
    const r=canvas.getBoundingClientRect();check(r.width>0&&r.height>0,'Invalid mapped stage dimensions');
    const did=await hud.dispatch((clientX-r.left)*1334/r.width,(clientY-r.top)*750/r.height,presentation);
    if(did)render(presentation);
    return did;
  }
  return Object.freeze({accept:hud.accept,render,pointer,close(){hud.close();render();for(const b of images.values())b.close();}});
}

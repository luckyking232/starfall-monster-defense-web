/** Pure static compositors for the original 1334×750 stage chooser and result. */
const BUILD='134377281279792758';
const FONT='SOURCEHANSANSSC-NORMAL-2';
export const SHA='0b253f839b86dc9eed4e5e89cfb2010a7d492bb55c4b978799844178bd4d38c6';
const f=x=>Math.fround(x);
const add=([a,b],[x,y])=>[a+x,b+y];
const state=(x,why)=>{if(!x)throw new Error(why);};
const has=(x,k)=>Object.hasOwn(x,k);
const byte=n=>n===0||n===1;
const between=(x,a,b)=>Math.min(b,Math.max(a,x));
const names=(p,n)=>p.children.find(x=>x.name===n);
const inside=(r,x,y)=>x>=r[0]&&y>=r[1]&&x<r[0]+r[2]&&y<r[1]+r[3];
const intersect=(a,b)=>{
  const x=Math.max(a[0],b[0]), y=Math.max(a[1],b[1]);
  const w=Math.min(a[0]+a[2],b[0]+b[2])-x,h=Math.min(a[1]+a[3],b[1]+b[3])-y;
  return w>0&&h>0?[x,y,w,h]:null;
};
function unwrap(d){
  state(d?.schema==='starfall.monsters-defense.screen-shell/1'&&d.version===BUILD&&d.resolution.join(',')==='1334,750','Unqualified visual build');
  return d;
}
function placement(x,o,size){
  return [...add(o,x.xy.map((v,i)=>v+x.pivot[i]*size[i]*(1-x.scale[i]))),...size.map((s,i)=>s*x.scale[i])];
}
function split(a,rect){
  const [x,y,w,h]=rect, [sw,sh]=a.sourceSize;
  if(a.scaleOption===0) return [[0,0,sw,sh,x,y,w,h]];
  state(a.scaleOption===1&&a.tileParts===0,'Unverified atlas scaling');
  const axis=(s,o,l,m)=>{
    const r=s-l-m;
    state(s>0&&l>=0&&r>=0&&m>=0&&o>=l+r,'Unverified nine-slice grid');
    return [[0,l,0,l],[l,m,l,o-l-r],[l+m,r,o-r,r]];
  };
  const [l,t,mx,my]=a.scale9;
  return axis(sw,w,l,mx).flatMap(([sx,ns,dx,nd])=>axis(sh,h,t,my).map(([sy,ys,dy,yd])=>[sx,sy,ns,ys,x+dx,y+dy,nd,yd])).filter(p=>p[2]>0&&p[3]>0&&p[6]>0&&p[7]>0);
}
function context(d){
  const target={commands:[],labels:[],hits:[],holds:['original_dynamic_font','native_browser_pixels','native_frame_timing']};
  const root=[0,0,...d.resolution];
  function image(id,rect,alpha=1,clip=root,tint=[255,255,255,255]){
    if(!alpha||!intersect(rect,clip))return;
    state(has(d.images,id),'Unknown native image '+id);
    const resource=d.images[id];
    target.commands.push({id,rect,clip,alpha,tint,smoothing:resource.smoothing,pieces:split(resource,rect)});
  }
  function label(x,rect,value,clip=root){
    if(!intersect(rect,clip))return;
    state(x.textStyle.fontRef===FONT&&typeof value==='string','Unsupported native text');
    target.labels.push({status:'held_missing_native_font',name:x.name,objectId:x.objectId,rect,clip,text:value,style:x.textStyle});
  }
  return {target,root,image,label};
}
function props(p,x,config){
  function page(i){
    const c=p.controls[i];
    const ix=config[c.name]??0;
    state(byte(ix)&&c.pages[ix],'Unevidenced controller page');
    return c.pages[ix][0];
  }
  let visible=x.visible,alpha=x.alpha,tint=[255,255,255,255];
  for(const g of x.gears){
    const id=page(g.controller);
    if(g.type==='display')visible&&=g.pages.includes(id);
    else{
      const s=g.statuses[id]??g.statuses.default;
      if(!s)continue;
      if(g.type==='look'){state(!s.rotation&&!s.grayed,'Unverified gear look branch');alpha=s.alpha;}
      else if(g.type==='color')tint=s.tint;
      else throw Error('Unverified gear type');
    }
  }
  return {visible:visible&&alpha>0,alpha,tint};
}
export function composeChooser(manifest,view,{nativeScrollX}={}){
  const d=unwrap(manifest), src=d.stage, {target,root,image,label}=context(d);
  state(view?.stages?.length===21&&view.head?.length===5&&Number.isFinite(view.scroll),'Original activity chooser snapshot required');
  const wnd=src.q3ohgw, p=src.q3ohgv, map=src.q3ohh5;
  state(wnd.children.length===1&&wnd.children[0].sourceId==='q3ohgv','Unexpected chooser root');
  const clip=[...names(p,'TipsList').xy,...names(p,'TipsList').size];
  const maxScroll=map.size[0]-clip[2];
  state(clip.join(',')===root.join(',')&&maxScroll===2846&&names(p,'TipsList').list.scrollHex==='00000000000000fffefffefffefffe','Inexact bounded horizontal scrollpane');
  if(nativeScrollX!==undefined)state(Number.isFinite(nativeScrollX),'Native drag scroll must be numeric');
  const scroll=between(nativeScrollX??view.scroll,0,maxScroll);
  const cause=nativeScrollX===undefined?'source_request_clamped':'caller_settled_native_position';
  const xo=add(clip.slice(0,2),[-Math.trunc(scroll),0]);
  const bg=names(p,'BackGround'), bgc=d.common[bg.sourceId], loader=names(bgc,'BackGroundLoader'), holder=names(bgc,'BackGroundHolder');
  state(bg.sourcePackage==='tey9g4p9'&&loader.loaderHex==='fffe01010000000001000000000000'&&holder.graphHex==='0100000000000000ffffffff0000','Unsupported original background configuration');
  const bgs=d.images.q3oheq.sourceSize;
  image('q3oheq',[...add(add(bg.xy,loader.xy),loader.size.map((n,i)=>(n-bgs[i])/2)),...bgs]);
  function walk(cid, origin, flags={}, values={}, clipRect=root){
    const comp=src[cid];state(comp,'Missing selected component');
    for(const x of comp.children){
      const att=props(comp,x,flags);
      if(!att.visible)continue;
      const {alpha,tint}=att;
      if(x.type===0)image(x.sourceId,placement(x,origin,x.size??d.images[x.sourceId].sourceSize),alpha,clipRect,tint);
      else if(x.type===7)label(x,placement(x,origin,x.size),values[x.name]??x.initialText??'',clipRect);
      else if(x.type===9)walk(x.sourceId,add(origin,x.xy),{},values,clipRect);
      else throw Error('Unsupported source-local stage child '+x.name);
    }
  }
  for(const slot of map.children){
    if(slot.type===0){
      state(slot.name==='n16'&&slot.sourceId==='q3ohh9','Wrong rail asset');
      image(slot.sourceId,placement(slot,xo,slot.size),1,clip);
      continue;
    }
    const i=slot.name==='SpecialBtn'?20:Number(slot.name.match(/^Tips(\d+)Btn$/)?.[1])-1;
    state(Number.isInteger(i)&&i>=0&&i<=20,'Unsupported stage slot');
    const r=view.stages[i];
    state(byte(r?.lock)&&byte(r?.c2)&&byte(r?.c1??0)&&(r.touchable===undefined||typeof r.touchable==='boolean')&&
      (i===20||r.name===d.locale[11917].replace('%s',i+1))&&(!r.c1||typeof r.time==='string'),
      'Wrong stage fields for '+slot.name);
    const comp=src[slot.sourceId], origin=add(xo,slot.xy);
    walk(slot.sourceId,origin,r,{NumberTxt:r.name,WordTxt:r.time},clip);
    const hit=intersect([...origin,...comp.size],clip);
    if(hit&&r.touchable!==false)target.hits.push({kind:'stage',index:i,rect:hit});
  }
  const region=names(p,'CardRegion'), panel=src[region.sourceId], regionAt=region.xy;
  const base=names(panel,'n0'), list=names(panel,'HeadList');
  image(base.sourceId,placement(base,regionAt,d.images[base.sourceId].sourceSize));
  state(list.list.layout===1&&list.list.align===0&&list.list.columnGap===8&&list.list.template==='ui://aonql508q3ohhd','Original head list changed');
  const head=src.q3ohhd, headBG=src.q3ohha, inner=names(head,'Bg');
  state(headBG.mask===0&&headBG.children[0].graphHex==='0100000000000000ffffffffff00','Original head rectangle mask changed');
  const [ww,hh]=head.size, actors=Object.values(d.heads);
  for(const [i,row] of view.head.entries()){
    const url=row.url?.match(/^ActivityDungeon1017:S_(10018|10034|10004|10001|10098)$/), icon=actors[i];
    state(byte(row.lock)&&byte(row.selected)&&url&&d.images[icon]?.sourceMember.includes('/S_'+url[1]+'__'),'Unqualified role state');
    const at=add(add(regionAt,list.xy),[i*(ww+list.list.columnGap),0]), outer=placement(inner,at,headBG.size);
    const geom=outer.slice(0,2);
    for(const x of head.children){
      const att=props(head,x,{lock:row.lock,c1:row.selected});
      if(!att.visible)continue;
      if(x.type===0)image(x.sourceId,placement(x,at,d.images[x.sourceId].sourceSize),att.alpha,root,att.tint);
      else{
        state(x===inner,'Unknown head compositor layer');
        const n=names(headBG,'PicLoader');
        state(n.loaderHex==='fffe01010000000001000000000000','Unknown head loader geometry');
        const hap=props(headBG,n,{lock:row.lock});
        // The graph is a stencil geometry (not an overlay); package's alpha on graph is not source texture opacity.
        image(icon,placement(n,geom,n.size),hap.alpha,outer,hap.tint);
      }
    }
    target.hits.push({kind:'card',index:i,rect:[...at,ww,hh]});
  }
  const back=names(p,'ReturnBtn');
  walk(back.sourceId,back.xy);
  target.hits.push({kind:'return',rect:[...back.xy,...src[back.sourceId].size]});
  return {...target,screen:'stage-chooser',scroll:{requested:view.scroll,position:scroll,range:[0,maxScroll],source:cause},scope:'settled_1334x750'};
}
export function composeOutcome(manifest,r){
  const d=unwrap(manifest), src=d.outcome, {target,root,image,label}=context(d);
  state(r?.kind==='result'&&[d.locale[11919],d.locale[11920],d.locale[11905]].includes(r.title)&&Number.isSafeInteger(r.wave)&&r.wave>=0&&Number.isSafeInteger(r.kills)&&r.kills>=0&&
    r.waveLabel===d.locale[11906]&&r.killsLabel===d.locale[11907]&&r.closeLabel===d.locale[11908],'Original settled result state required');
  const wm=src.gevl3r.children[0];
  state(wm.sourceId==='gevl3q','Unexpected result root');
  const win=src[wm.sourceId], o=wm.xy, pg=names(win,'PopupBg'), common=d.common[pg.sourceId], dim=names(common,'n3');
  image(dim.sourceId,placement(dim,add(o,pg.xy),dim.size));
  const byLabel={TitleTxt:r.title};
  function walk(p,origin,vals){
    for(const x of p.children){
      const at=add(origin,x.xy);
      if(x.type===0)image(x.sourceId,placement(x,origin,x.size??d.images[x.sourceId].sourceSize));
      else if(x.type===7)label(x,placement(x,origin,x.size),vals[x.name]);
      else if(x.name==='Info1'||x.name==='Info2'){
        const wave=x.name==='Info1';
        walk(src[x.sourceId],at,{WordTxt:wave?r.waveLabel:r.killsLabel,NumberTxt:String(wave?r.wave:r.kills)});
      }
      else if(x.name==='EndBtn'){
        walk(src[x.sourceId],at,{WordTxt:r.closeLabel});
        target.hits.push({kind:'result-close',rect:[...at,...src[x.sourceId].size]});
      } else state(x.name==='PopupBg','Unknown outcome node');
    }
  }
  walk(win,o,byLabel);
  target.holds.push('native_live_blur','native_result_exit_cadence');
  return {...target,screen:'outcome',scope:'settled_1334x750',authoredTransitions:d.outcomeTransitions.gevl3q};
}
export function hitTest(frame,x,y){
  state(Number.isFinite(x)&&Number.isFinite(y),'Finite stage point required');
  return [...frame.hits].reverse().find(h=>inside(h.rect,x,y))??null;
}
async function sha(buf){
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buf)),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function loadScreenShell(canvas){
  const local=new URL('.',import.meta.url), c=canvas?.getContext('2d');
  state(local.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(local.hostname)&&local.origin===location.origin&&c&&canvas.width===1334&&canvas.height===750,'Static original screen requires loopback 1334×750 Canvas');
  const get=async(path,id)=>{
    const target=new URL(path,local);state(target.origin===local.origin,'Nonlocal resource rejected');
    const req=await fetch(target,{redirect:'error',credentials:'omit',cache:'no-store'});state(req.ok,'Original resource absent');
    const buf=await req.arrayBuffer();state(await sha(buf)===id,'Integrity mismatch');return buf;
  };
  const m=unwrap(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await get('./shell-data.json',SHA))));
  const stock=new Map(),tinted=new Map();
  const loaded=await Promise.allSettled(Object.entries(m.images).map(async([k,r])=>{
    const blob=new Blob([await get(r.asset,r.sha256)],{type:'image/png'});
    const img=await createImageBitmap(blob,{colorSpaceConversion:'none'});
    if(img.width!==r.sourceSize[0]||img.height!==r.sourceSize[1]){img.close();throw Error('Unexpected image dimensions');}
    stock.set(k,img);
  }));
  if(loaded.some(x=>x.status==='rejected')){for(const b of stock.values())b.close();throw Error('Original assets unavailable');}
  let closed=false;
  function getImage(k,tint){
    const b=stock.get(k);
    state(b,'Image not loaded');
    if(tint.every(v=>v===255))return b;
    const tintKey=k+':'+tint.join(',');
    if(tinted.has(tintKey))return tinted.get(tintKey);
    const dst=document.createElement('canvas');dst.width=b.width;dst.height=b.height;
    const g=dst.getContext('2d',{willReadFrequently:true});
    g.drawImage(b,0,0);
    const id=g.getImageData(0,0,b.width,b.height);
    for(let i=0;i<id.data.length;i++)id.data[i]=Math.round(id.data[i]*tint[i%4]/255);
    g.putImageData(id,0,0);tinted.set(tintKey,dst);return dst;
  }
  function paint(model){
    state(!closed,'Static screen is closed');
    c.save();c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,1334,750);
    try{
      for(const op of model.commands){
        c.save();
        try{c.globalAlpha=op.alpha;c.imageSmoothingEnabled=op.smoothing;c.beginPath();c.rect(...op.clip);c.clip();
          const b=getImage(op.id,op.tint);for(const p of op.pieces)c.drawImage(b,...p);
        }finally{c.restore();}
      }
    }finally{c.restore();}
    return model;
  }
  return Object.freeze({chooser:(view,pose)=>paint(composeChooser(m,view,pose)),outcome:r=>paint(composeOutcome(m,r)),
    hit(frame,x,y){const r=canvas.getBoundingClientRect();state(r.width>0&&r.height>0,'Original screen must be visible');
       return hitTest(frame,(x-r.left)*1334/r.width,(y-r.top)*750/r.height);},
    close(){if(!closed){closed=true;for(const b of stock.values())b.close();stock.clear();tinted.clear();c.clearRect(0,0,1334,750);}}});
}

import {finiteWallClip} from './finite-wall-clip.mjs';
/** Browser opt-in diagnostic painter, no readback admission or Unity claims. */
import {fetchExactNativeFont,hasGlyph} from '../../../../native-font-shell/native-labels.mjs';
import {decodeExactAtlasPng,reconstructPortraitMask} from '../../../../battle-hud-presentation/portrait-mask.mjs';
const family='StarfallHudOriginal_c43383a8';
const require=(ok,m)=>{if(!ok)throw Error(m);};
const color=a=>'rgba('+[a[0],a[1],a[2],a[3]/255].join(',')+')';
const digest=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),v=>v.toString(16).padStart(2,'0')).join('');
export async function openHudPreviewPainter(canvas,layout,{stageId,nativeFace=false,location=globalThis.location,fetcher=globalThis.fetch,
 document=globalThis.document,Face=globalThis.FontFace}={}){
 const origin=location?.origin;
 require(origin&&/^http:\/\/127\.0\.0\.1:\d+$/u.test(origin)&&canvas?.width===1334&&canvas.height===750,
   'Private fixed-size HUD surface required');
 const g=canvas.getContext('2d'),bitmaps=new Map(),tinted=new Map(),raw=new Map(),portraits=new Map();
 require(g,'Canvas2D unavailable');
 let loaded=null,face=null,closed=false;
 const dispose=()=>{
  if(closed)return;closed=true;face&&document.fonts.delete(face);
  for(const b of bitmaps.values())b.close();bitmaps.clear();tinted.clear();raw.clear();portraits.clear();
 };
 try{
  if(nativeFace){
   loaded=await fetchExactNativeFont(fetcher,origin);
   face=await new Face(family,loaded.sfnt,{weight:'400',style:'normal',display:'block'}).load();
   require(face.status==='loaded','Exact original font missing');document.fonts.add(face);
  }
 }catch(e){dispose();throw e;}
 async function bitmap(id){
  let art=bitmaps.get(id);
  if(art)return art;
  const a=layout.images[id];require(a&&/^[^/\\]+\.png$/u.test(a.basename),'Exact atlas item unavailable');
  const u=new URL('/native-assets/stage1-exact-inputs/hud/images/'+encodeURIComponent(a.basename),origin);
  const r=await fetcher(u,{cache:'no-store',credentials:'omit',redirect:'error'});
  require(r.ok,'Original HUD PNG unavailable');
  const b=await r.arrayBuffer();
  require(b.byteLength<=1024*1024&&await digest(b)===a.sha256,'Original HUD PNG changed');
  if(['n6021f','spxe4d','spxe4e','spxe4f','spxe4g','spxe4h'].includes(id))raw.set(id,await decodeExactAtlasPng(b,...a.sourceSize));
  art=await createImageBitmap(new Blob([b],{type:'image/png'}),{colorSpaceConversion:'none',premultiplyAlpha:'default'});
  if(closed||art.width!==a.sourceSize[0]||art.height!==a.sourceSize[1]){art.close();throw Error('Original HUD PNG dimensions');}
  bitmaps.set(id,art);return art;
 }
 function tintBitmap(id,tint){
  const key=id+'|'+tint.join(',');
  if(tinted.has(key))return tinted.get(key);
  const b=bitmaps.get(id),c=document.createElement('canvas');c.width=b.width;c.height=b.height;
  const k=c.getContext('2d',{willReadFrequently:true});
  k.drawImage(b,0,0);const p=k.getImageData(0,0,b.width,b.height);
  for(let i=0;i<p.data.length;i++)p.data[i]=p.data[i]*tint[i%4]/255;
  k.putImageData(p,0,0);tinted.set(key,c);return c;
 }
 async function paint(plan,{allowPartial=false}={}){
  require(!closed&&plan?.schema==='starfall-stage1-battle-hud-preview/1'&&plan.nativeUnityFrame===false&&
    plan.blurSourceQualified===false&&Array.isArray(plan.commands),'Invalid HUD frame plan');
  require(!plan.held.length||allowPartial===true,'Unqualified HUD layers; explicit partial preview only');
  require(!plan.commands.some(c=>c.kind==='native-face-text')||loaded,'Original face not loaded');
  for(const c of plan.commands.filter(c=>c.kind==='native-face-text'))
   require(c.runs.every(r=>Array.from(r.text).every(x=>hasGlyph(loaded.m.font.coverage,x.codePointAt(0)))),
     'No font fallback permitted');
  for(const id of new Set(plan.commands.flatMap(c=>c.kind==='atlas'?[c.asset]:c.kind==='masked-portrait-preview'?[c.asset,c.maskAsset]:[])))await bitmap(id);
  require(!closed,'HUD closed while loading');
  g.save();
  try{
   g.setTransform(1,0,0,1,0,0);g.clearRect(0,0,1334,750);
   for(const c of plan.commands){
    g.save();
    try{
     if(c.kind==='atlas'){
      g.globalAlpha=c.alpha;g.imageSmoothingEnabled=c.smoothing;
      if(c.clip){g.beginPath();g.rect(...c.clip);g.clip();}
      if(c.radial&&c.radial.fraction<1){
       require(c.radial.origin==='top'&&!c.radial.clockwise,'Unverified radial');
       const [x,y,w,h]=c.rect,cx=x+w/2,cy=y+h/2,top=-Math.PI/2;
       g.beginPath();g.rect(x,y,w,h);g.clip();g.beginPath();g.moveTo(cx,cy);
       g.arc(cx,cy,Math.hypot(w,h),top,top-2*Math.PI*c.radial.fraction,true);g.closePath();g.clip();
      }
      const pic=c.tint?tintBitmap(c.asset,c.tint):bitmaps.get(c.asset);
      for(const p of c.pieces)g.drawImage(pic,...p);
     }else if(c.kind==='masked-portrait-preview'){
      const key=c.asset+'/'+c.maskAsset;let local=portraits.get(key);
      require(layout.images[c.asset]?.sha256===c.sourceSha&&layout.images[c.maskAsset]?.sha256===c.maskSha,'Mask input pin mismatch');
      if(!local){
        local=document.createElement('canvas');local.width=112;local.height=146;
        const k=local.getContext('2d'),out=k.createImageData(112,146);
        out.data.set(reconstructPortraitMask({mode:c.mode,maskRgba:raw.get(c.maskAsset),portraitRgba:raw.get(c.asset)}));
        k.putImageData(out,0,0);portraits.set(key,local);
      }
      g.drawImage(local,c.rect[0],c.rect[1]);
     }else{
      const s=c.style,[x,y,w,h]=c.rect,m=loaded.m.font.metrics,scale=s.fontSize/m.unitsPerEm;
      g.font=s.fontSize+'px '+family;g.textAlign='left';g.textBaseline='alphabetic';
      const observations=c.runs.map(r=>g.measureText(r.text)),widths=observations.map(m=>m.width),whole=widths.reduce((a,b)=>a+b,0);
      let xx=x+[0,(w-whole)/2,w-whole][s.align];const advance=(m.ascent-m.descent)*scale;
      g.beginPath();g.rect(...finiteWallClip(stageId,c,observations,[xx]));g.clip();
      const yy=y+m.ascent*scale+[0,(h-advance)/2,h-advance][s.verticalAlign];
      for(const [i,r] of c.runs.entries()){
       if(s.stroke?.size){g.strokeStyle=color(s.stroke.colorRgba);g.lineWidth=s.stroke.size*2;g.lineJoin='round';g.strokeText(r.text,xx,yy);}
       g.fillStyle=color(r.colorRgba);g.fillText(r.text,xx,yy);xx+=widths[i];
      }
     }
    }finally{g.restore();}
   }
  }finally{g.restore();}
 }
 return Object.freeze({paint,dispose,fontManifest:loaded?.m??null,nativeUnityFrame:false});
}

/** Authored fixed stage geometry, original Lua operations, opt-in native-face browser composition. */
import {pieces,barWidth} from '../hud-renderer/hud-base.mjs';
import {hasGlyph,NATIVE_FONT_ROUTE} from '../native-font-shell/native-labels.mjs';
import {dpsSampleValues,DPS_PREVIEW} from './dps-preview.mjs';
import {MASK_PREVIEW,MASK_LAYOUT} from './portrait-mask.mjs';
export const LAYOUT_SHA='c5be1d92913db571514b17f2603c58f5462ccb217fedc28ffd0398b8369bdcf7';
const check=(x,msg)=>{if(!x)throw Error(msg);};
const plus=([a,b],[x,y])=>[a+x,b+y];
const rect=(p,n)=>[...p,...(n.sizeOverride??n.size)];
const clamp=(x)=>Math.max(0,Math.min(100,x));
const bounded=(x)=>Number.isFinite(x)&&x>=0&&x<=100;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const hex=s=>[...s.matchAll(/../gu)].map(v=>parseInt(v[0],16)).concat(255);
export function originalRichRuns(text,rgba){
  check(typeof text==='string'&&text.length<=100&&!/[\x00-\x1f]/u.test(text),'Bad original HUD string');
  let color=rgba,opened=false;const out=[];
  for(const k of text.split(/(\[color=#[a-fA-F0-9]{6}\]|\[\/color\])/u)){
    if(!k)continue;
    if(k==='[/color]'){check(opened,'Malformed original UBB');opened=false;color=rgba;}
    else if(k.startsWith('[color=')){check(!opened,'Nested original UBB held');opened=true;color=hex(k.slice(8,-1));}
    else{check(!/[\[\]]/u.test(k),'Unsupported original UBB');out.push({text:k,colorRgba:color});}
  }
  check(!opened,'Unterminated original UBB');return out;
}
const sleepLabel='battle_intro_timing_or_hook_unobserved';
const seal=x=>{if(x&&typeof x==='object'&&!Object.isFrozen(x)){Object.values(x).forEach(seal);Object.freeze(x);}return x;};
export async function openBattleHudLayout(bytes){
 const b=bytes instanceof Uint8Array?new Uint8Array(bytes):null;
 check(b&&b.byteLength<900000,'Exact Stage1 layout bytes required');
 const sum=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),v=>v.toString(16).padStart(2,'0')).join('');
 check(sum===LAYOUT_SHA,'Wrong original dynamic layout hash');
 return seal(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b)));
}
/** Does not produce a blur-source receipt: incomplete texture/tween/font pixels remain explicitly held. */
export function composeBattleHud(layout,raw,{introAcknowledged=false,fontManifest=null,dpsPreviewToken=null,portraitLane=null}={}){
 check(layout?.schema==='starfall-stage1-raw-dynamic-hud-layout/1'&&same(layout.size,[1334,750]),'Stage1 exact layout required');
 if(!introAcknowledged)return seal({status:'held',commands:[],held:[{reason:sleepLabel}],nativeUnityFrame:false});
 check(raw?.top&&Array.isArray(raw.cards)&&raw.cards.length===5&&
   ['native_init_ops','native_display_ops'].includes(raw.hudPhase)&&Number.isSafeInteger(raw.opsFixedFrame)&&
   Number.isSafeInteger(raw.opsDisplayFrame),'Original HUD operations required');
 check(portraitLane===null||portraitLane===MASK_PREVIEW,'Unknown portrait reconstruction');
 const ops=[],held=[],C=layout.components;
 const dpsPreview=dpsPreviewToken===null?null:dpsSampleValues(dpsPreviewToken,raw);
 const hasFont=fontManifest?.font?.sha256===NATIVE_FONT_ROUTE.faceSha&&Array.isArray(fontManifest?.font?.coverage);
 const names=new Map(Object.entries(layout.images).map(([k,v])=>[v.name,k]).filter(([n])=>n));
 const find=(cid,n)=>{const r=C[cid].rows.find(x=>x.name===n);check(r,'Missing exact HUD node '+cid+'/'+n);return r;};
 const h=(path,reason)=>held.push({path,reason});
 function drawArt(id,pos,w,h,node,opt={}){
   const a=layout.images[id];check(a,'Missing original atlas item '+id);
   check(a.offset.every(x=>x===0)&&same(a.originalSize,a.sourceSize)&&Array.isArray(node.scale??[1,1]),'Unsupported original image trim or scale');
   const p=pieces(a,pos,[w,h],node.scale??[1,1]); 
   ops.push({kind:'atlas',asset:id,sourceSha:a.sha256,path:opt.path,rect:[...pos,w,h],pieces:p,alpha:node.alpha,smoothing:a.smoothing,
    clip:opt.clip??null,tint:opt.tint??null,radial:opt.radial??null});
 }
 function srcArt(n,origin,opt={}){
   const p=plus(origin,n.xy);
   const [w,x]=n.sizeOverride??n.size;
   drawArt(n.sourceId,p,w,x,n,opt);
 }
 function loader(n,origin,request,path,tint=null){
   check(typeof request==='string'&&request.startsWith('ActivityDungeon1017Battle:'),'Unsupported loader namespace');
   const id=names.get(request.split(':')[1]), a=layout.images[id];
   if(!a){h(path,'exact_loader_bytes_not_found');return;}
   const [w,hh]=n.sizeOverride,[sw,sh]=a.sourceSize;
   const ratio=n.loaderMode==='scale_to_fit_centered'?Math.min(w/sw,hh/sh):1;
   const p=plus(plus(origin,n.xy),[(w-sw*ratio)/2,(hh-sh*ratio)/2]);
   drawArt(id,p,sw*ratio,sh*ratio,n,{path,tint});
 }
 function text(node,where,value,path){
   const s=node.authoredTextStyle;
   if(value===null||value===undefined)return;
   const runs=originalRichRuns(String(value),s.colorRgba);
   if(!hasFont||!s||s.fontRef!==NATIVE_FONT_ROUTE.alias||s.bold||s.italic||s.underline||
     !runs.every(x=>Array.from(x.text).every(c=>hasGlyph(fontManifest.font.coverage,c.codePointAt(0))))){h(path,'original_face_or_text_style_not_qualified');return;}
   if(!Array.isArray(node.sizeOverride)){h(path,'unresolved_field_bounds');return;}
   ops.push({kind:'native-face-text',path,rect:rect(plus(where,node.xy),node),runs,style:s});
 }
 const baseText={
   'n6026:NumberTxt':raw.top.speed,'n602i:NumberTxt':raw.top.kills,'n602c:LevelTxt':raw.top.level,'n602c:ExpTxt':raw.top.exp,
   'n602e:TimeTxt':raw.top.time,'n602h:TimeTxt':raw.top.wave,'n60219:NameTxt':raw.top.wallName,'n60219:HPTxt':raw.top.wallHp,
 };
 function walk(cid,at,path,clip=null){
   for(const n of C[cid].rows){
     const key=cid+':'+n.name,label=path+'/'+n.name,p=plus(at,n.xy);
     if(cid==='n60214'&&n.name==='DPSInfoSwitch'){dps(p,label);continue;}
     if(cid==='n60214'&&n.name==='CardList'){roster(n,p,label);continue;}
     if(n.typeName==='Image'&&n.visible){srcArt(n,at,{path:label,clip});continue;}
     if(Object.hasOwn(baseText,key)){text(n,at,baseText[key],label);continue;}
     if(n.typeName==='Component'){
       check(C[n.sourceId],'Unsupported static component');
       let sub=clip;
       if(n.name==='bar'&&(cid==='n6027'||cid==='n60215')){
         const v=cid==='n6027'?raw.top.expFill:raw.top.wallFill;
         check(bounded(v),'Invalid original progress');
         sub=[...p,barWidth(C[n.sourceId].size[0],v),C[n.sourceId].size[1]];
         if(!sub[2])continue;
       }
       walk(n.sourceId,p,label,sub);
     }
   }
 }
 function dps(at,path){
   const d=plus(at,find('n602m','DPS1').xy);
   const bars=find('n602x','DPSProgressBar');
   for(const [i,item] of C.n60210.rows.entries()){
     const a=raw.cards[i],origin=plus(d,item.xy),p=plus(origin,bars.xy),key=path+'/DPS1/'+item.name;
     check(a.slot===i+1&&a.dpsPage===(a.uid===null?1:0),'Unexpected active-card controller');
     if(a.dpsPage)srcArt(find('n602x','n2'),origin,{path:key+'/n2'});
     else loader(find('n602x','PicLoader'),origin,a.circle,key+'/PicLoader');
     // Original updater never toggles this progress component off for empty rows.
     srcArt(find('n602t','n9'),p,{path:key+'/DPSProgressBar/n9'});
     if(a.dpsTweenTo!==null&&dpsPreview===null)h(key+'/DPSProgressBar/bar','game_requested_tween_target_not_rendered_fill');
     else if(dpsPreview?.[i]>0){
       const n=find('n602t','bar'), inner=plus(p,n.xy), fill=find(n.sourceId,'n8');
       check(C[n.sourceId].overflowHidden===true&&bounded(dpsPreview[i]),'DPS preview source disagrees with raw clipping');
       const clip=[...inner,barWidth(C[n.sourceId].size[0],dpsPreview[i]),C[n.sourceId].size[1]];
       if(clip[2]>0)srcArt(fill,inner,{path:key+'/DPSProgressBar/bar/n8',clip});
     }else check(a.dpsAssigned===0,'Unproved DPS initial fill');
     text(find('n602t','NumberTxt'),p,a.damage,key+'/DPSProgressBar/NumberTxt');
   }
 }
 function roster(list,at,path){
   const w=C[list.list.item].size[0],step=w+list.list.columnGap;
   check(w*5+list.list.columnGap*4===list.sizeOverride[0]&&list.list.layout==='FlowHorizontal','Unverified card list layout');
   for(const [i,a] of raw.cards.entries()){
     const origin=plus(at,[step*i,0]),key=path+'/Card'+a.slot,n=k=>find('n6021g',k);
     check(a.cardPage===(a.uid===null?1:0),'Wrong source card visibility');
     srcArt(n(a.cardPage?'n1':'n2'),origin,{path:key+'/frame'});
     if(a.cardPage)continue;
     const bg=n('Bg'),target=plus(origin,bg.xy);
     check(C.n6021c.maskChildIndex===0&&names.has(a.portrait.split(':')[1]),'Missing exact original mask/resource');
     if(portraitLane===MASK_PREVIEW){
       const mask=find('n6021c','n0'),face=find('n6021c','PicLoader'),art=names.get(a.portrait.split(':')[1]);
       check(mask.sourceId===MASK_LAYOUT.maskItem&&same(C.n6021c.size,MASK_LAYOUT.targetSize)&&
        same(mask.xy,MASK_LAYOUT.maskXY)&&same(mask.sizeOverride,MASK_LAYOUT.maskSize)&&
        same(face.xy,MASK_LAYOUT.portraitXY)&&same(face.sizeOverride,MASK_LAYOUT.portraitSize)&&
        same(layout.images[art].sourceSize,MASK_LAYOUT.portraitSize),'Raw mask/portrait geometry changed');
       ops.push({kind:'masked-portrait-preview',path:key+'/Bg/PicLoader',asset:art,maskAsset:MASK_LAYOUT.maskItem,
        sourceSha:layout.images[art].sha256,maskSha:layout.images[MASK_LAYOUT.maskItem].sha256,
        rect:[...target,...MASK_LAYOUT.targetSize],colorPolicy:'straight_atlas_rgb_intrinsic_alpha_coverage',mode:MASK_PREVIEW});
     }else h(key+'/Bg','needs_FGUI_alpha_mask_capture_not_unmasked_portrait');
     if(a.countPage===1){srcArt(n('n5'),origin,{path:key+'/n5'});text(n('NumberTxt'),origin,a.skillSum,key+'/NumberTxt');}
     const sk=n('SkillList'),p=plus(origin,sk.xy),item=sk.list.item,sz=C[item].size[0],gap=sk.list.columnGap;
     check(a.skills.length===3&&sz*3+gap*2===sk.sizeOverride[0],'Wrong original skill grid');
     for(const [i,s] of a.skills.entries()){
       const where=plus(p,[i*(sz+gap),0]),f=k=>find(item,k),k=key+'/Skill'+(i+1);
       check(s.slot===i+1&&[0,1].includes(s.lock),'Wrong skill slot controller');
       loader(f('PicLoader'),where,s.icon,k+'/PicLoader',s.lock?[150,150,150,255]:null);
       if(s.lock)srcArt(f('n15'),where,{path:k+'/n15'});
       else {
         check(bounded(s.assignedCooldown),'Wrong exact skill progress value');
         if(s.assignedCooldown>0){
           const fill=f('bar');
           check(fill.imageStyle.fillMethod===5&&fill.imageStyle.fillOrigin===0&&fill.imageStyle.fillClockwise===false&&fill.imageStyle.fillAmount===1,'Unknown original radial controller');
           srcArt(fill,where,{path:k+'/bar',radial:{fraction:clamp(s.assignedCooldown)/100,origin:'top',clockwise:false}});
         }
         text(f('LevelTxt'),where,s.level,k+'/LevelTxt');
       }
     }
   }
 }
 walk('n6021',[0,0],'HUD');
 return seal({schema:'starfall-stage1-battle-hud-preview/1',status:held.length?'partial-held':'preview',
   width:1334,height:750,sourceOpsFixedFrame:raw.opsFixedFrame,sourceOpsDisplayFrame:raw.opsDisplayFrame,
   commands:ops,held,portraitLane:portraitLane??'strict_native_mask_held',dpsLane:dpsPreview===null?'held_unqualified_native_elapsed':DPS_PREVIEW,nativeUnityFrame:false,blurSourceQualified:false});
}

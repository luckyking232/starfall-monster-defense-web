/** Opt-in diagnostic overlay using authenticated original CFF glyphs. Not native text-layout parity. */
export const NATIVE_FONT_ROUTE=Object.freeze({
  schema:'starfall.monsters-defense.font-gate/1',
  manifest:'/native-font-shell/FONT-GATE.json',manifestSha:'fd94e7d2dd477065e2e730a6d4c1093f162db064414f643bd34f6bce43dee109',
  face:'/native-font-shell/SOURCEHANSANSSC-NORMAL-2.otf',faceSha:'c43383a8ac94024203f062537b5b3a0d0a5bf056172eff78673636ea8fb3c039',
  faceBytes:16523904,alias:'SOURCEHANSANSSC-NORMAL-2',
});
const FAMILY='StarfallOriginal_c43383a8';
const [W,H]=[1334,750];
const sha=async ab=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',ab)),n=>n.toString(16).padStart(2,'0')).join('');
const expect=(test,msg)=>{if(!test)throw Error(msg);};
const number=Number.isFinite;
const rgba=a=>Array.isArray(a)&&a.length===4&&a.every(x=>Number.isInteger(x)&&0<=x&&x<=255);
const box=a=>Array.isArray(a)&&a.length===4&&a.every(number)&&a[2]>=0&&a[3]>=0;
const brush=a=>'rgba('+[a[0],a[1],a[2],a[3]/255].join(',')+')';
const role=Object.freeze({24:[170,34],18:[238,98],19:[180,28]});
const manifestOk=m=>m?.schema===NATIVE_FONT_ROUTE.schema&&m.font.alias===NATIVE_FONT_ROUTE.alias&&m.font.bytes===NATIVE_FONT_ROUTE.faceBytes&&
  m.font.sha256===NATIVE_FONT_ROUTE.faceSha&&Array.isArray(m.font.coverage)&&m.font.metrics.unitsPerEm===1000;
export async function fetchExactNativeFont(fetcher=globalThis.fetch,urlBase=globalThis.location?.origin){
  const prefix='http://127.0.0.1:';
  expect(typeof urlBase==='string'&&urlBase.startsWith(prefix)&&new URL(urlBase).origin===urlBase,
    'Native font only available through explicit loopback');
  const get=async(path,hash,n=null)=>{
    const u=new URL(path,urlBase);
    expect(u.origin===urlBase,'Nonlocal font resource denied');
    const r=await fetcher(u,{cache:'no-store',credentials:'omit',redirect:'error'});
    expect(r.ok,'Original font route not enabled');
    const ab=await r.arrayBuffer();
    expect((n===null||ab.byteLength===n)&&await sha(ab)===hash,'Original font integrity mismatch');
    return ab;
  };
  const bytes=await get(NATIVE_FONT_ROUTE.manifest,NATIVE_FONT_ROUTE.manifestSha);
  const m=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  expect(manifestOk(m),'Wrong original font gate');
  const sfnt=await get(NATIVE_FONT_ROUTE.face,NATIVE_FONT_ROUTE.faceSha,NATIVE_FONT_ROUTE.faceBytes);
  expect(String.fromCharCode(...new Uint8Array(sfnt,0,4))==='OTTO','Unexpected original sfnt signature');
  return {m,sfnt};
}
export function hasGlyph(intervals,n){
  let a=0,b=intervals.length-1;
  while(a<=b){
    const j=(a+b)>>1;
    const [s,e]=intervals[j];
    if(n<s)b=j-1;else if(n>e)a=j+1;else return true;
  }
  return false;
}
export function makeNativeLabelPlan(m,frame,plane){
  expect(manifestOk(m)&&['chooser','outcome','choice'].includes(plane)&&Array.isArray(frame?.labels)&&Array.isArray(frame.commands),'Wrong original label projection');
  const held=[], commands=[];
  if(plane==='choice'){
    // Existing diagram has no authoritative labels' opacity. Do not light text prematurely in the 0.3 s reveal.
    const offerNumber=frame.labels.filter(l=>l.style.fontSize===24).length;
    const settled=frame.commands.filter(n=>['gevl33','gevl35'].includes(n.path)&&n.opacity===1).length===offerNumber &&
      frame.commands.some(n=>n.path==='gevl34'&&n.opacity===1) && frame.commands.every(n=>n.opacity===1);
    if(!settled)return {commands,held:frame.labels.map(t=>({reason:'authored_transition_present',text:t.text})),gate:'native_face_preview_browser_layout'};
  }
  for(const l of frame.labels){
    const s=l.style,t=l.text;
    const rect=l.rect??(plane==='choice'&&Array.isArray(l.xy)&&l.xy.length===2&&role[s?.fontSize]?[...l.xy,...role[s.fontSize]]:null);
    if(typeof t!=='string'||t.length>1200||!s||s.fontRef!==NATIVE_FONT_ROUTE.alias||s.bold||s.italic||s.underline||s.shadow||s.letterSpacing!==0||
      !box(rect)||!(l.clip==null||box(l.clip))||!Number.isInteger(s.fontSize)||s.fontSize<10||s.fontSize>100||
      ![0,1,2].includes(s.align)||![0,1,2].includes(s.verticalAlign)||![0,1,2,3].includes(s.autoSize)||!number(s.leading)||
      !rgba(s.colorRgba)||s.stroke&&(!number(s.stroke.size)||s.stroke.size<0||s.stroke.size>8||!rgba(s.stroke.colorRgba))||/[\[\]{}<>]/u.test(t)||
      !Array.from(t).every(c=>c==='\n'||hasGlyph(m.font.coverage,c.codePointAt(0)))){
      held.push({reason:'outside_exact_font_and_plain_style_scope',text:t});continue;
    }
    if(t.length)commands.push({text:t,rect,clip:l.clip??[0,0,W,H],style:s});
  }
  return {commands,held,gate:'native_face_preview_browser_layout'};
}
function splitLines(c,text,limit,wrapped){
  if(!wrapped)return text.split('\n');
  const rows=[];
  for(const p of text.split('\n')){
    let line='';
    for(const ch of p){
      if(line&&c.measureText(line+ch).width>limit){rows.push(line);line=ch;}
      else line+=ch;
    }
    rows.push(line);
  }
  return rows;
}
function draw(c,plan,metrics){
  c.save();
  try{
    c.setTransform(1,0,0,1,0,0);
    c.globalAlpha=1;
    c.globalCompositeOperation='source-over';
    for(const cmd of plan.commands){
      const {text,rect:[x,y,w,h],clip,style:s}=cmd;
      c.save();
      try{
        c.beginPath(); c.rect(...clip); c.clip();
        c.font=s.fontSize+'px '+FAMILY;
        c.textAlign=['left','center','right'][s.align];
        c.textBaseline='alphabetic';
        c.fillStyle=brush(s.colorRgba);
        const lines=splitLines(c,text,w,s.autoSize===2&&!s.singleLine), scale=s.fontSize/metrics.unitsPerEm;
        const ascent=metrics.ascent*scale,lineHeight=(metrics.ascent-metrics.descent+metrics.lineGap)*scale+s.leading;
        const height=lines.length*lineHeight-s.leading, delta=[0,(h-height)/2,h-height][s.verticalAlign];
        const xx=x+[0,w/2,w][s.align];
        for(const [i,l] of lines.entries()){
          const yy=y+delta+ascent+i*lineHeight;
          if(s.stroke?.size){c.strokeStyle=brush(s.stroke.colorRgba);c.lineWidth=2*s.stroke.size;c.lineJoin='round';c.strokeText(l,xx,yy);}
          c.fillText(l,xx,yy);
        }
      }finally{c.restore();}
    }
  }finally{c.restore();}
}
export async function loadNativeLabelOverlay(canvas,{fetcher=globalThis.fetch,location=globalThis.location,fonts=globalThis.document?.fonts,Face=globalThis.FontFace}={}){
  expect(canvas?.width===W&&canvas?.height===H&&fonts&&typeof Face==='function','Private 1334×750 Canvas and FontFaceSet required');
  const c=canvas.getContext('2d');
  expect(c,'Missing Canvas2D');
  const {m,sfnt}=await fetchExactNativeFont(fetcher,location.origin);
  const face=new Face(FAMILY,sfnt,{style:'normal',weight:'400',display:'block'});
  await face.load();
  expect(face.status==='loaded','Original face did not load');
  fonts.add(face);
  let closed=false;
  return Object.freeze({
    paint(frame,plane){
      expect(!closed&&fonts.has(face),'Original face no longer installed');
      const plan=makeNativeLabelPlan(m,frame,plane);
      draw(c,plan,m.font.metrics);
      return plan;
    },
    close(){if(!closed){closed=true;fonts.delete(face);}},
    status:'exact_source_font_loaded_browser_text_metrics'
  });
}

/** Accepts only already SHA-verified local original manifest and frame commands. */
const check=(cond,reason)=>{if(!cond)throw Error(reason);};
const hex=(bytes)=>Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');
export async function fetchLocalBytes(path,sha){
  const url=new URL(path,location.origin);
  check(location.protocol==='http:'&&location.hostname==='127.0.0.1'&&url.origin===location.origin,'Private HTTP loopback required');
  const r=await fetch(url,{credentials:'omit',redirect:'error',cache:'no-store'});
  check(r.ok,'Missing authorized original input');
  const bytes=await r.arrayBuffer();
  if(sha)check(hex(await crypto.subtle.digest('SHA-256',bytes))===sha,'Original bytes changed');
  return bytes;
}
export function wipe(canvas){
  const c=canvas.getContext('2d');
  c.save();c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,1334,750);c.restore();
}
export async function makeChoicePainter(canvas,data){
  const c=canvas.getContext('2d');
  check(c&&canvas.width===1334&&canvas.height===750,'Native geometry required');
  const base=new URL('/hud-choice/choice-data.json',location.origin);
  const resources=await Promise.allSettled(Object.entries(data.images).map(async([id,a])=>{
    const bytes=await fetchLocalBytes(new URL(a.file,base).href,a.sha256);
    const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}),{premultiplyAlpha:'default',colorSpaceConversion:'none'});
    if(bitmap.width!==a.sourceSize[0]||bitmap.height!==a.sourceSize[1]){bitmap.close();throw Error('Native PNG dimensions changed');}
    return [id,bitmap];
  }));
  const lookup=new Map(resources.filter(x=>x.status==='fulfilled').map(x=>x.value));
  function close(){for(const b of lookup.values())b.close();lookup.clear();}
  if(lookup.size!==resources.length){close();throw Error('Native choice asset failed verification');}
  function paint(model){
    wipe(canvas);
    for(const a of model.commands){
      c.save();
      try{
        const b=lookup.get(a.path);check(b,'Unavailable native choice asset');
        c.globalAlpha=a.opacity;c.imageSmoothingEnabled=a.smoothing;
        if(a.clip){c.beginPath();c.rect(...a.clip);c.clip();}
        for(const p of a.pieces)c.drawImage(b,...p);
      }finally{c.restore();}
    }
  }
  return Object.freeze({paint,close});
}

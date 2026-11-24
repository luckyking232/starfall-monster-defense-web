/** Stage1 presentation observer only. Instantiates the unchanged pinned /1 source loader.
 * This is a distinct classic Worker, never authoritative for rules or writes. */
'use strict';
const EXPECTED='/qualified-game/revisions/r6/later-body-six/stock-source-companion.js';
const baseSHA='03de3649b9fc189c7482150a473ddc64624be0493ced01792bec669d6ae77d6f';
const decoder=new TextDecoder('utf-8',{fatal:true});
let source=null, opening=false, lastSeq=0, pending=Promise.resolve();
const check=(ok,m)=>{if(!ok)throw Error(m);};
async function bytes(path,pin){
  const u=new URL(path,self.location.origin);
  check(u.origin===self.location.origin,'Foreign origin refused');
  const r=await fetch(u,{cache:'no-store',credentials:'omit',redirect:'error'});
  check(r.ok,'Missing source companion input '+path);
  const b=new Uint8Array(await r.arrayBuffer());
  if(pin){
    const h=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),v=>v.toString(16).padStart(2,'0')).join('');
    check(h===pin,'Original Worker loader hash mismatch');
  }
  return b;
}
const profiles=Object.freeze({"78000011":"10b4dae0f45555a9c59fba7150007bd6868996a0d4da6f171de8e619074cd3cb","78000012":"cf99f3efb8c022afd8d9b516875a1a569ce8a97548126bcd0da43099bbd00ebc","78000014":"4e07145913e18372834dea4919766d603b69648f65bc793565eebed4a237fa4a","78000016":"79a347b42ef95b82995b8639b25b7a4353425237990f60acd343707ecc1a0f19","78000017":"81a27b97f29aa20820961f297b7fedebe3f57cde6947e275a03912b61de0a289","78000019":"2144edf18b82771ba84c010f0fae62f52347e4d072ff8fae0890aec5e10210da"});
async function setup(stageId){
  check(self.location.hostname==='127.0.0.1'&&self.location.protocol==='http:'&&self.location.pathname===EXPECTED,
    'Explicit local companion route required');
  const file=decoder.decode(await bytes('/qualified-game/revisions/r6/worker.js',baseSHA));
  const cut='\nfunction deinit(){';
  check(file.split(cut).length===2,'Original loader boundary changed');
  const anchor='api.close=()=>lua.global.close();';
  const anchorURL="new URL(path,path.startsWith('../')?new URL('/qualified-game/worker.js',self.location):self.location)";
  const pinnedHost=file.split(cut)[0];
  check(pinnedHost.split(anchorURL).length===2,'Canonical loader URL boundary changed');
  const orig=pinnedHost.replace(anchorURL,"new URL(path,path.startsWith('../')?new URL('/qualified-game/worker.js',self.location):new URL('/qualified-game/revisions/r6/worker.js',self.location))");
  check(orig.split(anchor).length===2,'Original Lua API boundary changed');
  const exportMarker='\nself.__presentationOpen = makeApi;';
  const qualified=orig.replace(anchor,anchor+'api.inspectPresentationEngine=()=>lua;')+exportMarker;
  const blob=URL.createObjectURL(new Blob([qualified],{type:'text/javascript'}));
  try {importScripts(blob);}finally{URL.revokeObjectURL(blob);}
  const mod=await import('/presentation-clock/source-tap.mjs');
  const artifacts=await Promise.all([
    bytes('/qualified-game/presentation-capability/original-display.lua',mod.DISPLAY_SOURCE),
    bytes('/animation-evidence/trace.lua',mod.REQUEST_TAP),
  ]);
  const {api,profile}=await self.__presentationOpen(stageId);
  check(profile.stageId===stageId&&profile.profilePin===profiles[stageId],'Canonical scene profile identity differs');
  delete self.__presentationOpen;
  try{
    const tap=await mod.installSourceTap(api.inspectPresentationEngine(),{displaySourceBytes:artifacts[0],tapBytes:artifacts[1]});
    const lua=api.inspectPresentationEngine();
    await lua.doString(`local old=MiniGameBattleActionDisplay.PlayMonsterAppearEffect
local row=""
MiniGameBattleActionDisplay.PlayMonsterAppearEffect=function(u,...)
 if row=="" and MiniGameBattleControl.curFixedFrame==1 then
  row=table.concat({u.id,u.uid,u.position.x,u.position.y},string.char(9))
 end
 return old(u,...)
end
function stage910DrainFirstAppear() local r=row;row="";return r end`);
    return {api,tap:{run(phase,wallUs,invoke){
      const c=tap.run(phase,wallUs,invoke);
      const raw=lua.global.get('stage910DrainFirstAppear')();
      return raw?{...c,nonDrawableFirstAppear:raw.split(String.fromCharCode(9)).map(Number)}:c;
    }}};

  }catch(e){api.close();throw e;}
}
const shape=(o,ks)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===ks.length&&ks.every(k=>Object.hasOwn(o,k));
const int=(v,a,b)=>Number.isSafeInteger(v)&&v>=a&&v<=b;
function full(){
  return self.decodeStage1Snapshot(source.api.Snapshot());
}
async function execute(m){
  check(m&&m.seq===lastSeq+1&&int(m.seq,1,2147483647)&&int(m.wallUs,0,10_000_000_000),'Bad companion ordering');
  lastSeq=m.seq;
  const plus=(...ks)=>shape(m,['seq','kind','wallUs',...ks]);
  if(m.kind==='init'){
    check(!source&&!opening&&plus('rng','stageId')&&Number.isSafeInteger(m.stageId)&&Object.hasOwn(profiles,m.stageId)&&m.wallUs===0&&shape(m.rng,['tape','globalRngSeeds'])&&
      m.rng.tape?.length===50&&m.rng.tape.every(x=>int(x,1,10000))&&m.rng.globalRngSeeds?.length===2&&
      m.rng.globalRngSeeds.every(x=>int(x,0,2147483647)),'Invalid exact companion input');
    opening=true;
    source=await setup(m.stageId);
    const boot=source.tap.run('boot',0,()=>source.api.Start(m.rng.tape.join(','),...m.rng.globalRngSeeds));
    return {state:full(),callbacks:[boot]};
  }
  check(source,'Companion not initialized');
  const {tap,api}=source, cb=[];
  if(m.kind==='fixed'){
    check(plus('count')&&int(m.count,1,8),'Bad companion fixed quota');
    for(let i=0;i<m.count;i++){
      let n;
      cb.push(tap.run('fixed',m.wallUs,()=>{n=api.Fixed(1);}));
      check(n===1,'Companion fixed counter diverged');
    }
  }else if(m.kind==='display'){
    check(plus()&&!full().paused&&!full().terminal,'No display callback when source paused or terminal');
    cb.push(tap.run('display',m.wallUs));
  }else{
    let f;
    if(m.kind==='clock'&&plus('ms')&&int(m.ms,0,60_000))f=()=>api.Clock(m.ms);
    if(m.kind==='speed'&&plus('index')&&(m.index===1||m.index===2))f=()=>api.Speed(m.index);
    if(m.kind==='select'&&plus('selection')&&shape(m.selection,['windowId','generation','skillId','confirm'])&&
      int(m.selection.windowId,1,2147483647)&&int(m.selection.generation,1,2147483647)&&
      int(m.selection.skillId,78000000,78999999)&&typeof m.selection.confirm==='boolean'){
      const {windowId,generation,skillId,confirm}=m.selection;
      f=()=>api.Select(windowId,generation,skillId,confirm);
    }
    if(m.kind==='pause'&&plus())f=()=>api.Pause();
    if(m.kind==='resume'&&plus())f=()=>api.Resume();
    check(f,'Unsupported presentation companion instruction');
    cb.push(tap.run('wallclock',m.wallUs,f));
  }
  const snapshot=full();
  return {state:snapshot,callbacks:snapshot.terminal?[]:cb};
}
let failed=false;
self.onmessage=({data:m})=>{
  pending=pending.then(async()=>{
    try {
      check(!failed,'Companion closed after invalid input or divergence');
      self.postMessage({seq:m?.seq,ok:true,...await execute(m)});
    }catch(e){
      failed=true;
      if(source){source.api.close();source=null;}
      self.postMessage({seq:m?.seq,ok:false,error:String(e?.message??e)});
    }
  });
};

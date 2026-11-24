/** Stage1 presentation observer only. Instantiates the unchanged pinned /1 source loader.
 * This is a distinct classic Worker, never authoritative for rules or writes. */
'use strict';
const EXPECTED='/qualified-game/revisions/r6/stage1-2011-companion-probe/companion.js';
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
const profiles=Object.freeze({"78000001":"ae4ad974aad1c7e26022b320a4be574c90c0dde882a941b6789c2fe072f56ad0","78000002":"e3984994c93e2bcde00c47a0584d6a7e8706fc850196c2dbe204c137f39d959a"});
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
    check(stageId===78000001,'HUD source is Stage1 only');
    const hud=api.inspectPresentationEngine(), [tm,ui,caption,shim]=await Promise.all([bytes("/qualified-game/presentation-capability/scene-profiles/stage1-hud/hud-time.lua","5c3a6db2442946d2d6629586d274f8784120c2a7b89cff156c4043272b7513c2").then(b=>decoder.decode(b)),bytes("/qualified-game/presentation-capability/scene-profiles/stage1-hud/hud-original.lua","61604a632913795c4406561331f914923cd22dc2bd3d1a1f45fbcca9f911929b").then(b=>decoder.decode(b)),bytes("/qualified-game/presentation-capability/scene-profiles/stage1-hud/captions.lua","8b06baea1cd5a4fefa98286a84cebe67fe513ba216c8f88ba4bc2440d938a30b").then(b=>decoder.decode(b)),bytes('/battle-hud-presentation/oracle.lua','d80ba2330358fbea431ed41cccc1948c794acf9da005db4af6ca05f0cad8c204').then(b=>decoder.decode(b))]);
    await hud.doString('TimeUtil=(function()\n'+tm+'\nend)()\nAuditBattleHud=(function() local require=function()end;\n'+ui+'\nend)();\n'+caption+shim);
    const hf=k=>hud.global.get(k);
    const [raw,threshold]=await Promise.all([
      bytes('/particle-presentation/slowmotion-lifecycle/source-tap.lua','e94a180c718aaa1e5acdd15cbc88965b14ab0032cae7c3910792d3fb68b18688'),
      bytes('/qualified-game/revisions/r6/composed-stage78-body/slow-threshold.lua','bdaa61b434b44e314f6a4a8d08ca3c6e42da8d80b28e3b93adb43b30fa4a8a85'),
    ]);
    await hud.doString(decoder.decode(raw)+'\n'+decoder.decode(threshold));
    const lines=x=>x.split('\n').filter(Boolean).map(y=>y.split('\t'));
    const scoped={run(phase,wallUs,invoke){
      const p=phase==='wallclock'?'control':phase;
      hf('slowmotionTapBegin')(p);
      const cb=tap.run(phase,wallUs,invoke);
      const [fx,dx,paused,...tail]=hf('slowmotionTapEnd')().split('\n');
      check(+fx===cb.fixedFrame&&+dx===cb.displayFrame,'Unbound Stage1 Slowmotion verified source stamp');
      return {...cb,slow:{phase:p,fixed:+fx,display:+dx,paused:+paused,rows:lines(tail.join('\n')),threshold:lines(hf('slowThresholdDrain')())}};
    }};
    return {api,tap:scoped,hf};
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
    const boot=source.tap.run('boot',0,()=>{source.api.Start(m.rng.tape.join(','),...m.rng.globalRngSeeds);source.hf('hudOracleInit')();});
    return {state:full(),callbacks:[boot],hudOps:source.hf("hudOracleRead")()};
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
    return {state:full(),callbacks:cb,hudOps:source.hf('hudOracleRead')()};
  }else{
    let f;
    if(m.kind==='clock'&&plus('ms')&&int(m.ms,0,60_000))f=()=>api.Clock(m.ms);
    if(m.kind==='speed'&&plus('index')&&(m.index===1||m.index===2))f=()=>{api.Speed(m.index);source.hf('hudOracleSpeedRefresh')();};
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
  return {state:snapshot,callbacks:snapshot.terminal?[]:cb, terminalSlow:snapshot.terminal?cb:[]};
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

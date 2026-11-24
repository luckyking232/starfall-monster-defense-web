import assert from 'node:assert/strict';
import {createContext} from 'node:vm';
import {Worker as NodeWorker} from 'node:worker_threads';
import {httpModuleLoader,common,realFetch} from './vm-http.mjs';
const base=process.argv[2],list=JSON.parse(process.argv[3]),used=[],handles=[];
class W{
 constructor(u){
  const entry=String(u),p='/'+entry.slice(base.length);
  assert.ok(entry.startsWith(base)&&list.includes(p));
  this.w=new NodeWorker(new URL('./classic-test-worker.mjs',import.meta.url),{workerData:{base,entry},execArgv:['--experimental-vm-modules']});
  used.push(p);handles.push(this.w);
 }
 addEventListener(k,f){this.w.on(k,x=>f(k==='message'?{data:x}:x));}
 postMessage(x){this.w.postMessage(x);}terminate(){return this.w.terminate();}
}
const progress=process.env.STARFALL_PROGRESS_BUILD==='1',storage=new Map(), writes=[];
const localStorage={getItem:k=>storage.get(k)??null,setItem(k,v){writes.push([k,v]);storage.set(k,v);}};
const ctx=createContext(common(base,{Worker:W,localStorage,fetch(input,opts){
 assert.ok(String(input).startsWith(base),String(input));return realFetch(input,opts);
}}));
ctx.self=ctx;
const loader=httpModuleLoader(ctx,base),mod=async p=>(await loader(new URL(p,base).href)).namespace;
const authority='/qualified-game/revisions/r6/worker.js';
let shell,open;
try{
 const {P}=await mod('portable.mjs');
 assert.equal(P.location.pathname,'/qualified-game/');
 assert.throws(()=>new P.URL('https://blocked.invalid/no'),/foreign/u);
 assert.throws(()=>new P.URL('../outside',base),/foreign/u);
 assert.throws(()=>new P.URL('/%2fescape',P.location.origin),/invalid/u);
 await assert.rejects(P.fetch('/not-allowlisted'),/unlisted/u);
 assert.throws(()=>new P.Worker(new P.URL('/activity-flow/activity-catalog.json',P.location.origin)),/unlisted/u);
 const bytes=(...a)=>P.fetch(...a).then(x=>x.arrayBuffer());
 const resources=['/activity-flow/activity-catalog.json','/hud-choice/choice-data.json','/screen-shell/shell-data.json'];
 const [activityCatalogBytes,choiceCatalogBytes,b]=await Promise.all(resources.map(x=>bytes(x)));
 const screenManifest=JSON.parse(new TextDecoder().decode(b));
 // Parse the portable entry module's full static graph; it must link without launching browser-only UI.
 const doc=await (await realFetch(base+'index.html')).text();
 assert.ok(doc.includes('Content-Security-Policy'));
 const entry=/<script\b[^>]*src="([^"]+)"/u.exec(doc)[1];assert.ok(entry.startsWith('./'));
 const entryModule=await loader.linkOnly(new URL(entry,base).href);assert.equal(entryModule.status,'linked');
 const stylesheet=[...doc.matchAll(/<link rel="stylesheet" href="([^"]+)"[^>]*>/gu)].map(x=>x[1]);
 assert.ok(stylesheet.length>=8&&stylesheet.every(x=>x.startsWith('./')));
 for(const path of stylesheet)assert.equal((await realFetch(new URL(path,base))).headers.get('content-type'),'text/css');
 // The real Session Worker and portable route bridge must discover all Lua/WASM under this exact nested URL.
 const {openMultistageGameSession}=await mod('qualified-game/revisions/r6/site/session.mjs');
 const {createMultistageShell}=await mod('qualified-game/revisions/r6/site/shell.mjs');
 const {openProgressStore}=progress?await mod('_portable/progress-store.mjs'):{};
 const opts={activityCatalogBytes,choiceCatalogBytes},saved=progress?openProgressStore(P.base):undefined;
 if(progress)await assert.rejects(openMultistageGameSession({...opts,progressStore:{load:()=>({score:78000020})}}),/scoped local progress/u);
 const session=await openMultistageGameSession({...opts,progressStore:saved});

 shell=createMultistageShell({session,screenManifest,makeRng:id=>({tape:Array(50).fill(1),globalRngSeeds:[70441022,id]})});
 const snapshot={activityId:70060517,startStamp:1752365557,timezoneOffset:28800,serverStamp:1753365557,
  miniHighScore:0,miniDailyStat:0,miniDailyNum:0,taskList:[]};
 if(progress)await assert.rejects(shell.command('snapshot',{...snapshot,miniHighScore:78000019}),/external score zero/u);
 await shell.command('snapshot',snapshot);
 await shell.command('open-chooser');
 const hit=(h)=>shell.pointer(h.rect[0]+h.rect[2]/2,h.rect[1]+h.rect[3]/2);
 const select1=async()=>(await hit(shell.frame().model.hits.find(h=>h.kind==='stage'&&h.index===0))).state;
 let q=await select1();
 if(progress){
  await shell.command('start-fixed');await shell.command('leave');await shell.command('confirm-leave');
  await assert.rejects(session.finishSettlement({runId:'fake-receipt',status:'success'}),/current run/u);
  await shell.command('ack','success');assert.equal(writes.length,0);
  await hit(shell.frame().model.hits.find(h=>h.kind==='result-close'));q=await select1();
 }

 assert.equal(q.battle.selfHp,5000);
 await shell.command('start-fixed');await shell.command('fixed',300);await shell.command('fixed',1);
 assert.equal(shell.frame().state.phase,'upgrade');
 await shell.command('unscaled',401);
 const ranks=[78010130,78010230,78010120,78010131,78010132,78010133,78010231,78010232,78010233,78010112,78010113,78010212,78010213,78010121,78010122,78010123,78010111,78010211];
 async function pick(){
  const choices=shell.frame().model.targets.filter(a=>a.target==='offer');
  const chosen=ranks.find(x=>choices.some(v=>v.skillId===x));
  await hit(choices.find(v=>v.skillId===chosen)??choices[0]);
  await hit(shell.frame().model.targets.find(a=>a.target==='confirm'));
 }
 await pick();assert.equal(shell.frame().state.phase,'battle');
 for(let i=0;i<80;i++){
  const st=await shell.command('fixed',300);
  if(st.phase==='settlement')break;
  if(st.phase!=='upgrade')continue;
  await shell.command('unscaled',401);await pick();
 }
 if(progress)assert.equal(writes.length,0,'no write before confirmed natural settlement');
 const won=shell.frame().state;
 assert.equal(won.phase,'settlement');assert.ok(won.battle.terminal.win);
 assert.deepEqual([won.battle.fixedFrame,won.battle.killEnemyCount],[3398,205]);
 await shell.command('ack','success');
 await hit(shell.frame().model.hits.find(h=>h.kind==='result-close'));
 assert.equal(shell.frame().state.localHighScore,78000001);
 assert.equal(shell.frame().state.chooser.stages[1].result.kind,'battle');
 assert.deepEqual(used,[authority]);
 if(progress){
  assert.equal(writes.length,1);assert.equal(saved.status.score,78000001);
  assert.ok(writes[0][0].includes(P.base));
  assert.equal(JSON.parse(writes[0][1]).settlement,'confirmed_natural_win');
  const resumed=await openMultistageGameSession({...opts,progressStore:openProgressStore(P.base)});
  try{
   await resumed.pushSnapshot(snapshot);
   const x=await resumed.openChooser();
   assert.equal(x.localHighScore,78000001);assert.equal(x.externalHighScore,0);
   assert.equal(x.chooser.stages[1].result.kind,'battle');assert.equal(writes.length,1);
  }finally{resumed.dispose();}
 }
 const {fetchExactNativeFont}=await mod('native-font-shell/native-labels.mjs');
 const font=await fetchExactNativeFont();assert.ok(font.sfnt.byteLength===16523904);
 // Test a real scoped original display companion and stock CPU rendering via the relocated module graph.
 const {makeMultistageRulesClient}=await mod('qualified-game/revisions/r6/client.mjs');
 const stage7=78000007,rng={tape:Array(50).fill(1),globalRngSeeds:[70441022,stage7]};
 const client=makeMultistageRulesClient();
 const frostPath='qualified-game/revisions/r6/stage78-frost-source-witness/';
 try{
  const {SCENES}=await mod('qualified-game/revisions/r6/composed-stage20-full-early-hud/scene-profiles.mjs');
  const {createStage78CpuRenderer}=await mod('stage78-cpu-canvas/stage78-cpu.mjs');
  const {openCanonicalObserver,EXPLICIT_LANE}=await mod(frostPath+'observer.mjs');
  const {input,nativeIndexSha256}=SCENES[stage7];let displayed=0,typed=0;
  const r=await createStage78CpuRenderer({width:1334,height:750,getContext(){return {
   createImageData:(x,y)=>({data:new Uint8ClampedArray(x*y*4)}),
   putImageData(data){assert.equal(data.data.length,1334*750*4);displayed++;},clearRect(){}}}},
   input,{indexSha256:nativeIndexSha256});
  const packet=await client.start({stageId:stage7,...rng});
  open=await openCanonicalObserver({stageId:stage7,lane:EXPLICIT_LANE,expectedOrigin:P.location.origin,
   nativeIndexBytes:await bytes(input),renderer:r,onFrostEvidence:x=>{assert.equal(x.stageId,stage7);typed++;}});
  let x=await open.begin(packet,rng);
  assert.equal(x.frame.display.fixedFrame,0);
  let next=await client.stepFixed(1);
  x=await open.observe({type:'step-fixed',count:1},next,50000);
  assert.equal(x.frame.display.fixedFrame,1);assert.ok(displayed===2&&typed===2);
  assert.deepEqual(used,[authority,authority,'/'+frostPath+'companion.js']);
  r.destroy();
 }finally{client.dispose();}

 if(progress){
  const {SCENES}=await mod('qualified-game/revisions/r6/stage910-body-probe/scene-profiles.mjs');
  const {createStage910CpuRenderer}=await mod('stage910-cpu-canvas/stage910-cpu.mjs');
  for(const stage of [9,10]){
   const id=78000000+stage,dir='qualified-game/revisions/r6/stage'+stage+'-fx-only-summons/';
   const {openCanonicalObserver,EXPLICIT_LANE}=await mod(dir+'observer.mjs');
   const {input,nativeIndexSha256}=SCENES[id];
   let draws=0,death=null,omission=false,cleared=false,ct=0;
   const r=await createStage910CpuRenderer({width:1334,height:750,getContext(){return {
    createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){draws++;},clearRect(){}}}},input,{indexSha256:nativeIndexSha256});
   const local=makeMultistageRulesClient();
   const rng={tape:Array(50).fill(5000),globalRngSeeds:[70441022,id]};
   try{
    let packet=await local.start({stageId:id,...rng});
    open=await openCanonicalObserver({stageId:id,lane:EXPLICIT_LANE,expectedOrigin:P.location.origin,
     nativeIndexBytes:await bytes(input),renderer:r,onDeathStatus:x=>{death=x;},
     onOmissions:x=>{if(x.frame&&x.omissions.length){assert.ok(x.omissions.every(y=>y.ownerCard===78000103&&y.cardId===78000302));omission=true;}}});
    await open.begin(packet,rng);
    const frames=stage===9?[1,828,1419,1740,1800,1847,1848,1880,1920,1970,2050,2200]:[1,828,1377,1509,1540,1600,1809,2000,2200];
    let observedTemporaryDeath=false;
    async function m(action,next){
     packet=await next;const w=draws;
     const x=await open.observe(action,packet,ct);
     if(death){assert.equal(x.frame,null);assert.equal(draws,w);observedTemporaryDeath=true;}
     if(observedTemporaryDeath&&x.frame){assert.ok(draws>w);cleared=true;}
     return x;
    }
    while(packet.state.fixedFrame<2200){
     const q=packet.state.choice;
     if(q){
      ct+=401000;await m({type:'advance-unscaled',ms:401},local.advanceUnscaled(401));
      const selection={windowId:q.windowId,generation:q.generation,skillId:q.offerIds[0],confirm:true};
      await m({type:'select',selection},local.select(selection));
     }else{
      const n=packet.state.fixedFrame,n1=frames.find(x=>x>n)??2200,count=Math.min(180,n1-n);
      ct+=50000;await m({type:'step-fixed',count},local.stepFixed(count));
     }
    }
    assert.equal(packet.state.fixedFrame,2200);assert.ok(omission&&observedTemporaryDeath&&cleared);
    assert.ok(used.includes('/'+dir+'companion.js'));
   }finally{open?.close();open=null;local.dispose();r.destroy();}
  }
 }
 console.log(JSON.stringify({root:base,stage:q.battle.stageId,fixed:301,wallHp:q.battle.selfHp,offerConfirmed:true,stage1NaturalWin:[3398,205],stage2Unlocked:true,
  sourceWorker:true,savedAndReloaded:progress,typedStage9and10Fx:progress,typedStage7Companion:true,exactFontBytes:font.sfnt.byteLength,actualBrowser:false,manifestBytes:choiceCatalogBytes.byteLength}));
}finally{
 shell?.dispose();open?.close();await Promise.allSettled(handles.map(h=>h.terminate()));
}

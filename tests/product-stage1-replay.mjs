/** Actual packaged Lua/Wasm and observation Worker regression (Node 24+, not browser QA). */
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createServer} from 'node:http';
import {registerHooks} from 'node:module';
import {setTimeout as sleep} from 'node:timers/promises';

const input=process.argv[2];
assert.ok(input,'usage: node tests/product-stage1-replay.mjs BUILT_PRODUCT');
const root=resolve(input),mount='/verification/product/replay/';
const files=new Map(readdirSync(root,{recursive:true,withFileTypes:true}).filter(x=>x.isFile()).map(ent=>{
 const path=resolve(ent.parentPath,ent.name);
 const rel=path.slice(root.length+1).split('/').map(encodeURIComponent).join('/');
 return [mount+rel,path];
}));
const server=createServer((req,res)=>{
 const path=req.method==='GET'&&files.get(req.url);
 if(!path){res.writeHead(404).end();return;}
 res.setHeader('Content-Type',path.endsWith('.wasm')?'application/wasm':'application/octet-stream');
 res.end(readFileSync(path));
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const base='http://127.0.0.1:'+server.address().port+mount,baseDir='qualified-game/revisions/r6/';
const hook=registerHooks({
 resolve(spec,ctx,next){
  if(spec.startsWith(base))return {url:spec,shortCircuit:true};
  if(ctx.parentURL?.startsWith(base)&&spec.startsWith('.'))return {url:new URL(spec,ctx.parentURL).href,shortCircuit:true};
  return next(spec,ctx);
 },
 load(url,ctx,next){
  if(url.startsWith(base))return {format:'module',source:readFileSync(files.get(new URL(url).pathname),'utf8'),shortCircuit:true};
  return next(url,ctx);
 }
});
let commits=0,workerFailure=null,shell,world;
const workers=[],stash=new Map();
globalThis.location=new URL(base+'index.html');
globalThis.localStorage={getItem:k=>stash.get(k)??null,setItem:(k,v)=>stash.set(k,v)};
globalThis.Worker=class{
 constructor(u){
  this.handle=new Worker(new URL('./support/classic-rule-worker.mjs',import.meta.url),
    {workerData:{root,base,entry:String(u)},execArgv:['--experimental-vm-modules']});
  this.handle.on('error',e=>{workerFailure??=e;});
  workers.push(this.handle);
 }
 addEventListener(kind,fn){this.handle.on(kind,x=>fn(kind==='message'?{data:x}:x));}
 postMessage(m){this.handle.postMessage(m);}
 terminate(){return this.handle.terminate();}
};
const canv=()=>({width:1334,height:750,getContext(kind){
 if(kind==='webgl2')return null;
 assert.equal(kind,'2d');
 return {createImageData(w,h){return {data:new Uint8ClampedArray(w*h*4),width:w,height:h};},
 putImageData(f){assert.equal(f.data[3],255);assert.equal(f.data.at(-1),255);commits++;},clearRect(){}};
}});
const panel={dataset:{},querySelector:q=>q.includes('hud')?{dataset:{}}:canv()};
const hint={},glCanvas={...canv(),parentElement:panel};
globalThis.document={hidden:false,querySelector(){return {};}};
try{
 const {openWorldLayer}=await import(base+baseDir+'cloud-temporary-20108-cpu/site-layer.mjs');
 const {openProgressStore}=await import(base+'_portable/progress-store.mjs');
 const {openMultistageGameSession}=await import(base+baseDir+'site/session.mjs');
 const {createMultistageShell}=await import(base+baseDir+'site/shell.mjs');
 const [activityCatalogBytes,choiceCatalogBytes,screen]=await Promise.all([
  'activity-flow/activity-catalog.json','hud-choice/choice-data.json','screen-shell/shell-data.json'
 ].map(async k=>{const r=await fetch(base+k);assert.ok(r.ok,k);return r.arrayBuffer();}));
 world=openWorldLayer(glCanvas,hint,()=>{});
 const session=await openMultistageGameSession({activityCatalogBytes,choiceCatalogBytes,
  WorkerClass:world.WorkerClass,progressStore:openProgressStore(base)});
 shell=createMultistageShell({session,screenManifest:JSON.parse(new TextDecoder().decode(screen)),
  makeRng:stageId=>({tape:Array(50).fill(5000),globalRngSeeds:[70441022,stageId]})});
 const now=()=>shell.frame().state,center=x=>{
  assert.ok(x);const [a,b,c,d]=x.rect;return [a+c/2,b+d/2];
 };
 async function settle(){
  for(let n=0;n<600;n++){
   if(workerFailure)throw workerFailure;
   if(world.presentationError())throw world.presentationError();
   world.update(shell.frame());
   if(!world.presentationBusy()&&(world.cpuVisible()||['settlement','result'].includes(now().phase)))return;
   await sleep(10);
  }
  throw new Error('Missing display at '+now().battle?.fixedFrame+': '+hint.textContent);
 }
 const command=(...args)=>shell.command(...args);
 await command('snapshot',{activityId:70060517,startStamp:1752365557,timezoneOffset:28800,serverStamp:1753365557,
  miniHighScore:0,miniDailyStat:0,miniDailyNum:0,taskList:[]});
 await command('open-chooser');await shell.pointer(...center(shell.frame().model.hits.find(x=>x.kind==='stage'&&x.index===0)));
 await settle();await command('start-fixed');await command('speed',2);await settle();
 const picks=[0,0,0,1,0,1,1,1,1,1,1],choices=[];
 for(let n=0;n<300&&!['settlement','result','fault'].includes(now().phase);n++){
  const s=now();
  if(s.phase==='upgrade'){
   const targets=()=>shell.frame().model?.targets.filter(x=>x.target==='offer')??[];
   if(targets().length<(s.battle.choice?.offerIds.length??3)){await command('unscaled',701);await settle();}
   const o=targets()[picks[choices.length]];
   await shell.pointer(...center(o));await settle();
   await shell.pointer(...center(shell.frame().model.targets.find(x=>x.target==='confirm')));await settle();
   choices.push([s.battle.fixedFrame,o.skillId]);
  }else{await command('fixed',40);await settle();}
 }
 const {battle,phase}=now();
 assert.equal(phase,'settlement');
 assert.deepEqual([battle.fixedFrame,battle.curMonsterWave,battle.killEnemyCount],[4181,2,205]);
 assert.deepEqual(choices,[[344,78010211],[654,78010211],[1052,78010211],[1660,78010130],[1842,78010212],
  [2022,78010120],[2308,78010122],[2645,78010122],[3042,78010211],[3423,78010211],[3822,78010211]]);
 await command('ack','success');assert.equal(now().phase,'result');
 assert.equal(stash.size,1);assert.match([...stash.values()][0],/confirmed_natural_win/);
 assert.ok(commits>50);
 console.log('Stage 1 Node replay: frame 4181, 2 waves, 205 kills, 11 choices, 1 saved win, '+commits+' Canvas2D submissions.');
}finally{
 shell?.dispose();world?.close();await Promise.allSettled(workers.map(w=>w.terminate()));
 hook.deregister();server.close();
}

import {map3CpuStatus} from '../cloud-stage1to20-cpu/group-admission.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {createPrivateR6Server} from '../composed-stage20-edge-hp-stage1-2011/server.mjs';
import {openWorldLayer} from './site-layer.mjs';
import {openMultistageGameSession} from '../site/session.mjs';
import {createMultistageShell} from '../site/shell.mjs';
const center=({rect:[x,y,w,h]})=>[x+w/2,y+h/2];
const sleep=()=>new Promise(r=>setTimeout(r,20));
const stage2=78000008,stage3=78000009;
test('unchanged observer and authority emit original Stage9 scene hides exact authored empty 20108 die then resumes pixels through exact Canvas2D branch', {timeout:35000}, async()=>{
 const site=await createPrivateR6Server({enableR6:true}),origin=new URL(site.url).origin;
 const old={}, workers=[], entries=[];
 function use(k,v){old[k]=Object.getOwnPropertyDescriptor(globalThis,k);Object.defineProperty(globalThis,k,{configurable:true,value:v});}
 let world,shell,commits=0,firstColor,lastColor;
 const cpuCanvas={width:1334,height:750,getContext(k,opts){
   assert.equal(k,'2d');assert.deepEqual(opts,{alpha:true});return {createImageData(w,h){return {width:w,height:h,data:new Uint8ClampedArray(w*h*4)};},
    putImageData(r,x,y){assert.equal(x,0);assert.equal(y,0);assert.equal(r.data.length,1334*750*4);
     firstColor=[...r.data.slice(0,4)];lastColor=[...r.data.slice(-4)];commits++;},clearRect(){}};
 }};
 const hud={dataset:{}},hudHint={},hint={};
 const panel={dataset:{},querySelector(q){if(q==='#stock78-cpu-world')return cpuCanvas;if(q==='#map3-cpu-world')return {width:1334,height:750};if(q==='#stage2-cpu-world')return {width:1334,height:750};if(q==='#stage1-cpu-world')return {width:1334,height:750};if(q==='#canonical-hud'||q==='#stage78-hud')return hud;throw Error(q);}};
 const glCanvas={parentElement:panel,getContext(k){assert.equal(k,'webgl2');return null;}};
 class Transport{
   constructor(url){
     const u=new URL(url),entry=u.protocol==='file:'?'/qualified-game/revisions/r6/worker.js':u.pathname;
     entries.push(entry);
     this.handle=new Worker(new URL('../temporary-20108-die/qa-worker.mjs',import.meta.url),
       {workerData:{origin,entry},execArgv:['--experimental-vm-modules']});workers.push(this.handle);
   }
   addEventListener(k,f){this.handle.on(k,v=>f(k==='message'?{data:v}:v));}
   postMessage(m){this.handle.postMessage(m);}
   terminate(){return this.handle.terminate();}
 }
 try{
   use('location',new URL('/qualified-game/',origin));
   use('Worker',Transport);
   use('document',{hidden:false,querySelector(q){assert.equal(q,'#hud-preview-status');return hudHint;}});
   const load=async p=>{const r=await fetch(origin+p);assert.equal(r.status,200);return r.arrayBuffer();};
   const [activityCatalogBytes,choiceCatalogBytes,screen]=await Promise.all(['/activity-flow/activity-catalog.json','/hud-choice/choice-data.json','/screen-shell/shell-data.json'].map(load));
   world=openWorldLayer(glCanvas,hint,()=>{if(shell)world.update(shell.frame());});
   const session=await openMultistageGameSession({activityCatalogBytes,choiceCatalogBytes,WorkerClass:world.WorkerClass});
   shell=createMultistageShell({session,screenManifest:JSON.parse(new TextDecoder().decode(screen)),makeRng:stageId=>({tape:Array(50).fill(1),globalRngSeeds:[70441022,stageId]})});
   await shell.command('snapshot',{activityId:70060517,startStamp:1752365557,timezoneOffset:28800,serverStamp:1753365557,miniHighScore:stage2,miniDailyStat:0,miniDailyNum:0,taskList:[]});
   await shell.command('open-chooser');
   const target=()=>shell.frame().model.hits.find(x=>x.kind==='stage'&&x.index===8);
   for(let i=0;!target()&&i<=2846;i+=50)shell.setScroll(i);
   await shell.pointer(...center(target()));
   assert.equal(shell.frame().state.battle.stageId,stage3);
   async function rendered(){
    const until=performance.now()+18000;
    while(performance.now()<until){
     if(world.update(shell.frame())&&!world.syncing())return;
     await sleep();
    }
    assert.fail(hint.textContent);
   }
   await rendered();assert.ok(commits>0);assert.deepEqual([firstColor[3],lastColor[3]],[255,255]);assert.notDeepEqual(firstColor,lastColor);
   assert.equal(panel.dataset.stock78CpuVisible,'true');assert.equal(world.map3CpuVisible(),true);assert.equal(world.cpuVisible(),false);
   assert.match(hudHint.textContent,/不绘战斗 HUD 或升级背景模糊/u);
   assert.deepEqual(entries,['/qualified-game/revisions/r6/worker.js','/qualified-game/revisions/r6/temporary-20108-die/companion.js']);
   assert.match(hint.textContent,/原阴影/u);
   const outer=shell.frame();
   assert.equal(outer.plane,'held');assert.equal(outer.model,null);
   assert.equal(world.map3CpuVisible(),true);
   assert.match(map3CpuStatus(outer.state.scope.stageId),/^第 9 关兼容/u);
   await shell.command('start-fixed');
   let actual=0;
   while(actual<828){
    const x=await shell.command('fixed',Math.min(40,828-actual));
    actual=x.battle.fixedFrame;
    if(x.phase==='upgrade'){
     assert.equal(world.update(shell.frame()),false);assert.equal(world.syncing(),false);
     await shell.command('unscaled',401);
     const rank=v=>0;
     const cards=shell.frame().model.targets.filter(v=>v.target==='offer').toSorted((a,b)=>rank(b)-rank(a));
     await shell.pointer(...center(cards[0]));
     await shell.pointer(...center(shell.frame().model.targets.find(x=>x.target==='confirm')));
    }
    await rendered();
   }
   assert.equal(shell.frame().state.battle.fixedFrame,828);
   assert.ok(commits>20);assert.equal(panel.dataset.stock78CpuVisible,'true');assert.equal(panel.dataset.map3CpuVisible,'false');
   while(actual<1517){
    const x=await shell.command('fixed',actual>=1500?1:Math.min(40,1500-actual));
    actual=x.battle.fixedFrame;
    if(x.phase==='upgrade'){
     await shell.command('unscaled',401);
     await shell.pointer(...center(shell.frame().model.targets.find(v=>v.target==='offer')));
     await shell.pointer(...center(shell.frame().model.targets.find(v=>v.target==='confirm')));
    }
    if(actual<1517)await rendered();
   }
   const until=performance.now()+3000;
   while(!hint.textContent.includes('20108')&&performance.now()<until){world.update(shell.frame());await sleep();}
   assert.match(hint.textContent,/20108 原死亡动画无可核验画面/u);assert.equal(actual,1517);
   assert.equal(world.update(shell.frame()),false);assert.equal(panel.dataset.stock78CpuVisible,'false');assert.equal(world.syncing(),false);
   const stopped=commits;
   for(const next of [1525,1547]){
    await shell.command('fixed',next-shell.frame().state.battle.fixedFrame);
    assert.equal(shell.frame().state.battle.fixedFrame,next);
    const deadline=performance.now()+2000;
    while(performance.now()<deadline&&!hint.textContent.includes('暂时隐藏')){world.update(shell.frame());await sleep();}
    assert.equal(world.update(shell.frame()),false);assert.equal(commits,stopped);
    assert.match(hint.textContent,/原对象移除后才显示新画面/u);
    assert.equal(world.syncing(),false);
   }
   await shell.command('fixed',1);assert.equal(shell.frame().state.battle.fixedFrame,1548);
   await rendered();assert.equal(panel.dataset.stock78CpuVisible,'true');assert.equal(commits,stopped+1);
   assert.doesNotMatch(hint.textContent,/暂时隐藏/u);assert.equal(world.syncing(),false);
   console.log(JSON.stringify({stageId:stage3,stockThroughF828:true,heldAt20108F1517RulesContinue:true,freshAt1548:true,actualTcpWasmoon:true,browserObserved:false}));
 }finally{
   shell?.dispose();world?.close();
   await Promise.allSettled(workers.map(w=>w.terminate()));
   for(const [k,v] of Object.entries(old))if(v)Object.defineProperty(globalThis,k,v);else delete globalThis[k];
   await site.close();
 }
});

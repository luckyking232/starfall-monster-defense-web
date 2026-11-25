import test from 'node:test';
import assert from 'node:assert/strict';
import {createFrameFront,openCanvasFront} from '../src/rendering/continuous-world/frame-front.mjs';
import {captureStagePixels} from '../src/rendering/continuous-world/stage-pixels.mjs';
import {captureGpuStage} from '../src/rendering/continuous-world/gpu-stage.mjs';

const a={generation:1,runId:'first',stageId:78000001};
const b={generation:2,runId:'next',stageId:78000002};
const frame=(owner,requestId)=>({stageId:owner.stageId,runId:owner.runId,requestId});
test('last real world frame survives lag, pause, upgrade, settlement, and rendering failure',()=>{
 const writes=[];let ms=0;
 const f=createFrameFront({paint:x=>writes.push(x),clear:()=>writes.push('clear'),now:()=>ms});
 f.scope(a,'battle');
 assert.equal(f.view(a,'battle'),'empty');
 assert.ok(f.submit(a,'battle',frame(a,2),'pixels'));
 assert.equal(f.view(a,'battle',{exact:true}),'current');
 assert.equal(f.view(a,'battle'),'previous');ms=2300;
 assert.equal(f.view(a,'battle'),'stale');
 for(const phase of ['paused','upgrade','exit-confirm','settlement'])
  assert.equal(f.view(a,phase),'frozen');
 assert.equal(f.view(a,'battle',{error:true}),'fault');
 assert.equal(f.view(a,'battle',{hidden:true}),'hidden');
 assert.equal(f.submit(a,'battle',frame(a,1),'stale pixels'),false);
 assert.deepEqual(writes,['pixels']);
 f.scope(a,'chooser');
 assert.equal(f.view(a,'chooser'),'empty');
 assert.deepEqual(writes,['pixels','clear']);
});
test('changing stage/run invalidates late submission before touching pixels',()=>{
 const writes=[];
 const f=createFrameFront({paint:x=>writes.push(x),clear:()=>writes.push('clear')});
 f.scope(a,'battle');f.submit(a,'battle',frame(a,17),'A');
 f.scope(b,'battle');
 assert.equal(f.scope(a,'battle'),false);
 assert.equal(f.submit(a,'battle',frame(a,18),'late'),false);
 assert.equal(f.submit(b,'battle',frame(a,18),'wrong'),false);
 assert.ok(f.submit(b,'battle',frame(b,1),'B'));
 assert.deepEqual(writes,['A','clear','B']);
});
test('context loss never reports stale pixels and later complete frames can paint again',()=>{
 const hooks=new Map(),writes=[];
 const c={width:1,height:1,getContext:()=>({putImageData:p=>writes.push(p),clearRect:()=>writes.push('clear')}),
 addEventListener:(k,v)=>hooks.set(k,v),removeEventListener:k=>hooks.delete(k)};
 const {front,alive,close}=openCanvasFront(c);
 const pixels={width:1,height:1};front.scope(a,'battle');
 front.submit(a,'battle',frame(a,1),pixels);
 let prevented=false;hooks.get('contextlost')({preventDefault(){prevented=true;}});
 assert.equal(prevented,true);assert.equal(alive(),false);
 assert.equal(front.view(a,'battle'),'empty');
 hooks.get('contextrestored')();
 assert.equal(alive(),true);
 assert.ok(front.submit(a,'battle',frame(a,2),pixels));
 assert.deepEqual(writes,[pixels,pixels]);close();assert.equal(hooks.size,0);
});
test('renderer staging never exposes a partial write or a mismatched frame',async()=>{
 const target={width:1334,height:750,getContext:()=>({createImageData(){}})};
 const f=captureStagePixels(target,{alpha:false});
 const ctx=f.sink.getContext('2d',{alpha:false});
 const data={width:1334,height:750,data:new Uint8ClampedArray(1334*750*4)},one=frame(a,1);
 const adaptor=f.wrap({close(){},begin(){ctx.putImageData(data,0,0);return {frame:one};},observe(){},display(){}});
 assert.equal(f.read(one),null);
 await adaptor.begin();
 assert.equal(f.read(one),data);
 assert.equal(f.read({...one}),null);
 ctx.clearRect();
 assert.equal(f.read(one),null);
 f.destroy();
});
test('no-op observation keeps the last front visible but cannot certify a new request',async()=>{
 const writes=[],target={width:1334,height:750,getContext:()=>({createImageData(){}})};
 const f=captureStagePixels(target,{alpha:false});
 const ctx=f.sink.getContext('2d',{alpha:false});
 const prior=frame(a,1),next=frame(a,2),pixels={width:1334,height:750,data:new Uint8ClampedArray(1334*750*4)};
 const o=f.wrap({close(){},begin(){ctx.putImageData(pixels,0,0);return {frame:prior};},display(){return {frame:next};}});
 const front=createFrameFront({paint:p=>writes.push(p),clear:()=>writes.push('clear')});
 front.scope(a,'battle');
 await o.begin();
 assert.ok(front.submit(a,'battle',prior,f.read(prior)));
 await o.display();
 assert.equal(f.read(next),null);
 const exact=front.submit(a,'battle',next,f.read(next));
 assert.equal(exact,false);
 assert.equal(front.view(a,'battle',{exact}),'previous');
 assert.deepEqual(writes,[pixels]);
});
test('loss and restoration fence in-flight pixels; a fresh complete draw can recover',async()=>{
 const hooks=new Map(),writes=[];
 const target={width:1334,height:750,getContext:()=>({createImageData(){},putImageData:p=>writes.push(p),clearRect(){}}),
 addEventListener:(k,v)=>hooks.set(k,v),removeEventListener:k=>hooks.delete(k)};
 const f=captureStagePixels(target,{alpha:false});
 const {front,close}=openCanvasFront(target,{invalidateStaging:()=>f.invalidate()});
 const ctx=f.sink.getContext('2d',{alpha:false}),prior=frame(a,1),stale=frame(a,2),fresh=frame(a,3);
 const pixels={width:1334,height:750,data:new Uint8ClampedArray(1334*750*4)};
 let unblock;
 const gate=new Promise(resolve=>{unblock=resolve;});
 const o=f.wrap({close(){},begin(){ctx.putImageData(pixels,0,0);return {frame:prior};},
  async observe(){await gate;ctx.putImageData(pixels,0,0);return {frame:stale};},
  display(){ctx.putImageData(pixels,0,0);return {frame:fresh};}});
 front.scope(a,'battle');
 await o.begin();assert.ok(front.submit(a,'battle',prior,f.read(prior)));
 const old=o.observe();
 await assert.rejects(o.display(),/serialized/);
 hooks.get('contextlost')({preventDefault(){}});hooks.get('contextrestored')();
 assert.equal(f.read(prior),null);
 unblock();await old;
 assert.equal(f.read(stale),null);
 assert.equal(front.view(a,'battle'),'empty');
 await o.display();assert.ok(front.submit(a,'battle',fresh,f.read(fresh)));
 assert.deepEqual(writes,[pixels,pixels]);
 close();
});

test('complete GPU staging frames replace the front atomically; context loss fences new pixel receipts',async()=>{
 const events=new Map(), writes=[];
 let lost=false;
 const gpu={width:1334,height:750,getContext:()=>({isContextLost:()=>lost}),
  addEventListener:(k,v)=>events.set(k,v),removeEventListener:k=>events.delete(k)};
 const stage=captureGpuStage(gpu,{render(snapshot){if(snapshot==='bad')throw Error('Partial GL draw');return snapshot;}});
 const visible={width:1334,height:750,getContext:()=>ctx};
 const ctx={save(){writes.push('save');},restore(){writes.push('restore');},
  drawImage(source,x,y){writes.push([source,x,y,ctx.globalCompositeOperation]);},clearRect(){writes.push('clear');}};
 const {front}=openCanvasFront(visible);
 front.scope(a,'battle');
 const first=frame(a,1),second=frame(a,2),third=frame(a,3);
 const o=stage.wrap({close(){},begin(){stage.renderer.render('frame1');return {frame:first};},
  observe(next){if(next===second)return {frame:second};
   stage.renderer.render('frame3');lost=true;
   events.get('webglcontextlost')({preventDefault(){writes.push('restorable');}});
   return {frame:third};},
  display(){stage.renderer.render('bad');}});
 await o.begin();
 assert.ok(front.submit(a,'battle',first,stage.read(first)));
 assert.deepEqual(writes,['save',[gpu,0,0,'copy'],'restore']);
 await o.observe(second);
 assert.equal(stage.read(second),null);
 assert.equal(front.view(a,'upgrade'),'frozen');
 await o.observe(third);
 assert.equal(stage.read(third),null);
 assert.equal(stage.available(),false);
 assert.equal(front.view(a,'battle',{error:true}),'fault');
 lost=false;events.get('webglcontextrestored')();
 assert.equal(stage.available(),false); // GPU resources still need recreation.
 await assert.rejects(o.display(),/Partial GL draw/);
 assert.equal(stage.read(first),null);
 assert.equal(writes.length,4);
 stage.destroy();assert.equal(events.size,0);
});

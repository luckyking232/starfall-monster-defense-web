import test from 'node:test';
import assert from 'node:assert/strict';
import {createFrameFront,openCanvasFront} from '../src/rendering/continuous-world/frame-front.mjs';
import {captureStagePixels} from '../src/rendering/continuous-world/stage-pixels.mjs';

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

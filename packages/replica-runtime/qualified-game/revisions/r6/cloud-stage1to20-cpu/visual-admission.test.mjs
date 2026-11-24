import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHoldPolicy,captureCpuFront} from './hold.mjs';
import {chooseMap3Cpu,permitMap3Cpu,MAP3_CPU_LANE} from './group-admission.mjs';
import {selectStage2,permitStage2,STAGE2_CPU_LANE} from '../cloud-stage12-canvas2d/stage2-admission.mjs';
import {routeStage1Renderer,permitCpuFrame,STAGE1_CANVAS_LANE} from '../cloud-stage1-canvas2d/admission.mjs';
const W=1334,H=750;
const CPU={width:W,height:H}, NO_GL={getContext(){return null;}};
test('Canvas2D admission requires literal WebGL denial and separate dimensions; errors do not silently become fallback',()=>{
 const o={stageId:78000003,webglCanvas:NO_GL,canvas:CPU,enabled:true};
 assert.equal(chooseMap3Cpu(o).lane,MAP3_CPU_LANE);
 assert.equal(chooseMap3Cpu({...o,enabled:false}),null);
 assert.equal(chooseMap3Cpu({...o,stageId:78000021}),null);
 assert.equal(chooseMap3Cpu({...o,webglCanvas:{getContext(){return {};}}}),null);
 assert.throws(()=>chooseMap3Cpu({...o,canvas:{width:W-1,height:H}}),/independent/u);
 assert.throws(()=>chooseMap3Cpu({...o,webglCanvas:{getContext(){throw Error('fixture driver');}}}),/fixture driver/u);
 assert.equal(permitMap3Cpu({...o,phase:'battle',rendererLane:MAP3_CPU_LANE,presentationMatched:true,held:false}),true);
 assert.equal(permitMap3Cpu({...o,phase:'battle',rendererLane:MAP3_CPU_LANE,presentationMatched:false,held:false}),false);
 assert.equal(permitMap3Cpu({...o,phase:'upgrade',rendererLane:MAP3_CPU_LANE,presentationMatched:true,held:false}),false);
 const n={stageId:78000002,webglCanvas:NO_GL,cpuCanvas:CPU,enabled:true};
 assert.equal(selectStage2(n).lane,STAGE2_CPU_LANE);
 assert.equal(permitStage2({...n,phase:'battle',rendererLane:STAGE2_CPU_LANE,presentationMatched:true,held:true}),false);
 assert.equal(routeStage1Renderer({...n,stageId:78000001}).lane,STAGE1_CANVAS_LANE);
 assert.equal(permitCpuFrame({...n,stageId:78000001,phase:'paused',rendererLane:STAGE1_CANVAS_LANE,presentationMatched:true,held:false}),true);
});
test('previous frame lease cannot refresh on repeated unmatched replies or cross an epoch, stage, run, or surface',()=>{
 let ms=100;
 const policy=createHoldPolicy({now:()=>ms,maxMs:400});
 const authority={epoch:2,stageId:78000003,runId:'fixture-a',requestId:1,surface:{}};
 const send=(patch={},match=false,phase='battle')=>policy.update({authority:{...authority,...patch},match,work:true,phase,expectedStage:78000003});
 assert.deepEqual(send({},true),{kind:'current'});
 ms=120;assert.deepEqual(send({requestId:2}),{kind:'previous',remaining:400});
 ms=519;assert.deepEqual(send({requestId:3}),{kind:'previous',remaining:1});
 ms=520;assert.deepEqual(send({requestId:4}),{kind:'hide'});
 assert.deepEqual(send({requestId:5}),{kind:'hide'});
 for(const mismatch of [{stageId:78000004},{epoch:3},{runId:'fixture-b'},{surface:{}}]){
  assert.deepEqual(send({},true),{kind:'current'});
  assert.deepEqual(send({...mismatch,requestId:2}),{kind:'hide'});
 }
 assert.deepEqual(send({},true),{kind:'current'});
 assert.deepEqual(send({requestId:2},false,'upgrade'),{kind:'hide'});
});
test('only latest completed exact frame commits from a distinct CPU staging surface',async()=>{
 const seen=[];let onLost=null,closed=false;
 const context={putImageData(img){seen.push(['write',img.data[0]]);},clearRect(){seen.push(['clear']);}};
 const surface={width:W,height:H,getContext(){return context;},
  addEventListener(_,f){onLost=f;},removeEventListener(){onLost=null;}};
 const cap=captureCpuFront(surface,{alpha:true,onLost:()=>seen.push(['lost'])});
 const img=x=>{const data=new Uint8ClampedArray(W*H*4);data[0]=x;return {width:W,height:H,data};};
 const ctx=cap.sink.getContext('2d',{alpha:true});
 const w=cap.wrap({async begin(x){ctx.putImageData(img(x.token),0,0);return {frame:x};},
  async observe(){return {frame:null};},async display(){return {frame:null};},close(){closed=true;}});
 const f0={token:21},f1={token:35};
 await w.begin(f0);
 assert.equal(cap.commit({...f0}),false);assert.equal(cap.commit(f0),true);
 assert.deepEqual(seen,[['write',21]]);
 await w.begin(f1);
 assert.equal(cap.commit({...f1}),false);assert.equal(cap.commit(f1),true);
 await w.observe();assert.equal(cap.commit({token:40}),false);
 onLost();assert.equal(cap.commit(f1),false);
 assert.deepEqual(seen,[['write',21],['write',35],['clear'],['lost']]);
 w.close();cap.destroy();assert.equal(closed,true);
});

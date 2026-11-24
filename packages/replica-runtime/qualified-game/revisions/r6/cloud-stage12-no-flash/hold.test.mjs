import {test} from 'node:test';
import assert from 'node:assert/strict';
import {captureCpuFront,createHoldPolicy} from './hold.mjs';
test('pending same-run request holds in real clock, no deadline extension or resurrection',async()=>{
 const s={},a={runId:'original-a',epoch:1,stageId:78000001,surface:s,requestId:4};
 const p=createHoldPolicy({maxMs:75});
 const f={authority:a,phase:'battle',expectedStage:a.stageId,work:true,match:true};
 assert.equal(p.update(f).kind,'current');
 const pending=k=>({...f,authority:{...a,requestId:k},match:false});
 assert.equal(p.update(pending(5)).kind,'previous');
 await new Promise(r=>setTimeout(r,15));
 assert.equal(p.update(pending(6)).kind,'previous');
 await new Promise(r=>setTimeout(r,80));
 assert.equal(p.update(pending(7)).kind,'hide');
 assert.equal(p.update(pending(8)).kind,'hide');
 assert.equal(p.update({...pending(8),match:true}).kind,'current');
 assert.equal(p.update(pending(9)).kind,'previous');
});
test('run/epoch/actor error/visibility/choice/result/context/dead queue regressions never retain',()=>{
 let t=5;const surface={},a={runId:'a',epoch:1,stageId:78000002,surface,requestId:7};
 const f={authority:a,phase:'battle',expectedStage:a.stageId,work:true,match:true};
 const p=createHoldPolicy({now:()=>t});
 for(const q of [{fail:true},{hidden:true},{isAlive:false},{phase:'upgrade'},{phase:'result'},{phase:'exit-confirm'},{phase:'battle-ready'},{work:false},
  {authority:{...a,requestId:8,runId:'b'}},{authority:{...a,requestId:8,epoch:2}},{authority:{...a,requestId:8,surface:{}}},
  {authority:{...a,requestId:7}},{authority:{...a,requestId:6}},
  {authority:null},{expectedStage:78000001}]){
  assert.equal(p.update(f).kind,'current');
  assert.equal(p.update({...f,match:false,authority:{...a,requestId:8},...q}).kind,'hide');
 }
 assert.equal(p.update(f).kind,'current');
 t=4;assert.equal(p.update({...f,match:false,authority:{...a,requestId:8}}).kind,'hide');
});
test('staging pixels cannot leak through pending; approved exact bytes and clear exactly once',async()=>{
 const seen=[];let lost=false,clears=0,notices=0,handler;
 const c={width:1334,height:750,addEventListener(n,f){assert.equal(n,'contextlost');handler=f;},removeEventListener(n,f){assert.strictEqual(f,handler);},getContext(){return {createImageData:(w,h)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4)}),
   putImageData(i){seen.push(i.data[0]);},clearRect(){clears++;},isContextLost:()=>lost};}};
 const pair=captureCpuFront(c,{alpha:true,onLost:()=>notices++}),sink=pair.sink.getContext('2d',{alpha:true}),a={},b={};
 const img=sink.createImageData(1334,750);
 const o=pair.wrap({close(){}, async begin(){img.data[0]=31;sink.putImageData(img,0,0);return {frame:a};},
  async observe(){img.data[0]=77;sink.putImageData(img,0,0);return {frame:b};}});
 await o.begin();assert.equal(pair.commit(a),true);
 await o.observe();assert.deepEqual(seen,[31]);assert.equal(pair.commit(a),true);assert.deepEqual(seen,[31]);
 assert.equal(pair.commit(b),true);assert.deepEqual(seen,[31,77]);
 lost=true;handler();handler();assert.equal(notices,1);assert.equal(pair.commit(b),false);
 pair.clear();pair.clear();pair.destroy();assert.equal(clears,1);
});

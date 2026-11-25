/** Compare every migrated binding using the real verified scene bytes (Node 24+). */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import {resolve} from 'node:path';
const [prior,next]=process.argv.slice(2);
assert.ok(prior&&next,'node tests/product-actor-bindings.mjs VERIFIED_QA BUILT_PRODUCT');
const origin='http://127.0.0.1:8162', sides=[resolve(prior),resolve(next)];
globalThis.location=new URL(origin+'/');
const prefix=k=>origin+'/'+k+'/';
const identify=u=>sides.findIndex((_,i)=>u?.startsWith(prefix(i)));
registerHooks({
 resolve(spec,ctx,fallback){
  if(identify(spec)!==-1)return {url:spec,shortCircuit:true};
  if(identify(ctx.parentURL)!==-1&&spec.startsWith('.'))return {url:new URL(spec,ctx.parentURL).href,shortCircuit:true};
  return fallback(spec,ctx);
 },
 load(url,ctx,fallback){
  const n=identify(url);
  if(n!==-1)return {format:'module',source:readFileSync(sides[n]+decodeURIComponent(new URL(url).pathname.slice(2)),'utf8'),shortCircuit:true};
  return fallback(url,ctx);
 }
});
const pins=sides.map(root=>{
 const raw=readFileSync(root+'/_portable/route-ledger.js','utf8');
 return JSON.parse(raw.split('Object.freeze(')[1].split(');\n')[0]);
});
const groups=['composed-stage78-body','later-body-probe','later-body-six','stage2to6-hud-live','stage910-body-probe','stage9to20-hud-live'];
const protocol='starfall-qualified-stage-rules/1';
const outcome=async f=>{
 try{const obj=await f();const keys=Object.keys(obj).sort();obj.close();return {keys};}
 catch(e){return {code:e.code,message:e.message};}
};
let runs=0,opens=0;
for(const g of groups){
 const path='qualified-game/revisions/r6/'+g+'/';
 const inputs=[];
 for(let i=0;i<sides.length;i++){
  globalThis.location=new URL(prefix(i)+'index.html');
  inputs.push(await Promise.all(['scene-profiles','actor-bridge','presentation-clock'].map(m=>import(prefix(i)+path+m+'.mjs'))));
 }
 assert.deepEqual(inputs[0][0].SCENES,inputs[1][0].SCENES);
 for(const [id,scene] of Object.entries(inputs[0][0].SCENES)){
  const opts=sides.map((p,i)=>{
   const row=pins[i][scene.input];assert.ok(row,scene.input);
   const nativeIndexBytes=readFileSync(p+decodeURIComponent(row[2]??scene.input));
   return {nativeIndexBytes,protocol,stageId:+id,lane:inputs[i][2].RECONSTRUCTION};
  });
  const pairs=await Promise.all(inputs.map(async ([,a,c],i)=>
   [await outcome(()=>a.openActorBridge(opts[i])),await outcome(()=>c.openPresentationClock(opts[i])),
    await outcome(()=>a.openActorBridge({...opts[i],nativeIndexBytes:new Uint8Array([0])}))]));
  assert.deepEqual(pairs[0],pairs[1],g+'/'+id);
  assert.equal(pairs[0][2].code,'stage-integrity');
  opens+=pairs[0].filter(x=>x.keys).length;runs++;
 }
}
assert.equal(opens,runs*2,'all exact stage boots must succeed');
console.log(JSON.stringify({sceneBindings:runs,validActorAndClockOpens:opens,corruptIndexRejections:runs}));

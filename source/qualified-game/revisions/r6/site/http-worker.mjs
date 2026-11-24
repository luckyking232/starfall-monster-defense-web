/** Headless browser Worker transport in Node only. Uses exactly the real Worker/Wasmoon code. */
import {parentPort,workerData} from 'node:worker_threads';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createContext,runInContext} from 'node:vm';
import {resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
const base=fileURLToPath(new URL('../../../../',import.meta.url));
const host=workerData?.http;
if(typeof host!=='string'||!/^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(host))throw Error('Test requires literal TCP loopback');
const fetchHttp=globalThis.fetch;
const u=new URL(host+'/qualified-game/revisions/r6/worker.js');
const q=p=>JSON.parse(readFileSync(new URL(p,import.meta.url)));
const core=q('../../../../core-worker/pins.json');
const prefix=q('../../../../core-worker/combat-prefix/prefix-pins.json');
const p=q('../pins.json');
const allow=new Set([
  '/qualified-game/revisions/r6/pins.json','/browser-stage1/transport-controls.lua','/core-worker/pins.json',
  '/core-worker/combat-prefix/prefix-pins.json','/core-worker/skill-choice/QUALIFICATION.json',
  '/core-worker/inputs/vendor/index.js','/core-worker/inputs/vendor/glue.wasm','/core-worker/skill-choice/snapshot-codec.js',
  '/core-worker/spawn-audit-bridge.lua','/core-worker/combat-prefix/bridge.lua',
  '/core-worker/skill-choice/inputs/MiniGameSkillChoiceWindow.lua','/core-worker/skill-choice/inputs/choice-original-helpers.lua',
  '/core-worker/skill-choice/engine.lua','/core-worker/skill-choice/driver.lua',
  ...Object.keys(core.lua).map(n=>'/core-worker/inputs/lua/'+n),
  ...Object.keys(prefix).map(n=>'/core-worker/combat-prefix/inputs/'+n),
  ...Object.values(p.resourceExtension).map(v=>'/summon-evidence/'+v.path),
  ...Object.values(p.adapterRegistry).map(x=>new URL(x.file,u).pathname),
  ...Object.values(p.profiles).flatMap(v=>[v.receipt.file,...(v.evidence??[]).map(x=>x.file)].filter(Boolean).map(x=>new URL(x,x.startsWith('../')?new URL('/qualified-game/worker.js',u):u).pathname))
]);
const blobs=new Map(),requested=new Set();
let serial=0;
class QAURL extends URL {
  static createObjectURL(b){const path='blob:'+u.origin+'/profile-'+(++serial);blobs.set(path,b);return path;}
  static revokeObjectURL(path){blobs.delete(path);}
}
class QABlob{
  constructor(parts,{type}){this.type=type;this.bytes=Buffer.concat(parts.map(x=>Buffer.from(x)));}
}
const ctx=createContext({URL:QAURL,Blob:QABlob,TextDecoder,TextEncoder,Response,performance,crypto:globalThis.crypto,
  setTimeout,clearTimeout,console,location:u,
  async fetch(target){
    const p=String(target);
    if(blobs.has(p)){const z=blobs.get(p);return new Response(z.bytes,{headers:{'Content-Type':z.type}});}
    const targetURL=new URL(p);
    if(targetURL.origin!==u.origin||!allow.has(targetURL.pathname))throw Error('unapproved QA route '+p);
    const f=resolve(base,'.'+targetURL.pathname);
    if(!f.startsWith(base.endsWith(sep)?base:base+sep))throw Error('invalid QA path');
    requested.add(targetURL.pathname);
    if(targetURL.pathname===workerData?.slow){
      parentPort.postMessage({qa:'slow-began',path:targetURL.pathname});
      await new Promise(ok=>setTimeout(ok,400));
    }
    if(targetURL.pathname===workerData?.tamper)return new Response('wrong fixture bytes');
    if(targetURL.pathname===workerData?.missing)return new Response('',{status:404});
    if(workerData?.track)parentPort.postMessage({qa:'fetch',path:targetURL.pathname});
    return fetchHttp(targetURL,{redirect:'error'});
  },
  importScripts(...values){
    for(const url of values){
      if(!blobs.has(url))throw Error('non-pinned importScripts');
      runInContext(blobs.get(url).bytes.toString('utf8'),ctx,{filename:'pinned-worker-dependency.js'});
    }
  },
  postMessage(v){parentPort.postMessage(v);}
});
ctx.self=ctx;
const response=await fetchHttp(u,{redirect:'error'});
if(!response.ok)throw Error('R3 Worker script missing over TCP');
const bytes=Buffer.from(await response.arrayBuffer());
if(createHash('sha256').update(bytes).digest('hex')!=='03de3649b9fc189c7482150a473ddc64624be0493ced01792bec669d6ae77d6f')throw Error('R3 Worker script pin drift');
requested.add(u.pathname);
runInContext(bytes.toString('utf8'),ctx,{filename:'r3-real-tcp-worker.js'});
parentPort.on('message',m=>{
  if(m?.qa==='paths'){parentPort.postMessage({requestId:m.requestId,paths:[...requested]});return;}
  ctx.onmessage({data:m});
});

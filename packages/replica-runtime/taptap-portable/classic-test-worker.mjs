import {parentPort,workerData} from 'node:worker_threads';
import {createContext,runInContext} from 'node:vm';
import {httpModuleLoader,common,realFetch} from './vm-http.mjs';
const {base,entry}=workerData,routes=['_portable/runtime-core.js','_portable/route-ledger.js','_portable/authority.js',entry.slice(base.length)];
const texts=new Map(),blobs=new Map();let counter=0;
class LocalURL extends URL{
 static createObjectURL(x){const id='blob:'+new URL(base).origin+'/wasm-'+(++counter);blobs.set(id,x);return id;}
 static revokeObjectURL(s){blobs.delete(s);}
}
class LocalBlob{
 constructor(a,{type}){this.bytes=Buffer.concat(a.map(x=>Buffer.from(x)));this.type=type;}
}
for(const rel of routes){
 const u=new URL(rel,base),r=await realFetch(u);if(!r.ok)throw Error('Missing actual classic script '+u.href);
 texts.set(u.href,await r.text());
}
const ctx=createContext(common(base,{URL:LocalURL,Blob:LocalBlob,location:new URL(entry),
 fetch(input,opts){
  const x=String(input);if(blobs.has(x)){const p=blobs.get(x);return Promise.resolve(new Response(p.bytes,{headers:{'Content-Type':p.type}}));}
  if(!x.startsWith(base))throw Error('Worker network escaped nested artifact: '+x);
  return realFetch(x,opts);
 },importScripts(...urls){
  for(const q of urls){
   const u=new URL(q,entry).href,data=blobs.get(u)?.bytes.toString('utf8')??texts.get(u);
   if(data===undefined)throw Error('Unknown imported classic route '+u);
   runInContext(data,ctx,{filename:u,importModuleDynamically:dynamic});
  }
 },postMessage(x){parentPort.postMessage(x);}
}));
ctx.self=ctx;
const loader=httpModuleLoader(ctx,base);
const dynamic=(id,script)=>loader(new URL(id,script.filename??entry).href);
runInContext(texts.get(entry),ctx,{filename:entry,importModuleDynamically:dynamic});
parentPort.on('message',m=>ctx.onmessage({data:m}));

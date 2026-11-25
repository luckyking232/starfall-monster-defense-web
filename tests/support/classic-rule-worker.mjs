/** Run an unmodified built classic Worker in Node for deterministic integration tests only. */
import {parentPort,workerData} from 'node:worker_threads';
import {createContext,runInContext} from 'node:vm';
import {readFileSync} from 'node:fs';
import {resolve,relative,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
const {root,base,entry}=workerData,home=new URL(entry);
function local(x){
 const u=new URL(x,home);
 if(!u.href.startsWith(base)||u.search||u.hash)throw new Error('Out-of-scope test Worker route');
 const p=resolve(root,decodeURIComponent(u.href.slice(base.length))), rel=relative(root,p);
 if(!rel||isAbsolute(rel)||rel.split(/[\\/]/)[0]==='..')throw new Error('Unsafe test Worker path');
 return p;
}
const blobs=new Map();let count=0;
class ScopedURL extends URL{
 static createObjectURL(blob){const key='blob:'+home.origin+'/'+ ++count;blobs.set(key,blob);return key;}
 static revokeObjectURL(key){blobs.delete(key);}
}
class ScopedBlob{
 constructor(chunks,{type}){this.type=type;this.bytes=Buffer.concat(chunks.map(x=>Buffer.from(x)));}
}
async function scopedFetch(x,options){
 const blob=blobs.get(String(x));
 if(blob)return new Response(blob.bytes,{headers:{'content-type':blob.type}});
 local(x);return fetch(new URL(x,home),options);
}
async function dynamicImport(key){
 const p=local(key);
 if(!p.endsWith('/presentation-clock/source-tap.mjs'))throw new Error('Unexpected test Worker dynamic import');
 return import(pathToFileURL(p).href);
}
const run=(source,filename)=>runInContext(source,ctx,{filename,importModuleDynamically:dynamicImport});
const ctx=createContext({
 URL:ScopedURL,Blob:ScopedBlob,location:home,fetch:scopedFetch,crypto,performance,Uint8Array,ArrayBuffer,Response,
 TextEncoder,TextDecoder,setTimeout,clearTimeout,console,postMessage:x=>parentPort.postMessage(x),
 importScripts(...keys){for(const k of keys){const blob=blobs.get(k);run(blob?blob.bytes.toString('utf8'):readFileSync(local(k),'utf8'),String(k));}},
});
ctx.self=ctx;
run(readFileSync(local(home),'utf8'),home.pathname);
parentPort.on('message',data=>ctx.onmessage({data}));

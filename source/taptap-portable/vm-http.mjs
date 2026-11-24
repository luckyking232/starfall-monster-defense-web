import {createContext,SourceTextModule} from 'node:vm';
export const realFetch=globalThis.fetch;
export function httpModuleLoader(context,base){
 const moduleCache=new Map(),origin=new URL(base).origin;
 const inside=u=>u.origin===origin&&u.href.startsWith(base)&&!u.search&&!u.hash&&/\.(mjs|js)$/.test(u.pathname);
 async function get(id){
  const u=new URL(id);
  if(!inside(u))throw Error('Module outside nested artifact: '+u.href);
  if(!moduleCache.has(id))moduleCache.set(id,(async()=>{
   const r=await realFetch(u);if(!r.ok)throw Error('Missing nested module '+u.href);
   const text=await r.text();
   return new SourceTextModule(text,{context,identifier:id,initializeImportMeta(m){m.url=id;},
     importModuleDynamically:async(spec,ref)=>boot(new URL(spec,ref.identifier).href)});
  })());
  return moduleCache.get(id);
 }
 const linker=async(spec,ref)=>get(new URL(spec,ref.identifier).href);
 async function boot(id){
  const m=await get(id);
  if(m.status==='unlinked')await m.link(linker);
  if(m.status==='linked')await m.evaluate();
  return m;
 }
 boot.linkOnly=async id=>{const m=await get(id);if(m.status==='unlinked')await m.link(linker);return m;};
 return boot;
}
export function common(base,props){
 const loc=new URL(base+'index.html');
 return {...{URL,Blob,Response,Uint8Array,Uint8ClampedArray,ArrayBuffer,TextDecoder,TextEncoder,AbortController,
   performance,crypto:globalThis.crypto,console,DecompressionStream,ReadableStream,structuredClone,atob,btoa,
   setTimeout,clearTimeout,location:loc},...props};
}

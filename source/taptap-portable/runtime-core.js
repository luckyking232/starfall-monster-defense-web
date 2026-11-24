/* Exact portable artifact boundary. No compatibility shim for server routes outside this directory. */
globalThis.__starfallMakePortable=(entry, table, workerRoutes)=>{
 const RealURL=globalThis.URL, realFetch=globalThis.fetch.bind(globalThis);
 const fail=m=>{throw new Error('Portable artifact scope: '+m);};
 const base=new RealURL(entry);if(!base.pathname.endsWith('/')||base.search||base.hash||base.username||base.password||
  !(base.protocol==='https:'||base.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(base.hostname)))fail('HTTPS or explicit loopback required');
 const origin=base.origin,prefix=base.pathname;
 const clean=p=>{
  if(!p.startsWith('/')||p.startsWith('//'))return false;
  try{return p.split('/').slice(1).every((s,i,a)=>{
    if(!s)return i===a.length-1;
    const d=decodeURIComponent(s);return /^[\p{L}\p{N}_.-]+$/u.test(d)&&d!=='.'&&d!=='..';
   });}catch{return false;}
 };
 const nativeCheck=u=>{
  if(u.origin!==origin||u.protocol!==base.protocol||u.username||u.password||
    !u.pathname.startsWith(prefix)||!clean('/'+u.pathname.slice(prefix.length)))fail('foreign location '+u.pathname);
  return u;
 };
 const loc0=nativeCheck(new RealURL(globalThis.location.href));
 const inside=(p)=>p===prefix||p.startsWith(prefix);
 const absolute=p=>new RealURL(p.slice(1),base).href;
 function route(p){
  if(!clean(p))fail('invalid authored route');
  return absolute(p);
 }
 const objectUrls=new Set();
 class LocalURL extends RealURL {
  static createObjectURL(blob){const id=RealURL.createObjectURL(blob);objectUrls.add(id);return id;}
  static revokeObjectURL(id){if(objectUrls.delete(id))RealURL.revokeObjectURL(id);}
  constructor(target,input){
   const t=String(target);
   if(!t||t.includes('\\')||t.startsWith('//')||/%(?![0-9A-F]{2})|%(?:2[fF]|5[cC]|2[eE]|25)/u.test(t))fail('invalid URL');
   const b=input===undefined?undefined:new RealURL(String(input));
   if(b&&(b.origin!==origin||(!inside(b.pathname)&&b.pathname!=='/')))fail('foreign URL base');
   // A leading slash in inherited source is a virtual artifact route, not a host absolute fetch.
   const rebased=t.startsWith('/')?route(t):t;
   const sourceBase=b?.pathname==='/'?base:b;
   super(rebased,sourceBase);
   if(!objectUrls.has(t)&&!(this.native.origin===origin&&this.native.pathname==="/"&&!this.native.search&&!this.native.hash&&!this.native.username&&!this.native.password))nativeCheck(this.native);
  }
  get native(){return new RealURL(super.href);}
  get pathname(){
   const p=super.pathname;
   return p.startsWith(prefix)?'/'+p.slice(prefix.length):p;
  }
 }
 const canonical=loc0.pathname===prefix||loc0.pathname===prefix+'index.html'?'/qualified-game/':'/'+loc0.pathname.slice(prefix.length);
 const location=Object.freeze({
  origin,pathname:canonical,protocol:loc0.protocol,hostname:loc0.hostname,port:loc0.port,
  href:loc0.href,search:loc0.search,hash:loc0.hash,
  toString(){return loc0.href;}
 });
 const tableOwned=new Map(Object.entries(table));
 const read=u=>{
  const x=nativeCheck(new RealURL(String(u))),p='/'+x.pathname.slice(prefix.length);
  if(x.search||x.hash||!tableOwned.has(p))fail('unlisted read '+p);
  return [x,p];
 };
 const Worker=globalThis.Worker?class extends globalThis.Worker{
  constructor(u,...rest){
   const [x,p]=read(u);
   if(!workerRoutes.includes(p))fail('unlisted Worker '+p);
   super(x,...rest);
  }
 }:undefined;
 async function fetch(input,init={}){
  if(objectUrls.has(String(input)))return realFetch(input,{...init,redirect:'error'});
  const v=typeof input==='string'&&input.startsWith('/')?route(input):input;
  const [url,p]=read(v);
  if(init.method&&init.method!=='GET')fail('only GET permitted');
  const [len,sha,physical]=tableOwned.get(p);
  if(physical&&tableOwned.get(physical)?.[1]!==sha)fail('invalid physical alias '+p);
  const r=await realFetch(physical?route(physical):url,{...init,credentials:'omit',redirect:'error',cache:'no-store'});
  if(!r.ok||r.type==='opaque')fail('missing authorized '+p);
  const b=await r.arrayBuffer();
  if(b.byteLength!==len)fail('wrong byte count '+p);
  const got=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),x=>x.toString(16).padStart(2,'0')).join('');
  if(got!==sha)fail('wrong content digest '+p);
  return new Response(b,{headers:r.headers,status:200});
 }
 function importURL(path){return read(route(path))[0].href;}
 const sameOrigin=u=>u?.origin===origin&&u.protocol===base.protocol&&!u.username&&!u.password;
 return Object.freeze({URL:LocalURL,location,fetch,Worker,importURL,sameOrigin,base:base.href});
};

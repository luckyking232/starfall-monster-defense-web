import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import {createHash} from 'node:crypto';
const script=readFileSync(new URL('./runtime-core.js',import.meta.url),'utf8');
test('HTTPS nested scoped fetch denies origin and directory escapes; requires no redirects and digest',async()=>{
 const base='https://host.example/very/deep/owner/h5/';
 const seen=[],raw=Buffer.from('expected original bytes');
 const keep=()=>{throw Error('redirect is blocked by fetch before following Location');};
 const ctx=createContext({URL,Response,Uint8Array,crypto:globalThis.crypto,location:new URL(base+'index.html'),fetch(u,o){
  seen.push([u.href,o]);assert.equal(o.redirect,'error');assert.equal(o.credentials,'omit');
  if(u.pathname.endsWith('/redirect.png'))return keep();
  if(u.pathname.endsWith('/bad.png'))return new Response(Buffer.from('altered'));
  return new Response(raw);
 }});
 runInContext(script,ctx);
 const sha=createHash('sha256').update(raw).digest('hex');
 const p=ctx.__starfallMakePortable(base,{'/g.png':[raw.length,sha],'/公.png':[raw.length,sha,'/g.png'],
  '/bad.png':[raw.length,sha],'/redirect.png':[raw.length,sha]},[]);
 assert.equal(p.location.pathname,'/qualified-game/');
 assert.equal(new p.URL('/g.png',p.location.origin).href,base+'g.png');
 assert.equal(await (await p.fetch('/g.png',{redirect:'follow',credentials:'include'})).text(),raw.toString());
 await assert.rejects(p.fetch('https://other.example/g.png'),/foreign/u);
 await assert.rejects(p.fetch('https://host.example/g.png'),/foreign/u);
 await assert.rejects(p.fetch('/%2F..%2Fbad.png'),/invalid/u);
 assert.throws(()=>new p.URL('http://host.example/very/deep/owner/h5/g.png'),/foreign/u);
 assert.throws(()=>new p.URL('file:///g.png'),/foreign/u);
 await assert.rejects(p.fetch('/redirect.png'),/blocked by fetch/u);
 await assert.rejects(p.fetch('/bad.png'),/wrong byte count/u);
 assert.equal(seen.length,3);
 assert.ok(seen.every(x=>x[0].startsWith(base)));
});

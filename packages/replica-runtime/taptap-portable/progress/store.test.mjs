import test from 'node:test';
import assert from 'node:assert/strict';
import {openProgressStore,RELEASE} from './store.mjs';
const s1=78000001,s2=78000002,first='https://launch.example/games/xl/',second='https://launch.example/embed/tools/29848/';
function memory(){
 const data=new Map(),seen=[];
 return {data,seen,getItem:k=>data.get(k)??null,setItem(k,v){seen.push(k);data.set(k,v);}};
}
function bind(base,store){globalThis.location=new URL(base+'index.html');Object.defineProperty(globalThis,'localStorage',{value:store,configurable:true});return openProgressStore(base);}
test('authorized path scoped stage markers are monotone even with concurrently stale callers',()=>{
 const storage=memory(),a=bind(first,storage),a2=bind(first,storage),b=bind(second,storage);
 assert.deepEqual(a.load(),{score:0,mode:'local'});
 assert.equal(a.commit(s2).score,0);assert.equal(storage.seen.length,0);
 assert.equal(a.commit(s1).score,s1);
 assert.equal(a2.commit(s2).score,s2);
 assert.equal(a.commit(s1).score,s2);
 assert.equal(storage.seen.length,2);
 assert.equal(a.commit(78000021).score,s2);
 assert.equal(b.load().score,0);
 assert.equal(b.commit(s1).score,s1);
 assert.equal(bind(first,storage).load().score,s2);
 assert.equal(bind(second,storage).load().score,s1);
 assert.equal(storage.seen.length,3);
});
test('scope, corrupt markers, gaps and unsupported previous builds are not silently rewritten',()=>{
 const store=memory(),a=bind(first,store);a.commit(s1);a.commit(s2);
 const [realStart,later]=store.seen;
 const stale=store.data.get(realStart).replace(RELEASE,'old-release');
 store.data.set(realStart.replace(RELEASE,'old-release'),stale);store.data.delete(realStart);
 assert.deepEqual(a.load(),{score:0,mode:'unreadable'});assert.equal(a.commit(s1).mode,'unreadable');
 store.data.delete(later);
 assert.deepEqual(a.load(),{score:0,mode:'local'}); // Earlier build marker still ignored.
 a.commit(s1);
 store.data.set(realStart,JSON.stringify({stageId:s1,poc:'invalid'}));
 assert.deepEqual(a.load(),{score:0,mode:'unreadable'});
 assert.equal(a.commit(s1).mode,'unreadable');assert.equal(store.seen.length,3);
 globalThis.location=new URL(first+'alien/');
 assert.equal(openProgressStore(first).status.mode,'session-only');
});
test('private WebView storage refusal, blocked read and quota are session-only and never imply success',()=>{
 globalThis.location=new URL(first+'index.html');
 Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw Error('private storage refusal');}});
 assert.deepEqual(openProgressStore(first).load(),{score:0,mode:'session-only'});
 const a=bind(first,{getItem(){throw Error('denied');},setItem(){assert.fail('writes after read denial');}});
 assert.deepEqual(a.load(),{score:0,mode:'session-only'});
 const quota=bind(first,{getItem(){return null;},setItem(){throw Error('quota exceeded');}});
 assert.equal(quota.load().mode,'local');
 assert.deepEqual(quota.commit(s1),{score:0,mode:'session-only'});
});

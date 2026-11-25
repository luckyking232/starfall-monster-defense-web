import test from 'node:test';
import assert from 'node:assert/strict';
import * as alpha from '../packages/replica-runtime/taptap-portable/progress/store.mjs';
import * as product from '../src/platform/local-progress.mjs';

const legacy='https://progress.example/project/play/', first=78000001, second=78000002;
const setup=()=>{
 const map=new Map(),writes=[];
 globalThis.localStorage={getItem:k=>map.get(k)??null,setItem(k,v){map.set(k,v);writes.push([k,v]);}};
 return {map,writes};
};
function open(library,base,there){
 globalThis.location=new URL(there);
 const store=library.openProgressStore(base);
 assert.equal(library.isProgressStore(store),true);
 return store;
}
test('a fixed Alpha save is preserved byte for byte on clean and shared product links',()=>{
 const {map,writes}=setup(),a=open(alpha,legacy,legacy+'index.html');
 assert.equal(a.commit(first).score,first);
 const old=[...map.entries()];
 assert.equal(old.length,1);
 assert.equal(open(alpha,legacy,legacy+'index.html?utm_source=share').load().mode,'session-only');
 for(const suffix of ['', 'index.html','?utm_source=share','index.html?utm_source=share',
  '#battle','index.html#battle','index.html?utm_source=share#battle']){
  assert.deepEqual(open(product,legacy,legacy+suffix).load(),{score:first,mode:'local'},suffix);
  assert.deepEqual([...map.entries()],old,suffix);
 }
 // A consecutive product win stays readable by Alpha, without touching prior bytes.
 assert.equal(open(product,legacy,legacy+'index.html?ref=share').commit(second).score,second);
 assert.deepEqual([...map.entries()][0],old[0]);assert.equal(writes.length,2);
 assert.deepEqual(open(alpha,legacy,legacy).load(),{score:second,mode:'local'});
});
test('same-origin root and QA mounts, other origins, credentials and non-entry documents stay isolated',()=>{
 const {map,writes}=setup();
 open(alpha,legacy,legacy).commit(first);
 for(const base of ['https://progress.example/project/','https://progress.example/project/qa/startup/','https://other.example/project/play/']){
  assert.deepEqual(open(product,base,base+'index.html?ref=share#battle').load(),{score:0,mode:'local'});
 }
 for(const actual of [legacy+'deep/?ref=share',legacy+'binary.js#battle',
  'https://other.example/project/play/', 'http://progress.example/project/play/',
  'https://user@progress.example/project/play/index.html',legacy+'index.html/']){
  assert.deepEqual(open(product,legacy,actual).commit(first),{score:0,mode:'session-only'},actual);
 }
 for(const base of [legacy+'?ref=share',legacy+'#battle']){
  assert.deepEqual(open(product,base,legacy).load(),{score:0,mode:'session-only'},base);
 }
 assert.equal(map.size,1);assert.equal(writes.length,1);
});
test('opening a shared URL does not overwrite a malformed Alpha marker or claim denied storage',()=>{
 const {map,writes}=setup();
 open(alpha,legacy,legacy).commit(first);
 const key=writes[0][0];map.set(key,'malformed');
 const a=open(product,legacy,legacy+'index.html?q#clip');
 assert.deepEqual(a.load(),{score:0,mode:'unreadable'});
 assert.deepEqual(a.commit(first),{score:0,mode:'unreadable'});
 assert.equal(map.get(key),'malformed');assert.equal(writes.length,1);
 globalThis.localStorage={getItem(){throw new Error('denied');},setItem(){assert.fail('must not write');}};
 assert.deepEqual(open(product,legacy,legacy+'#share').load(),{score:0,mode:'session-only'});
});

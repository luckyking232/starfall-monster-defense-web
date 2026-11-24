import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openFxLedger,EXACT_PATH} from './ledger.mjs';
const ST=78000010,OWNER={uid:10004,cardId:78000103,camp:1},FX={uid:10455,cardId:78000302,camp:1};
const packet=(requestId,fixedFrame,units=[OWNER,FX],runId='qa-original-run')=>({stageId:ST,runId,requestId,state:{stageId:ST,fixedFrame,units}});
const cb=(fixed,rows,display=13,phase='fixed')=>({phase,fixedFrame:fixed,displayFrame:display,fxRows:rows});
const from=['create',String(FX.uid),String(FX.cardId),'1467','13',EXACT_PATH,String(OWNER.cardId),String(OWNER.uid)];
const dispose=['destroy',String(FX.uid),String(FX.cardId),'1558','15'];
const row={...FX,status:'held_unknown_native_asset'};
const plan=(p,held=[row],units=[OWNER],commands=[OWNER])=>({stageId:ST,runId:p.runId,requestId:p.requestId,display:{fixedFrame:p.state.fixedFrame},dispositions:held,snapshot:{units},commands});
test('exact same-run alive 302 path and known owner only; original retirement removes eligibility',()=>{
 const l=openFxLedger(ST),p=packet(1,1498);
 assert.equal(l.permitExactFx(p,FX),false);
 assert.equal(l.observe(cb(1467,[from]),p)[0].op,'create');
 assert.equal(l.permitExactFx(p,FX),true);
 assert.equal(l.permitExactFx(p,{...FX,camp:2}),false);
 assert.equal(l.permitExactFx(packet(1,1498,[{...OWNER,cardId:78000104},FX]),FX),false);
 assert.equal(l.permitExactFx(packet(2,1498),FX),false);
 assert.equal(l.permitExactFx(packet(1,1498,[OWNER,FX],'stale'),FX),false);
 assert.deepEqual(l.forFrame(plan(p),p).omissions.map(o=>o.uid),[FX.uid]);
 assert.equal(l.forFrame(plan(p,[row,{uid:9,cardId:78000303,status:row.status}]),p).complete,false);
 assert.throws(()=>l.forFrame(plan(p,[row],[OWNER,FX]),p),{code:'stage9-exact-fx-source-held'});
 assert.throws(()=>l.forFrame(plan(p,[row],[OWNER],[OWNER,FX]),p),{code:'stage9-exact-fx-source-held'});
 const q=packet(2,1558,[OWNER]);
 l.observe(cb(1558,[dispose],15),q);
 assert.equal(l.permitExactFx(q,FX),false);
 assert.throws(()=>l.forFrame(plan(p),q),{code:'stage9-exact-fx-source-held'});
});
test('no other stage, invalid source path/owner/phase, bad event clock or duplicate UID',()=>{
 assert.throws(()=>openFxLedger(78000009),{code:'stage9-exact-fx-source-held'});
 for(const a of [[5,EXACT_PATH.replace('10000104','10000101')],[6,'78000104'],[7,String(FX.uid)],[3,'1468']]){
  const bad=[...from];bad[a[0]]=a[1];
  const l=openFxLedger(ST);assert.throws(()=>l.observe(cb(1467,[bad]),packet(1,1498)),{code:'stage9-exact-fx-source-held'});
 }
 const l=openFxLedger(ST);
 assert.throws(()=>l.observe(cb(1467,[from],13,'display'),packet(1,1498)),{code:'stage9-exact-fx-source-held'});
 l.observe(cb(1467,[from]),packet(1,1498));
 assert.throws(()=>l.observe(cb(1467,[from]),packet(1,1498)),{code:'stage9-exact-fx-source-held'});
});

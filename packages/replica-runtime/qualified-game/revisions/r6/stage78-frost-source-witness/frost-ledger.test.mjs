import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFrostLedger,ORIGINAL} from './frost-ledger.mjs';
const uid=10412,card=78000201,actor={uid,cardId:card,camp:2};
const attach=['instantiate','1829','15',String(uid),String(card),'1',ORIGINAL,'1007','2','1','-1.2000000476837','-1115.0'];
const p0=['1829','15',String(uid),String(card),'1'];
const rows=[attach,['attach',...p0,'unit.model.transform','0','0','0'],['scale',...p0,'0.83333330021964','0.83333330021964','1'],['sort',...p0,'-1114.0']];
const state={stageId:78000007,fixedFrame:1829,units:[actor]};
function f(phase,fixed,display,events,bodyRows,units=null,paused=0){
 return {phase,fixedFrame:fixed,displayFrame:display,frost:{phase,fixed,display,rows:events,paused},rows:bodyRows,worldUnits:units,wallUs:10};
}
function before({speed=true}={}){
 const l=createFrostLedger(state.stageId);
 l.accept(f('fixed',2,0,[],[['actor-created','fixed','2','0',String(uid),String(card),'START','18']]),state);
 const clock=['animator-speed-request','fixed','1829','14',String(uid),String(card),'1','0'];
 l.accept(f('fixed',1829,14,[['status','1829','14',String(uid),String(card),'1007','1','150','2']],speed?[clock]:[]),state);
 return l;
}
test('exact source target, parent/scale/order, animator handoff and zero-render declaration',()=>{
 const l=before();
 const good=l.accept(f('display',1829,15,rows,[],[actor]),state);
 assert.equal(good.events[0].modelSpeed,0);
 assert.deepEqual(good.activeTargets,[{uid,cardId:card,serial:1}]);
 assert.equal(good.drawable,false);
 const detach=f('fixed',1830,15,[['destroy','1830','15',String(uid),String(card),'1','destroy-model']],
  [['actor-model-destroy-request','fixed','1830','15',String(uid),String(card),'DEAD','die']]);
 assert.deepEqual(l.accept(detach,{...state,fixedFrame:1830,units:[]}).activeTargets,[]);
 assert.throws(()=>l.accept(f('display',1829,15,rows,[],[actor]),state),{code:'frost-source-held'});
});
test('foreign branch, false freeze/same-run identity, scale/order and parent errors fail before acceptance',()=>{
 assert.throws(()=>createFrostLedger(78000009),{code:'frost-source-held'});
 const failures=[
  q=>q.frost.rows[0][6]=ORIGINAL.replace('frost','slowmotion_buff'),
  q=>q.frost.rows[0][7]='2011',q=>q.frost.rows[1][6]='other.transform',
  q=>q.frost.rows[2][6]='1',q=>q.frost.rows[3][6]='-1115.0',
  q=>q.frost.paused=1,q=>q.worldUnits[0].camp=1,q=>q.frost.fixed=1830
 ];
 for(const drift of failures){
  const l=before();const q=f('display',1829,15,structuredClone(rows),[],[{...actor}]);drift(q);
  assert.throws(()=>l.accept(q,state),{code:'frost-source-held'});
  assert.doesNotThrow(()=>l.accept(f('display',1829,15,rows,[],[actor]),state));
 }
 assert.throws(()=>before({speed:false}).accept(f('display',1829,15,rows,[],[actor]),state),{code:'frost-source-held'});
});

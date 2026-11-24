import test from 'node:test';
import assert from 'node:assert/strict';
import {openDeathHold,exactEmptyDie} from './death.mjs';
const cardId=78000206,stageId=78000009,bundle='84c63f1a28dcc746b573a764fb661c40',uid=10166;
const unit={uid,cardId,camp:2,flipped:true,stateName:'DYING'};
const index={stageId,units:{[cardId]:{bundle}}};
const state=(requestId,units=[unit])=>({stageId,runId:'r',requestId,state:{stageId,fixedFrame:1500+requestId,units}});
const row=(name,args)=>[name,'fixed','1500','1',String(uid),String(cardId),...args];
test('only admitted shape/state and actual remove permit 20108 recovery',()=>{
 const d=openDeathHold(index,stageId);
 d.consume({rows:[row('actor-created',['START','30']),row('play-request',['die'])]});
 assert.equal(d.decide(state(17)).units[0].dieRequestObserved,true);
 assert.throws(()=>d.decide(state(18,[{...unit,stateName:'START'}])),/held model returned/u);
 assert.throws(()=>d.decide(state(19,[])),/without original model destroy/u);
 assert.throws(()=>d.decide(state(20,[unit,{...unit,uid:2,cardId:78999999}])),/Unknown actor/u);
 d.consume({rows:[row('actor-model-destroy-request',['DEAD','die'])]});
 assert.equal(d.decide(state(21,[])),null);
 assert.throws(()=>d.decide({...state(22,[]),runId:'new'}),/wrong 20108 death authority/u);
 assert.throws(()=>d.assertNoDieProjection({snapshot:{units:[{...unit,stateName:'die'}]}}),/cannot be presented/u);
});
test('one byte-pinned authored empty state3, no foreign clip or missing state fallback',()=>{
 const q={stateName:'die',animationClipPathId:'-5682148573797749937',stateHash:1036227598},a={source:{bundle}};
 const ctrl={pathId:'4338523917390462401',states:[1,2,3,q]},clip={pathId:q.animationClipPathId,spriteCurves:[]};
 assert.equal(exactEmptyDie(a,ctrl,q,clip),true);
 assert.equal(exactEmptyDie(a,ctrl,{stateName:'idle'},clip),false);
 assert.throws(()=>exactEmptyDie(a,ctrl,q,{...clip,spriteCurves:[1]}),/clip mismatch/u);
 assert.throws(()=>exactEmptyDie(a,ctrl,{...q},clip),/clip mismatch/u);
 assert.throws(()=>openDeathHold(index,78000011),/wrong late-stage asset scope/u);
});

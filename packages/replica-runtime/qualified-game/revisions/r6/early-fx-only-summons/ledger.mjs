const PATH='Assets/Art/Effects/Prefab/UI_prefab/MiniGame/MiniGame022/';
const plans=Object.freeze({
  78000302:Object.freeze({ownerCard:78000103,path:PATH+'Minigame022_10000104_skill3_summon.prefab'}),
  78000303:Object.freeze({ownerCard:78000104,path:PATH+'Minigame022_10000101_skill3_summon.prefab'})
});
const need=(x,m)=>{if(!x)throw Object.assign(Error(m),{code:'source-fx-only-summon-invalid'});};
const uid=x=>Number.isSafeInteger(x)&&x>0&&x<=2147483647;
const counter=(x,max)=>Number.isSafeInteger(x)&&x>=0&&x<=max;
export function openFxLedger(stageId){
 need(Number.isSafeInteger(stageId)&&stageId>=78000003&&stageId<=78000006,'unsupported exact summon stage');
 const id=stageId<=78000004?78000302:78000303,p=plans[id],known=new Map(),seen=new Set();
 let run=null,request=-1;
 return Object.freeze({
  observe(c,packet){
   need(packet?.stageId===stageId&&packet.state?.stageId===stageId&&typeof packet.runId==='string'&&(run===null||run===packet.runId)&&
    uid(packet.requestId)&&packet.requestId>=request,'summon authority run or sequence mismatch');
   run=packet.runId;request=packet.requestId;
   const events=[];
   need(Array.isArray(c.fxRows)&&c.fxRows.length<=128,'summon callback receipt missing');
   for(const r of c.fxRows){
    need(Array.isArray(r)&&r.every(v=>typeof v==='string')&&[5,8].includes(r.length),'summon receipt shape invalid');
    const [op,u,k,f,d,path,ownerCard,ownerUid]=r;
    need(uid(+u)&&String(+u)===u&&+k===id&&counter(+f,12000)&&counter(+d,1200000)&&+f===c.fixedFrame&&+d===c.displayFrame,
     'summon callback stage or frame mismatch');
    if(op==='create'){
     need(c.phase==='fixed'&&r.length===8&&path===p.path&&+ownerCard===p.ownerCard&&uid(+ownerUid)&&+ownerUid!==+u&&!seen.has(+u),
      'summon path, owner or birth mismatch');
     known.set(+u,Object.freeze({uid:+u,cardId:id,ownerUid:+ownerUid,ownerCard:p.ownerCard,path,spawnFixed:+f}));seen.add(+u);
    }else{
     need(op==='destroy'&&r.length===5&&known.has(+u),'summon destroy actor not authenticated');
     known.delete(+u);
    }
    events.push(Object.freeze({op,uid:+u,fixed:+f,display:+d,cardId:id}));
   }
   return events;
  },
  forFrame(frame,packet){
   need(frame.stageId===stageId&&frame.runId===run&&frame.requestId===request&&packet?.runId===run&&packet?.requestId===request,
    'summon eligibility changed authority');
   const held=frame.dispositions.filter(x=>x.status.startsWith('held_')),suppressed=[];
   const mode=Object.fromEntries(packet.state.units.map(u=>[u.uid,u]));
   for(const h of held){
    const a=known.get(h.uid),target=mode[h.uid],owner=mode[a?.ownerUid];
    if(!a||h.cardId!==id||h.status!=='held_unknown_native_asset'||target?.cardId!==id||target.camp!==1||owner?.cardId!==p.ownerCard||owner.camp!==1)continue;
    suppressed.push(a);
   }
   return Object.freeze({complete:held.length===suppressed.length,omissions:Object.freeze(suppressed)});
  }
 });
}

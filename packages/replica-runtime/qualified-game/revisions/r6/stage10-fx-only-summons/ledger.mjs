const STAGE=78000010,CARD=78000302,OWNER=78000103;
export const EXACT_PATH='Assets/Art/Effects/Prefab/UI_prefab/MiniGame/MiniGame022/Minigame022_10000104_skill3_summon.prefab';
const ask=(x,m)=>{if(!x)throw Object.assign(Error(m),{code:'stage9-exact-fx-source-held'});};
const uid=x=>Number.isSafeInteger(x)&&x>0&&x<=2147483647;
const uint=(x,max)=>typeof x==='string'&&/^(?:0|[1-9]\d*)$/u.test(x)&&Number.isSafeInteger(+x)&&+x<=max;
export function openFxLedger(stage){
 ask(stage===STAGE,'Only Stage10 exact FX is scoped');
 let run=null,request=-1,authorityFixed=-1;
 const known=new Map(),seen=new Set();
 function exactPacket(p){
  return p?.stageId===STAGE&&p.state?.stageId===STAGE&&typeof p.runId==='string'&&(run===null||run===p.runId)&&uid(p.requestId);
 }
 function permit(p,u){
  if(!exactPacket(p)||p.runId!==run||p.requestId!==request||p.state.fixedFrame!==authorityFixed||u?.cardId!==CARD||u.camp!==1)return false;
  const x=known.get(u.uid),owner=p.state.units.find(v=>v.uid===x?.ownerUid);
  return Boolean(x&&x.spawnFixed<=authorityFixed&&owner?.cardId===OWNER&&owner.camp===1);
 }
 return Object.freeze({
  observe(c,p){
   ask(exactPacket(p)&&p.requestId>=request&&p.state.fixedFrame>=authorityFixed&&c.fixedFrame<=p.state.fixedFrame,'Stage10 exact summon run, request or frame drift');
   ask(Array.isArray(c.fxRows)&&c.fxRows.length<=128,'No Stage10 native summon callback witness');
   const events=[];
   for(const row of c.fxRows){
    ask(Array.isArray(row)&&row.every(v=>typeof v==='string')&&[5,8].includes(row.length),'Malformed native FX lifecycle');
    const [op,u,k,f,d,path,owner,ow]=row;
    ask(uint(u,2147483647)&&uid(+u)&&k===String(CARD)&&uint(f,12000)&&uint(d,1200000)&&+f===c.fixedFrame&&+d===c.displayFrame,
      'Native summon identity or clocks differ');
    if(op==='create'){
     ask(row.length===8&&c.phase==='fixed'&&path===EXACT_PATH&&owner===String(OWNER)&&uint(ow,2147483647)&&uid(+ow)&&+ow!==+u&&!seen.has(+u),'Unbound native Stage10 summon declaration');
     const q=Object.freeze({uid:+u,cardId:CARD,ownerUid:+ow,ownerCard:OWNER,path,spawnFixed:+f});
     known.set(+u,q);seen.add(+u);
    }else{
     ask(op==='destroy'&&row.length===5&&known.has(+u),'Stage10 exact FX retired without authenticated creation');
     known.delete(+u);
    }
    events.push(Object.freeze({op,uid:+u,cardId:CARD,fixed:+f,display:+d}));
   }
   run=p.runId;request=p.requestId;authorityFixed=p.state.fixedFrame;
   return events;
  },
  permitExactFx:permit,
  forFrame(frame,p){
   ask(exactPacket(p)&&frame?.stageId===STAGE&&frame.runId===p.runId&&frame.requestId===p.requestId&&frame.display?.fixedFrame===p.state.fixedFrame,'FX omitted only in same fresh frame');
   const held=frame.dispositions.filter(v=>v.status.startsWith('held_'));
   const fx=[];
   for(const row of held){
    const u=p.state.units.find(v=>v.uid===row.uid);
    if(row.cardId===CARD&&row.status==='held_unknown_native_asset'&&permit(p,u)){
     ask(!frame.snapshot.units.some(v=>v.uid===row.uid)&&!frame.commands.some(v=>v.uid===row.uid),'Unexpected substitute 302 pixels');fx.push(known.get(row.uid));
    }
   }
   return Object.freeze({complete:fx.length===held.length,omissions:Object.freeze(fx)});
  }
 });
}

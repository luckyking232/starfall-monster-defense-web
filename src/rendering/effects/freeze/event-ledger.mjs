/** Per-run observer ledger; intentionally issues no drawable particle command. */
export const ORIGINAL='Assets/Art/Effects/Prefab/UI_prefab/MiniGame/MiniGame022/Minigame022_10000118_frost.prefab';
const ask=(ok,message)=>{if(!ok)throw Object.assign(Error(message),{code:'frost-source-held'});};
const integer=(s,lo=0,hi=2147483647)=>typeof s==='string'&&/^-?(?:0|[1-9]\d*)$/u.test(s)&&Number.isSafeInteger(+s)&&+s>=lo&&+s<=hi;
const order=s=>typeof s==='string'&&/^-?(?:0|[1-9]\d*)(?:\.0+)?$/u.test(s)&&Number.isSafeInteger(+s)&&Math.abs(+s)<=200001;
const numeric=(s,maximum)=>typeof s==='string'&&s.length<=32&&s.trim()===s&&s.length>0&&Number.isFinite(+s)&&Math.abs(+s)<=maximum;
const pids=new Set([78000201,78000202,78000203,78000204,78000205]);
const same=(a,b)=>a?.uid===b?.uid&&a?.cardId===b?.cardId&&a?.camp===b?.camp;
const match=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
export function createFrostLedger(stageId){
 ask([78000001,78000007,78000008].includes(stageId),'Wrong native frost stage');
 let lastSerial=0,active=new Map(),model=new Map();
 return Object.freeze({
  accept(c,state){
   const p=c.frost;
   ask(state?.stageId===stageId&&p&&p.fixed===c.fixedFrame&&p.display===c.displayFrame&&
     (p.phase===c.phase||(p.phase==='control'&&c.phase==='wallclock')||(p.phase==='fixed'&&c.phase==='wallclock'&&!p.rows?.length))&&
     [0,1].includes(p.paused)&&Array.isArray(p.rows)&&p.rows.length<=1536,'Frost source stamps differ');
   if(p.phase==='display')ask(p.paused===0,'Frost rendered during original pause');
   const events=[],nextModel=new Map(model),nextActive=new Map(active);
   let serial=lastSerial;
   const copied=new Set();
   function body(uid,card){
    const v=nextModel.get(uid);
    ask(v?.cardId===card,'Frost source target not an exact stock actor');
    if(copied.has(uid))return v;
    const r={...v};nextModel.set(uid,r);copied.add(uid);return r;
   }
   const at=(op,uid,args)=>events.push(Object.freeze({op,uid,fixed:p.fixed,display:p.display,...args,drawable:false}));
   const retired=new Set();
   for(const row of c.rows){
    const [op,,ff,dd,k,q,before,after]=row;
    if(!['actor-created','actor-model-destroy-request','animator-speed-request'].includes(op)||!pids.has(+q))continue;
    ask(ff===String(p.fixed)&&dd===String(p.display)&&integer(k,1),'Frost actor stamp');
    const uid=+k,card=+q;
    if(op==='actor-created'){
     ask(!nextModel.has(uid),'Duplicate frost-model identity');
     nextModel.set(uid,{uid,cardId:card,camp:2,status:false,clock:1});copied.add(uid);
    }else if(op==='actor-model-destroy-request'){
     body(uid,card);retired.add(uid);
    }else{
     const v=body(uid,card);
     ask(['0','1'].includes(before)&&['0','1'].includes(after)&&+before===v.clock&&before!==after,'Frost animator clock drift');
     v.clock=+after;at('animator-speed',uid,{cardId:card,speed:v.clock});
    }
   }
   const world=new Map(state.units.map(x=>[x.uid,x]));
   const source=new Map((c.worldUnits??[]).map(x=>[x.uid,x]));
   for(let i=0;i<p.rows.length;i++){
    const r=p.rows[i],[op,ff,dd,key,card,s]=r;
    ask(Array.isArray(r)&&r.every(x=>typeof x==='string')&&ff===String(p.fixed)&&dd===String(p.display)&&integer(key,1)&&pids.has(+card),'Frost target or stamp mismatch');
    const uid=+key,v=body(uid,+card);
    if(op==='status'){
     ask(r.length===9&&s==='1007'&&['0','1'].includes(r[6])&&!!+r[6]!==v.status&&integer(r[7],0)&&r[8]==='2','Frost original 1007 threshold mismatch');
     v.status=!!+r[6];at('status',uid,{cardId:v.cardId,on:v.status,hp:+r[7]});
    }else if(op==='instantiate'){
     ask(!p.paused&&p.phase==='display'&&r.length===12&&integer(s,1)&&+s===serial+1&&r[6]===ORIGINAL&&r[7]==='1007'&&r[8]==='2'&&
       (r[9]==='1'||r[9]==='2'||r[9]==='2.5')&&numeric(r[10],100)&&+r[10]!==0&&order(r[11])&&Math.abs(+r[11])<=200000&&
       same(v,world.get(uid))&&same(v,source.get(uid))&&v.status&&v.clock===0&&!retired.has(uid)&&!nextActive.has(uid),'Frost original display request mismatch');
     const stem=[ff,dd,key,card,s];
     const attach=p.rows[i+1],scale=p.rows[i+2],sort=p.rows[i+3];
     ask(Array.isArray(attach)&&match(attach,['attach',...stem,'unit.model.transform','0','0','0'])&&
       Array.isArray(scale)&&scale.length===9&&match(scale.slice(0,6),['scale',...stem])&&
       numeric(scale[6],10000)&&+scale[6]>0&&Math.abs(+scale[6]- +r[9]/Math.abs(+r[10]))<=1e-10*Math.max(1,+scale[6])&&scale[6]===scale[7]&&scale[8]==='1'&&
       Array.isArray(sort)&&sort.length===7&&match(sort.slice(0,6),['sort',...stem])&&order(sort[6])&&+sort[6]===+r[11]+1,'Frost native transform/order mismatch');
     serial++;
     nextActive.set(uid,{uid,cardId:v.cardId,serial});
     at('instantiate',uid,{cardId:v.cardId,serial,original:ORIGINAL,has1007:true,modelSpeed:v.clock});
     i+=3;
    }else{
     ask(op==='destroy'&&r.length===7&&integer(s,1)&&nextActive.get(uid)?.serial===+s&&
       ((r[6]==='destroy-model'&&retired.has(uid))||(r[6]==='effect-absent'&&p.phase==='display'&&!p.paused&&!v.status&&same(v,source.get(uid)))),'Frost native removal mismatch');
     nextActive.delete(uid);at('destroy',uid,{cardId:v.cardId,serial:+s,reason:r[6]});
    }
   }
   for(const uid of retired){
    ask(!nextActive.has(uid),'Native target retired without frost cleanup');nextModel.delete(uid);
   }
   if(p.phase==='display'&&p.fixed===state.fixedFrame){
    for(const x of nextActive.values()){
     const v=nextModel.get(x.uid);
     ask(same(v,world.get(x.uid))&&same(v,source.get(x.uid))&&v.status&&v.clock===0,'Stale native frost target carried into paint');
    }
   }
   model=nextModel;active=nextActive;lastSerial=serial;
   return Object.freeze({activeTargets:Object.freeze([...active.values()].map(x=>Object.freeze({...x}))),events:Object.freeze(events),drawable:false});
  }
 });
}

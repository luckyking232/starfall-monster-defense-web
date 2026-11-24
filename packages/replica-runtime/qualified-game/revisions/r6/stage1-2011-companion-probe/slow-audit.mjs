/** Exact original display-only request observation, never defines a rendering capability. */
export const original='/Assets/Art/Effects/Prefab/UI_prefab/MiniGame/MiniGame022/Minigame022_slowmotion_buff.prefab'.slice(1);
const ask=(ok,n)=>{if(!ok)throw Object.assign(Error(n),{code:'source-nondrawable-invalid'});};
const integer=x=>Number.isSafeInteger(x)&&x>=0&&x<=10_000_000_000;
export function createAudit(stageId){
 ask(stageId===78000001,'wrong nondrawable scope');
 let previous=null,serial=0,lastRate=1,scaledUs=0,live=new Map();
 return Object.freeze({accept(c,authoritative){
  const b=c.slow;
  ask(b&&b.fixed===c.fixedFrame&&b.display===c.displayFrame&&[0,1].includes(b.paused)&&Array.isArray(b.rows)&&Array.isArray(b.threshold)&&
    b.rows.length<=256&&integer(c.wallUs)&&(!previous||c.wallUs>=previous.wallUs),'slow callback scope');
  const duringPause=Boolean(b.paused),world=new Map(authoritative.units.map(u=>[String(u.uid),u]));
  ask(b.phase===(c.phase==='wallclock'?'control':c.phase)||c.phase==='wallclock'&&!b.rows.length,'slow callback phase');
  const committed=[];
  const now=scaledUs+(c.wallUs-(previous?.wallUs??0))*lastRate;
  if(lastRate===0)ask(now===scaledUs,'paused scaled clock advanced');
  const claims=new Map();
  b.threshold.forEach(r=>{
   const [uid,card,flag,before,after,key]=r;
   ask(r.length===6&&b.phase==='display'&&!duringPause&&key==='2011'&&['0','1'].includes(flag)&&flag===after&&
       (flag==='1'?before==='0':before==='1')&&!claims.has(uid),'wrong original slow threshold');
   claims.set(uid,{card,flag});
  });
  const seen=new Set();
  for(let i=0;i<b.rows.length;i++){
   const r=b.rows[i], [op,n,u,fx,dx]=r;
   ask(/^\d+$/.test(n)&&/^\d+$/.test(u)&&[fx,dx].join(',')===[b.fixed,b.display].join(',')&&!seen.has(u),'slow identity');
   seen.add(u);
   if(op==='instantiate'){
    ask(b.phase==='display'&&!duringPause&&r.length===6&&r[5]===original&&Number(n)===serial+1&&!live.has(n)&&
      claims.get(u)?.flag==='1'&&String(world.get(u)?.cardId)===claims.get(u)?.card&&world.get(u)?.camp===2,'slow attach identity');
    const sub=b.rows.slice(i+1,i+4);
    const next=(kind,tail,j)=>JSON.stringify(sub[j])===JSON.stringify([kind,n,u,fx,dx,...tail]);
    ask(next('attach',['unit.model.transform','SetParent(true)'],0)&&next('local-origin',['0','0','0'],1)&&next('sort-request',['-2000'],2),'slow attach chain');
    serial++;claims.delete(u);live.set(n,u);i+=3;
   }else{
    ask(op==='destroy'&&r.length===6&&live.get(n)===u&&['destroy-model','effect-absent'].includes(r[5]),'slow detach identity');
    if(r[5]==='effect-absent'){
     ask(b.phase==='display'&&!duringPause&&claims.get(u)?.flag==='0','slow detach threshold');
     claims.delete(u);
    }
    live.delete(n);
   }
   committed.push(Object.freeze({op,serial:+n,uid:+u,fixed:b.fixed,display:b.display,scaledHostUs:now,drawable:false}));
  }
  ask(claims.size===0,'unmatched original 2011 witness');
  const last=c.rows.filter(x=>x[0]==='global-timescale-request').at(-1);
  if(last){lastRate=+last[4];ask([0,1,2].includes(lastRate),'unknown original scale');}
  scaledUs=now;previous=c;
  return Object.freeze({events:Object.freeze(committed),paused:duringPause,scaledHostUs:now,nextRate:lastRate,active:live.size,drawable:false});
 }});
}

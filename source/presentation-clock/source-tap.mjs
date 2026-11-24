/** Optional pin-checked tap to install on a dedicated, not-yet-started source Lua engine.
 * This uses the original Display implementation, not computed names from the rule snapshot.
 * The host still owns callback scheduling, exact source world coupling and failure handling. */
export const DISPLAY_SOURCE='0c83419feda468808c4cd7be6093b6d751af90cb5ae1864adf966faca78f0d5d';
export const REQUEST_TAP='1aee69cee348bb0c79662b030ff8c88521854e2272f39c935f06978311177bc5';
const digest=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),n=>n.toString(16).padStart(2,'0')).join('');
export async function installSourceTap(engine,{displaySourceBytes,tapBytes}={}){
  const verified=async(b,pin)=>{
    if(!(b instanceof Uint8Array)||b.byteLength>100_000)throw Error('Invalid Stage1 source tap bytes');
    const c=new Uint8Array(b);
    if(await digest(c)!==pin)throw Error('Stage1 source tap integrity mismatch');
    return new TextDecoder('utf-8',{fatal:true}).decode(c);
  };
  const src=await verified(displaySourceBytes,DISPLAY_SOURCE), tap=await verified(tapBytes,REQUEST_TAP);
  await engine.doString('local originalFacade = MiniGameBattleActionDisplay\n'+src+
    '\nAuditOriginalDisplay=MiniGameBattleActionDisplay\nMiniGameBattleActionDisplay=originalFacade\n'+tap+
    '\nfunction previewTapClock() return table.concat({MiniGameBattleControl.curFixedFrame,MiniGameBattleControl.curFrame},"\\t") end'+
    '\nfunction previewTapDrain() local out=table.concat(trace,"\\n"); trace={}; return out end');
  // Drain the observer's own local buffer after each invocation: bounded and no growing replay.
  const fn=name=>engine.global.get(name);
  let serial=0, prior=null, priorWallUs=null;
  return Object.freeze({
    run(phase,wallUs,invoke){
      if(!['boot','fixed','display','wallclock'].includes(phase)||(serial===0)!==(phase==='boot')||
          !Number.isSafeInteger(wallUs)||wallUs<(priorWallUs??0)||wallUs>10_000_000_000||
          (phase==='boot'&&(wallUs!==0||typeof invoke!=='function'))||
          (phase==='fixed'&&typeof invoke!=='function')||
          (phase==='wallclock'&&invoke!==undefined&&typeof invoke!=='function'))throw Error('Stage1 tap clock/phase mismatch');
      if(phase==='display'){
        if(invoke!==undefined)throw Error('Original display callback is owned by the tap');
        fn('animAuditDisplay')();
      }else{
        fn('animAuditMark')(phase);
        if(typeof invoke==='function')invoke();
      }
      const [fixedFrame,displayFrame]=fn('previewTapClock')().split('\t').map(Number);
      const rows=fn('previewTapDrain')().split('\n').filter(Boolean).map(l=>l.split('\t'));
      if(prior&&rows.length===0&&prior.fixedFrame===fixedFrame&&prior.displayFrame===displayFrame)phase='wallclock';
      serial++;
      prior={fixedFrame,displayFrame};priorWallUs=wallUs;
      const worldUnits=phase==='boot'||phase==='display'?fn('choiceSessionSnapshot')().split('\n')
        .filter(x=>x.startsWith('unit\t')).map(x=>{
          const [_,uid,cardId,x0,y,z,camp,stateName,flipped]=x.split('\t');
          return {uid:+uid,cardId:+cardId,x:+x0,y:+y,z:+z,camp:+camp,stateName,flipped:flipped==='1'};
        }):null;
      return {phase,fixedFrame,displayFrame,wallUs,rows,worldUnits};
    },
  });
}

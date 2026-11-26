/* Pure audited Lua snapshot decoder, shared by the Node and browser hosts. */
(function(root) {
  'use strict';
function decodeStage1Snapshot(raw) {
  const lines=raw.split('\n').map(row=>row.split('\t'));
  const nums=lines[0].slice(1).map(Number);
  if (nums.some(n=>!Number.isFinite(n))) throw Error('Invalid source snapshot');
  const [fixedFrame,stageId,curMonsterWave,killEnemyCount,curLevel,curExp,selfHp,
         selfMaxHp,speedIndex,elapsedMs,paused,win,loss,ended]=nums;
  // Original Stop clears battle data before returning result. Do not surface those
  // cleared values as a true terminal health or level.
  const terminal=ended ? {win:Boolean(win),loss:Boolean(loss),curMonsterWave,killEnemyCount} : null;
  const state={fixedFrame,stageId,curMonsterWave,killEnemyCount,curLevel:ended?null:curLevel,
    curExp:ended?null:curExp,selfHp:ended?null:selfHp,selfMaxHp:ended?null:selfMaxHp,
    speedIndex:ended?null:speedIndex,elapsedMs,paused:Boolean(paused),terminal,choice:null,units:[]};
  for (const [type,...r] of lines.slice(1)) {
    if (type==='choice') {
      state.choice={windowId:Number(r[0]),generation:Number(r[1]),level:Number(r[2]),remainingMs:Number(r[3]),
        touchable:r[4]==='1',offerIds:r[5].split(',').map(Number),visible:[]};
    } else if (type==='visibility') {
      state.choice.visible[Number(r[0])-1] = r[1]==='1';
    } else if (type==='unit') {
      state.units.push({
        uid:Number(r[0]),cardId:Number(r[1]),x:Number(r[2]),y:Number(r[3]),z:Number(r[4]),
        camp:Number(r[5]),stateName:r[6],flipped:r[7]==='1',
      });
    } else throw Error('Unknown source snapshot kind '+type);
  }
  return state;
}
  if(typeof module==='object' && module.exports) module.exports=decodeStage1Snapshot;
  else root.decodeStage1Snapshot=decodeStage1Snapshot;
})(globalThis);

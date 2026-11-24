/** Pure original local result projection; invokes no service and submits nothing. */
import {PROFILES,PROFILE_PROTOCOL} from './profiles.mjs';
export const ENDLESS_MODE='original-bounded-neutral-v1';
const p=PROFILES[78000021];
const reject=()=>{throw Object.assign(Error('Expected a source-qualified neutral Endless terminal'),{code:'endless-neutral-required'});};
export function projectEndlessSettlement(packet,activityFlow){
 const t=packet?.state?.terminal,g=packet?.gates?.endlessQualification;
 if(packet?.protocol!==PROFILE_PROTOCOL||packet.type!=='state'||packet.stageId!==p.stageId||
    packet.profileId!==p.profileId||packet.profilePin!==p.profilePin||packet.state.stageId!==p.stageId||
    g?.optIn!==ENDLESS_MODE||g.fixedFrameCap!==12000||g.disposition!=='native_neutral_terminal'||g.finitePoints!==0||
    g.actualCycleVerified!==false||g.officialService!==false||packet.gates.audiovisualParity!=='held'||
    t?.win!==false||t.loss!==false||!Number.isSafeInteger(t.curMonsterWave)||t.curMonsterWave<1||
    !Number.isSafeInteger(t.killEnemyCount)||t.killEnemyCount<0)reject();
 const offer=activityFlow.beginSettlement({stageId:p.stageId,isBattleWin:false,isBattleLoss:false,
   wave:t.curMonsterWave,kills:t.killEnemyCount});
 if(offer?.request?.point!==0||offer.wave!==t.curMonsterWave||offer.kills!==t.killEnemyCount)reject();
 return Object.freeze({localOnly:true,finitePoints:0,officialService:false,offer});
}

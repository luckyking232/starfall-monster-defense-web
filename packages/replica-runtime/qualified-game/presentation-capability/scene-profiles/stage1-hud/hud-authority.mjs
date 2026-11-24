/** Only canonical Stage1 admitted raw authoritative packets can join observer-produced HUD operations. */
import {PROFILE_PROTOCOL,PROFILES} from '../../../profiles.mjs';
import {createHudFrameJoin} from '../../../../battle-hud-presentation/join.mjs';
import {DPS_PREVIEW} from '../../../../battle-hud-presentation/dps-preview.mjs';
import {MASK_PREVIEW} from '../../../../battle-hud-presentation/portrait-mask.mjs';
import {parseHudOracle} from './parse-ops.mjs';
const expected=PROFILES[78000001];
const require=(ok,msg)=>{if(!ok)throw Error(msg);};
const identity=p=>p?.stageId===expected.stageId&&p.profileId===expected.profileId&&p.profilePin===expected.profilePin;
export function createCanonicalHudAuthority(resources){
 let lastRaw=null,lastPacket=null,source=null;
 const bound=new WeakMap(), poses=new WeakMap();
 const join=createHudFrameJoin({...resources,introAcknowledged:true,dpsLane:DPS_PREVIEW,portraitLane:MASK_PREVIEW,
  sourceAuthority:{read(stamp){require(source,'HUD operations were not captured on this display');bound.set(source,stamp);return source;},
    qualify:(raw,pair)=>bound.get(raw)===pair}});
 function accept({packet,frame,hudOps}){
  require(packet?.protocol===PROFILE_PROTOCOL&&identity(packet)&&identity(packet.gates?.stageScope)&&packet.gates?.sourceState==='integrity_verified',
    'Unqualified canonical HUD worker');
  if(frame===null){lastRaw=lastPacket=null;return {world:{packet,frame},joined:null};}
  require(frame.stageId===78000001&&frame.protocol===PROFILE_PROTOCOL&&frame.runId===packet.runId&&frame.requestId===packet.requestId&&
    frame.nativeRuntimePose===false,'Unqualified canonical HUD display');
  source=typeof hudOps==='string'&&hudOps.length<24000?parseHudOracle(hudOps):null;
  if(lastRaw!==packet){
    lastRaw=packet;
    lastPacket=Object.freeze({...packet,protocol:'starfall-stage1-rules/1',presentationAuthorityProtocol:PROFILE_PROTOCOL});
  }
  let f=poses.get(frame);
  if(!f){f=Object.freeze({...frame,protocol:lastPacket.protocol});poses.set(frame,f);}
  const world=Object.freeze({packet:lastPacket,frame:f});
  try{return Object.freeze({world,joined:join.accept(world)});}
  finally{source=null;}
 }
 return Object.freeze({accept,close(){join.close();source=null;}});
}

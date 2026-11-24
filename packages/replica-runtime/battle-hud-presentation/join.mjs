/** Compose the latest accepted lower-HUD plan in exact step with existing Stage1 preview. */
import {createHudBinding} from '../hud-renderer/hud-fields.mjs';
import {composeBattleHud} from './plan.mjs';
import {createDpsPreview,DPS_PREVIEW} from './dps-preview.mjs';
const require=(x,m)=>{if(!x)throw Error(m);};
const map={'time':'time','wave':'wave','kills':'kills','level':'level','expCount':'exp','expFill':'expFill','wallName':'wallName',
  'wallHp':'wallHp','wallFill':'wallFill','speedText':'speed','speedPage':'speedPage'};
export function createHudFrameJoin({layout,bindingConfig,stageConfig,sourceAuthority,fontManifest=null,introAcknowledged=false,dpsLane=null,portraitLane=null}={}){
  require(typeof sourceAuthority?.read==='function'&&typeof sourceAuthority?.qualify==='function','Explicit original HUD operation issuer required');
  require(dpsLane===null||dpsLane===DPS_PREVIEW,'Undeclared DPS reconstruction lane');
  const dps=dpsLane?createDpsPreview({lane:dpsLane}):null;
  const fields=createHudBinding(bindingConfig,stageConfig);
  let run=null,last=0,committed=null,closed=false;
  function joinFrame({packet:p,frame:f}){
    require(!closed&&p?.protocol==='starfall-stage1-rules/1'&&p?.gates?.sourceState==='integrity_verified'&&
      p.state?.stageId===78000001&&(run===null||run===p.runId)&&Number.isSafeInteger(p.requestId)&&p.requestId>=last,
      'HUD Worker/session mismatch');
    run=p.runId;last=p.requestId;
    if(p.state.terminal||f===null){committed=null;return null;}
    require(f.nativeRuntimePose===false&&f.runId===run&&f.requestId===p.requestId,'HUD frame is not paired with rules request');
    if(p.state.paused){
      require(committed&&f.presentationStatus==='held_last_display_during_source_pause'&&f.frozenFromRequestId===committed.packet.requestId&&f.display===committed.frame.display&&
        f.commands===committed.frame.commands&&f.snapshot===committed.frame.snapshot,'Unpaired paused HUD');
      return Object.freeze({...committed,mode:'freeze_existing_lower_HUD_behind_popup',currentPacket:p});
    }
    if(committed?.packet===p&&committed.frame===f)return committed;
    const stamp=Object.freeze({packet:p,frame:f});
    const raw=sourceAuthority.read(stamp);
    require(raw&&sourceAuthority.qualify(raw,stamp)===true&&raw.opsFixedFrame===p.state.fixedFrame&&
      raw.opsFixedFrame===f.display.fixedFrame&&raw.opsDisplayFrame===f.display.displayFrame,'HUD source operation not committed at this frame');
    const expected=fields.snapshot(p.state,{nativeInit:p.type==='ready'});
    for(const a of expected.fields){
      const v=raw.top[map[a.field]];
      require(typeof a.value==='number'?typeof v==='number'&&Math.abs(v-a.value)<1e-10:v===a.value,'Original HUD operation disagrees with current rules: '+a.field);
    }
    const allies=p.state.units.filter(u=>u.camp===1&&[78000101,78000102].includes(u.cardId));
    require(raw.cards.filter(c=>c.uid!==null).length===allies.length&&allies.every(u=>
      raw.cards.some(c=>c.uid===u.uid&&c.cardId===u.cardId)),'Bad original HUD card/UID binding');
    const dpsPreviewToken=dps?.accept({runId:run,display:f.display,raw})??null;
    const lower=composeBattleHud(layout,raw,{introAcknowledged,fontManifest,dpsPreviewToken,portraitLane});
    committed=Object.freeze({mode:'same_request_previous_lower_HUD',packet:p,frame:f,plan:lower,
      receipt:Object.freeze({kind:'reconstructed-lower-battle-HUD-plan-not-GL-capture',nativeUnityFrame:false,
        previousRequestId:p.requestId,displayFrame:f.display.displayFrame,fixedFrame:f.display.fixedFrame,
        heldLayers:lower.held,pairedSamePreviousDisplay:true,dpsLane:lower.dpsLane,portraitLane:lower.portraitLane,blurSourceQualified:false}),
      nativeUnityFrame:false,blurSourceQualified:false});
    return committed;
  }
  return Object.freeze({accept(data){try{return joinFrame(data);}catch(e){closed=true;committed=null;dps?.close();throw e;}},close(){closed=true;committed=null;dps?.close();}});
}

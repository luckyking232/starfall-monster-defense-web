// Canonical source-qualified registry and Worker; one opt-in protocol for future audited profiles.
/* Isolated pinned stage-aware authoritative rule transport. No visual or online dependencies. */
'use strict';
const PROTOCOL = "starfall-qualified-stage-rules/1";
const VERSION = '134377281279792758';
const MODE = "starfall-multistage-headless";
const STAGE_SCOPE = Object.freeze({"78000001":{"stageId":78000001,"profileId":"78000001-dina-r1","profilePin":"ae4ad974aad1c7e26022b320a4be574c90c0dde882a941b6789c2fe072f56ad0"},"78000002":{"stageId":78000002,"profileId":"78000002-calibration-r1","profilePin":"e3984994c93e2bcde00c47a0584d6a7e8706fc850196c2dbe204c137f39d959a"},"78000003":{"stageId":78000003,"profileId":"78000003-split-summon-r1","profilePin":"06c0de0be06fb0bbafe499723ffb361a7f7ebcc001d58669e99c8635cdda75d3"},"78000004":{"stageId":78000004,"profileId":"78000004-source-verified-r1","profilePin":"ef8752575341959e9679ea6e2f25191dc9c21e89314fc415e8e11c73e2166060"},"78000005":{"stageId":78000005,"profileId":"78000005-source-r1","profilePin":"ee10e61e22d046e235afed9e7fc31d0da66d810860d334b822ccf73e9d424989"},"78000006":{"stageId":78000006,"profileId":"78000006-source-r1","profilePin":"98d86a0bc72eea80689d3ad0832148caf744c9ebbbc836cd7b6c88236418d82c"},"78000007":{"stageId":78000007,"profileId":"78000007-opaque-headless-r1","profilePin":"9579553a906af4b0908742e25254b149c63caf1ac1f183c80d956530f542e1cc"},"78000008":{"stageId":78000008,"profileId":"78000008-opaque-headless-r1","profilePin":"a5283e7679ca61d65b1155ff6f451c43508e0ae1f1b93b90fc26738a77d73df0"},"78000009":{"stageId":78000009,"profileId":"78000009-opaque-headless-r1","profilePin":"9c15f4b506b86c3466c21ba422d04d12b26ba1defd96fa557e6474ba487ce08b"},"78000010":{"stageId":78000010,"profileId":"78000010-opaque-headless-r1","profilePin":"830e33c5fff07a24a0741766efd25d6529fb1f8dff6dac6df846303df1837337"},"78000011":{"stageId":78000011,"profileId":"78000011-opaque-headless-r1","profilePin":"10b4dae0f45555a9c59fba7150007bd6868996a0d4da6f171de8e619074cd3cb"},"78000012":{"stageId":78000012,"profileId":"78000012-opaque-headless-r1","profilePin":"cf99f3efb8c022afd8d9b516875a1a569ce8a97548126bcd0da43099bbd00ebc"},"78000013":{"stageId":78000013,"profileId":"78000013-opaque-headless-r1","profilePin":"c5c9ee7e772a166a09aaf6f133af03b834c2b994923b2f2966d5fbf96dde5cb3"},"78000014":{"stageId":78000014,"profileId":"78000014-opaque-headless-r1","profilePin":"4e07145913e18372834dea4919766d603b69648f65bc793565eebed4a237fa4a"},"78000015":{"stageId":78000015,"profileId":"78000015-opaque-headless-r1","profilePin":"45c053ad78f165e1d4caa285ef29684849d422845e810ffa409c7b3135e65b77"},"78000016":{"stageId":78000016,"profileId":"78000016-opaque-headless-r1","profilePin":"79a347b42ef95b82995b8639b25b7a4353425237990f60acd343707ecc1a0f19"},"78000017":{"stageId":78000017,"profileId":"78000017-opaque-headless-r1","profilePin":"81a27b97f29aa20820961f297b7fedebe3f57cde6947e275a03912b61de0a289"},"78000018":{"stageId":78000018,"profileId":"78000018-opaque-headless-r1","profilePin":"d195e7d6b389ab205e75a59ad67fd2241305fdefc9f2febe5fbbb4204e8659a5"},"78000019":{"stageId":78000019,"profileId":"78000019-opaque-headless-r1","profilePin":"2144edf18b82771ba84c010f0fae62f52347e4d072ff8fae0890aec5e10210da"},"78000020":{"stageId":78000020,"profileId":"78000020-opaque-headless-r1","profilePin":"44560fd44960e9590721a36b3888b9b716de4863f36c038fff74adb1b12295bb"},"78000021":{"stageId":78000021,"profileId":"78000021-endless-neutral-bounded-r1","profilePin":"77a50473938ea97dd8e0addf464faf2b3024ad3a5632851de36a77e9851a2f3e"}});
const GAME = 70441022;
const MANIFEST_SHA = '3a76072af92f41917f25fe47250e6197c0c78aa97b1c6bda6f871b16dd027654';
const CORE = '../core-worker/';
const gates = Object.freeze({
  source: 'pinned_explicit_stage_profiles_only',
  timing: 'explicit_30hz_fixed_and_independent_unscaled_clock',
  ruleClosure: 'qualified_route_samples_per_profile_not_exhaustive',
  dinaPoisonCloud: 'headless_rules_verified_particle_and_audio_parity_held',
  hud: 'raw_snapshot_only',
  worldPose: 'raw_unit_state_without_animation',
  animation: 'held_unmapped_unity_Animator_time',
  audiovisualParity: 'held',
  originalLiveCaptureComparison: 'pending',
  realBrowserAcceptance: 'reported_separately',
  deployment: 'not_deployed'
});

const profilePromises=new Map();
let sourcesPromise, active=null, desiredRunId=null, serial=Promise.resolve();
const admitted=new Set();
function err(code,message) { const e=new Error(message);e.code=code;throw e; }
const isInt=(n,lo,hi)=>Number.isInteger(n)&&n>=lo&&n<=hi;
const decode=bytes=>new TextDecoder('utf-8',{fatal:true}).decode(bytes);
const position=/^[\w-]{1,64}$/;

async function pinned(path,want) {
  const url=new URL(path,path.startsWith('../')?new URL('/qualified-game/worker.js',self.location):self.location);
  if (url.origin!==self.location.origin) err('bad-origin','worker input is not on the local origin');
  const response=await fetch(url,{cache:'no-store',redirect:'error'});
  if (!response.ok) err('source-input-missing',path+' HTTP '+response.status);
  const bytes=await response.arrayBuffer();
  const got=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),
      n=>n.toString(16).padStart(2,'0')).join('');
  if (got!==want) err('source-integrity-mismatch',path);
  return bytes;
}
const text=async(path,sha)=>decode(await pinned(path,sha));
const json=async(path,sha)=>JSON.parse(await text(path,sha));
const blob=(bytes,type)=>URL.createObjectURL(new Blob([bytes],{type}));
function runVerifiedJS(bytes) {
  const url=blob(bytes,'text/javascript');
  try{importScripts(url);}finally{URL.revokeObjectURL(url);}
}

async function verifiedSources(){
  if(!['localhost','127.0.0.1','[::1]'].includes(self.location.hostname))
    err('local-origin-required','Stage 1/2 audited rules are loopback-only');
  const p=await json('./pins.json',MANIFEST_SHA);
  if(p.protocol!==PROTOCOL||p.gameId!==GAME||p.targetVersion!==VERSION||
    p.parentCompanionManifest!=='969a34eea1dd103fe163656ace73eac8b5f9aba44134f22e47def52e7944faa8'||
    Object.keys(p.profiles??{}).length!==Object.keys(STAGE_SCOPE).length)
    err('source-identity-mismatch','incorrect game/build/profile manifest');
  for(const key of Object.keys(STAGE_SCOPE)){
    const a=p.profiles[key],b=STAGE_SCOPE[key];
    if(!a||a.stageId!==b.stageId||a.profilePin!==b.profilePin||a.profileId!==b.profileId)
      err('source-identity-mismatch','profile identity drift');
  }
  if(p.originalManifest!=='1a8f30466e7a270c7f0c0557305a6771889b2dba14f50485664893e402ee9b30')
    err('source-identity-mismatch','v1 provenance missing from companion manifest');
  // The browser fetches only these small receipt files and the exact headless facade.
  // No full archives, original serialization, or particle assets are served by this lane.
  const e=p.resourceExtension;
  const path='../summon-evidence/';
  const [extraLua,nativeText,extraRules,legacy,dependencies]=await Promise.all([
    text(path+'headless-extension.lua',e.lua.sha256),
    text(path+'verified-native.jsonl',e.native.sha256),
    json(path+'VERIFIED-RULES.json',e.rules.sha256),
    json(path+'VERIFIED-LEGACY.json',e.legacy.sha256),
    json(path+'VERIFIED-DEPS.json',e.deps.sha256),
  ]);
  const raw=nativeText.trim().split('\n').map(row=>JSON.parse(row));
  const dina=raw.find(r=>r.bundle==='e8d4e3121ba1e2f48cc3025ef46c929e');
  if(!dina||dina.animator!==false||dina.sockets!==false||
     dina.path!=='assets/art/effects/prefab/ui_prefab/minigame/minigame022/minigame022_10000134_skill2_summon.prefab'||
     dina.counts.ParticleSystem!==14||dina.externalRefs.length!==7||
     dependencies.assets.filter(a=>a.referencedBy.some(([b])=>b===dina.bundle)&&a.status==='exact_archive_and_members_verified').length!==7||
     extraRules.old.firstMissingFrame!==593||extraRules.extended.rows!==3857||
     extraRules.extended.summons!==164||extraRules.extended.terminal.frame!==3769||
     extraRules.extended.terminal.kills!==133||legacy.rows!==9956||Object.keys(legacy.results).length!==11) {
    err('qualification-mismatch','Dina companion receipt does not verify exact headless scope');
  }
  const [base,prefix,qualification]=await Promise.all([
    json(CORE+'pins.json',p.basePins),json(CORE+'combat-prefix/prefix-pins.json',p.prefixPins),
    json(CORE+'skill-choice/QUALIFICATION.json',p.qualification),
  ]);
  if(base.targetVersion!==VERSION||qualification.cases!==11||
    qualification.totalTraceRows!==9956||qualification.totalWeightedDraws!==201)
    err('qualification-mismatch','required cross-engine receipt does not match this lane');
  const [vendor,wasm,codec,spawn,prefixBridge,choice,choiceHelpers,engine,driver,controls,baseLua,prefixLua]=await Promise.all([
    pinned(CORE+'inputs/vendor/index.js',base.vendor['index.js']),
    pinned(CORE+'inputs/vendor/glue.wasm',base.vendor['glue.wasm']),
    pinned(CORE+'skill-choice/snapshot-codec.js',p.snapshotCodec),
    text(CORE+'spawn-audit-bridge.lua',p.spawnBridge),
    text(CORE+'combat-prefix/bridge.lua',p.prefixBridge),
    text(CORE+'skill-choice/inputs/MiniGameSkillChoiceWindow.lua',p.choiceOriginal),
    text(CORE+'skill-choice/inputs/choice-original-helpers.lua',p.choiceHelpers),
    text(CORE+'skill-choice/engine.lua',p.choiceEngine),
    text(CORE+'skill-choice/driver.lua',p.choiceDriver),
    text('../browser-stage1/transport-controls.lua',p.transportControls),
    Promise.all(Object.entries(base.lua).map(async([name,sha])=>[name,await text(CORE+'inputs/lua/'+name,sha)])),
    Promise.all(Object.entries(prefix).map(async([name,sha])=>[name,await text(CORE+'combat-prefix/inputs/'+name,sha)])),
  ]);
  runVerifiedJS(vendor);
  runVerifiedJS(codec);
  if(typeof self.decodeStage1Snapshot!=='function') err('codec-missing','no qualified snapshot decoder');
  const wurl=blob(wasm,'application/wasm');
  try{
    const factory=new self.wasmoon.LuaFactory(wurl);
    // Resolve while the verified Blob URL is live. Same module can create separate Lua states.
    await factory.getLuaModule();
    return {factory,spawn,prefixBridge,choice,choiceHelpers,engine,driver,controls,baseLua,prefixLua,extraLua,profiles:p.profiles,adapterRegistry:p.adapterRegistry};
  }finally{URL.revokeObjectURL(wurl);}
}
// Shared stage-aware host adapter; game-source Lua files are never altered.
function bindStage(source,id,n) {
  const baseline='78000001';
  if(source.split(baseline).length!==n+1) err('source-identity-mismatch','Unexpected host fixture stage literals');
  return id===78000001?source:source.replaceAll(baseline,String(id));
}
function resolveField(root,path){
  if(!Array.isArray(path)||!path.length||path.length>10)err('qualification-mismatch','Bad proof field path');
  let item=root;
  for(const k of path){
    if(!item||typeof item!=='object'||!Object.hasOwn(item,k))err('qualification-mismatch','Missing profile proof field');
    item=item[k];
  }
  return item;
}
function verifiedProfile(shared,id) {
  if(!profilePromises.has(id)){
    const promise=(async()=>{
      const profile=shared.profiles[id];
      if(!profile||profile.stageId!==id)err('scope-held','No qualified profile for this stage');
      const receipt=await json(profile.receipt.file,profile.receipt.sha256);
      const checks=profile.qualificationChecks;
      if(!Array.isArray(checks)||!checks.length||checks.length>32)
        err('qualification-mismatch','Missing exact stage proof checks');
      for(const [path,want] of checks)
        if(JSON.stringify(resolveField(receipt,path))!==JSON.stringify(want))
          err('qualification-mismatch','Qualified stage proof differs at '+path.join('.'));
      // Resource facades only add stage-scoped source-approved native data. Nothing here
      // chooses a prefab, changes the original Lua rules, or permits graphical sample guesses.
      const more=profile.evidence??[];
      if(!Array.isArray(more)||more.length>(profile.stageId===78000021?22:profile.stageId>=78000009?20:profile.nonRenderableDisplayBoundary?16:12)||profile.abi!=='starfall-qualified-prefab-adapters/1')
        err('qualification-mismatch','Invalid pinned resource scope');
      if(more.length) await Promise.all(more.map(x=>json(x.file,x.sha256)));
      const ids=profile.adapters;
      if(!Array.isArray(ids)||ids.length>8||new Set(ids).size!==ids.length)
        err('qualification-mismatch','Unqualified native adapter selection');
      const blocks=await Promise.all(ids.map(async id=>{
        if(typeof id!=='string'||!Object.hasOwn(shared.adapterRegistry,id))err('qualification-mismatch','Unknown native adapter ID');
        const dep=shared.adapterRegistry[id];
        return text(dep.file,dep.sha256);
      }));
      const adapter=blocks.join('\n');
      return {profile,adapter};
    })().catch(e=>{profilePromises.delete(id);throw e;});
    profilePromises.set(id,promise);
  }
  return profilePromises.get(id);
}
// A private, exact finite control-plane bound; never affects rule timers or cadence.
function profileDriver(source,profile) {
  let s=bindStage(source,profile.stageId,1);
  if(profile.auditedEndless!==undefined){
    if(profile.stageId!==78000021||profile.auditedEndless.fixedFrameCap!==12000||profile.auditedEndless.optIn!=="original-bounded-neutral-v1")
      err('qualification-mismatch','Unqualified Endless horizon');
    const text='runningTick()<12000 or capturedResult';
    if(s.split(text).length!==2)err('source-identity-mismatch','Unexpected Endless driver boundary');
    return s.replace(text,'runningTick()<=12000 or capturedResult');
  }
  if(profile.auditedFiniteFrameCap===undefined) return s;
  if(profile.stageId!==78000020||profile.auditedFiniteFrameCap!==18000)
    err('qualification-mismatch','Unqualified finite driver horizon');
  for(const [a,b] of [['math.min(12000,from+frames)','math.min(18000,from+frames)'],
                    ['runningTick()<12000 or capturedResult','runningTick()<18000 or capturedResult']]){
    if(s.split(a).length!==2) err('source-identity-mismatch','Unexpected finite driver boundary');
    s=s.replace(a,b);
  }
  return s;
}
async function makeApi(stageId){
  sourcesPromise??=verifiedSources();
  let s;
  try{s=await sourcesPromise;}catch(error){sourcesPromise=null;throw error;}
  const stage=await verifiedProfile(s,stageId);
  const lua=await s.factory.createEngine({
    openStandardLibs:true,injectObjects:false,enableProxy:false,functionTimeout:5000,
  });
  try{
    for(const [,source] of s.baseLua) await lua.doString(source);
    for(const [name,source] of s.prefixLua){
      if(name==='CardAttribute.lua') await lua.doString("TableData={GetTable=function(k) assert(k=='BaseAttribute');return BaseAttribute end}");
      await lua.doString(name==='MathUtil.lua'?'MathUtil=(function()\n'+source+'\nend)()':source);
    }
    await lua.doString('OriginalCombat={AddUnit=MiniGameBattleSceneMgr.AddUnit,AddMonster=MiniGameBattleSceneMgr.AddMonster,AddBullet=MiniGameBattleSceneMgr.AddBullet,UpdateBattleOverState=MiniGameBattleSceneMgr.UpdateBattleOverState,UpdateProcess=MiniGameBattleSceneMgr.UpdateProcess}');
    const helpers=Object.fromEntries(s.prefixLua)['source-derived-helpers.lua'];
    const setup=`ChoiceWindow=(function()
      local require=function(name)
        assert(name=='ActivityDungeon1017Battle_SkillChoiceWindowByName','unavailable Lua module: '..name)
        return true
      end
      ${s.choice}
    end)()
    ${s.choiceHelpers}`;
    let prefix=s.prefixBridge;
    if(stage.profile.nonRenderableDisplayBoundary) {
      const b=stage.profile.nonRenderableDisplayBoundary;
      if(b.drawable!==false||b.affectsSimulation!==false||b.ruleObservationOnly!==true)
        err('qualification-mismatch','Opaque rule receipt cannot claim presentation');
      const hit='emit("hit",a.id,d.id,d.uid,num,real,hp,d:GetHp())';
      if(prefix.split(hit).length!==2)err('source-identity-mismatch','Unexpected original diagnostic hit sink');
      // Rule source receives original nil attacker during healing; only the observer row is null-safe.
      prefix=prefix.replace(hit,'emit("hit",a and a.id or 0,d.id,d.uid,num,real,hp,d:GetHp())');
    }
    await lua.doString([s.spawn,helpers,prefix,setup,bindStage(s.engine,stageId,4),profileDriver(s.driver,stage.profile),s.controls,s.extraLua,stage.adapter].join('\n'));
    const entries=['Start','Fixed','Clock','Select','Snapshot','Events','Speed','Pause','Resume'];
    const api=Object.fromEntries(entries.map(k=>[k,lua.global.get('choiceSession'+k)]));
    api.close=()=>lua.global.close();
    return {api,profile:stage.profile};
  }catch(error){lua.global.close();throw error;}
}
function deinit(){
  if(active){const old=active;active=null;old.api.close();}
}
function scope(checked,profile=null){
  return {...gates,sourceState:checked?'integrity_verified':'not_loaded',
    ruleClosure:checked?gates.ruleClosure:'held_until_source_integrity_verified',
    ...(profile?.nonRenderableDisplayBoundary?{nonRenderableDisplayBoundary:{...profile.nonRenderableDisplayBoundary}}:{}),
    stageScope:profile?{stageId:profile.stageId,profileId:profile.profileId,profilePin:profile.profilePin}:null};
}
function getState(api,profile){
  const state=self.decodeStage1Snapshot(api.Snapshot());
  if(state.stageId!==profile.stageId) err('profile-mismatch','decoded source snapshot stage does not match its pin');
  if(profile.stageId===78000021&&state.terminal&&
     (state.terminal.win!==false||state.terminal.loss!==false||!Number.isSafeInteger(state.terminal.curMonsterWave)||
      state.terminal.curMonsterWave<1||!Number.isSafeInteger(state.terminal.killEnemyCount)||state.terminal.killEnemyCount<0))
    err('endless-neutral-required','Original Endless cannot report a finite outcome');
  return state;
}
function result(api,profile,kind='state',advancedFixed=0){
  const raw=api.Events();
  const state=getState(api,profile), g=scope(true,profile);
  if(profile.auditedEndless)g.endlessQualification={...profile.auditedEndless,
    disposition:state.terminal?'native_neutral_terminal':state.fixedFrame===profile.auditedEndless.fixedFrameCap?'live_horizon_held':'active_source_rules'};
  return {type:kind,state,events:raw?raw.split('\n').map(line=>line.split('\t')):[],
    advancedFixed,gates:g,stageId:profile.stageId,profileId:profile.profileId,profilePin:profile.profilePin};
}
function validInit(m){
  const selected=STAGE_SCOPE[m.stageId];
  if(m.mode!==MODE||!Number.isSafeInteger(m.stageId)||!Object.hasOwn(STAGE_SCOPE,m.stageId)||!selected)
    err('scope-held','No explicitly source-qualified profile for this stage');
  if(m.profileId!==selected.profileId||m.profilePin!==selected.profilePin)
    err('profile-mismatch','The requested profile does not match the requested stage');
  if(m.stageId===78000021?m.endlessMode!=="original-bounded-neutral-v1":m.endlessMode!==undefined)
    err('endless-scope-opt-in','Stage21 requires an explicit bounded neutral scope and finite stages cannot request it');
  if(!Array.isArray(m.tape)||m.tape.length!==50||m.tape.some(v=>!isInt(v,1,10000))) err('bad-rng-tape','Require fifty explicit Lua values');
  if(!Array.isArray(m.globalRngSeeds)||m.globalRngSeeds.length!==2||m.globalRngSeeds.some(v=>!isInt(v,0,2147483647)))
    err('bad-global-rng','Require two explicit Lua 5.4 test seeds');
  if(admitted.has(m.runId)) err('session-id-reused','Run ID must be unique for worker lifetime');
  if(admitted.size>=256) err('session-limit','Create a fresh bounded worker');
}
function validateAction(m,state){
  if(m.type==='step-fixed'&&!isInt(m.count,1,600)) err('bad-fixed-count','Fixed steps 1 through 600');
  if(m.type==='advance-unscaled'&&!isInt(m.ms,0,60000)) err('bad-wall-clock','Unscaled clock advance 0 through 60,000 ms');
  if(m.type==='speed'&&(m.index!==1&&m.index!==2)) err('bad-speed','Only 1× and 2×');
  if(['pause','resume'].includes(m.type)&&(state.choice||state.terminal))
    err('pause-control-held','The original chooser or terminal state owns pause');
  if(m.type==='select'){
    const c=state.choice;
    if(!c||m.windowId!==c.windowId||m.generation!==c.generation) err('stale-offer','Offer is not current');
    if(!c.touchable) err('offer-not-touchable','Original timeout transition has locked this popup');
    if(typeof m.confirm!=='boolean') err('bad-confirm','Pass an explicit confirm boolean');
    const index=c.offerIds.indexOf(m.skillId);
    if(index<0) err('unoffered-skill','Skill ID is not in current source offer');
    if(!c.visible[index]) err('offer-not-visible','Original reveal timer has not released this card');
  }
}

async function run(m){
  if(m.type==='describe'){
    return {type:'contract',mode:MODE,version:VERSION,profiles:Object.values(STAGE_SCOPE),gameId:GAME,fps:30,gates:scope(false)};
  }
  if(m.runId!==desiredRunId) err('stale-session','Request belongs to a superseded session');
  if(m.type==='init'){
    const {api,profile}=await makeApi(m.stageId);
    if(m.runId!==desiredRunId){api.close();err('stale-session','Superseded while verifying local source');}
    // No events from the replaced session reach this consumer after admitting this run.
    deinit();
    try{
      api.Start(m.tape.join(','),...m.globalRngSeeds);
      const r=result(api,profile,'ready');
      active={runId:m.runId,api,profile};
      return {...r,version:VERSION,gameId:GAME,fps:30};
    }catch(e){api.close();err('stage-init-failed',String(e?.message??e));}
  }
  if(!active||active.runId!==m.runId) err('session-not-ready','Explicit profile native state is not ready');
  const {api,profile}=active;
  if(m.stageId!==profile.stageId||m.profileId!==profile.profileId||m.profilePin!==profile.profilePin)
    err('profile-mismatch','This request does not belong to the active stage profile');
  if(m.type==='close'){deinit();return {type:'closed',stageId:profile.stageId,profileId:profile.profileId,profilePin:profile.profilePin};}
  if(!['snapshot','step-fixed','advance-unscaled','select','speed','pause','resume'].includes(m.type)) err('unsupported-command','Unsupported stage rule command');
  let state;
  try{state=getState(api,profile);}catch(e){
    deinit();err('runtime-failed-closed',String(e?.message??e));
  }
  validateAction(m,state);
  if(m.type!=='snapshot'&&profile.auditedEndless&&
    state.fixedFrame===profile.auditedEndless.fixedFrameCap&&!state.terminal)
    err('endless-observed-scope-held','The original run is still live, beyond the locally observed fixed-frame horizon');
  try{
    let n=0;
    if(m.type==='step-fixed') n=api.Fixed(m.count);
    if(m.type==='advance-unscaled') api.Clock(m.ms);
    if(m.type==='select') api.Select(m.windowId,m.generation,m.skillId,m.confirm);
    if(m.type==='speed') api.Speed(m.index);
    if(m.type==='pause') api.Pause();
    if(m.type==='resume') api.Resume();
    return result(api,profile,'state',n);
  }catch(e){
    deinit();
    err('runtime-failed-closed',String(e?.message??e));
  }
}
self.onmessage=({data:m})=>{
  const envelope={protocol:PROTOCOL,requestId:m?.requestId,runId:m?.runId};
  const emitError=e=>self.postMessage({...envelope,type:'error',code:e?.code||'runtime-unavailable',message:String(e?.message??e)});
  try{
    if(m?.protocol!==PROTOCOL||!isInt(m.requestId,1,2147483647)) err('bad-contract','Explicit protocol and numeric request ID required');
    if(m.type!=='describe'&&(typeof m.runId!=='string'||!position.test(m.runId))) err('bad-session','Invalid run ID');
    if(m.type==='init'){
      validInit(m);
      admitted.add(m.runId);
      desiredRunId=m.runId;
      deinit();
    }
  }catch(e){emitError(e);return;}
  serial=serial.then(async()=>{
    try{self.postMessage({...envelope,...await run(m)});}
    catch(e){emitError(e);}
  });
};

/** Explicit /2 gate. Never aliases a source Worker protocol or hides a renderer hold. */
import {makeStage1DinaClient, DINA_STAGE1_PROTOCOL} from '../browser-stage1-dina/client.mjs';
export {DINA_STAGE1_PROTOCOL};

const legacyHud='starfall-stage1-rules/1';
const mode='starfall-stage1-dina-headless';
const ruleClosure='qualified_headless_11_native_wasm_runs_plus_dina_summon_route';
const dinaPoisonCloud='headless_rules_verified_particle_and_audio_parity_held';
const identity=(m)=>m?.version==='134377281279792758'&&m?.gameId===70441022&&m?.stageId===78000001&&m?.fps===30;
const fail=msg=>Object.assign(Error(msg),{code:'worker-contract'});

export function verifyDinaGates({gates:g},ready){
  if(!g||g.sourceState!==(ready?'integrity_verified':'not_loaded')||
    g.ruleClosure!==(ready?ruleClosure:'held_until_source_integrity_verified')||
    g.dinaPoisonCloud!==dinaPoisonCloud||g.source!=='pinned_stage1_only'||
    g.worldPose!=='raw_unit_state_without_animation'||g.animation!=='held_unmapped_unity_Animator_time'||
    g.audiovisualParity!=='held'||g.deployment!=='not_deployed') throw fail('Dina source scope or parity gate changed');
}
export function verifyDinaDescribe(m){
  if(m?.type!=='contract'||m?.protocol!==DINA_STAGE1_PROTOCOL||m?.mode!==mode||!identity(m))
    throw fail('Dina companion startup identity mismatch');
  verifyDinaGates(m,false);
}
/** Pure compatibility projection for unchanged chooser; raw /2 gates remain in the outer session. */
export function asLegacyChoiceInput({type,runId,requestId,state:s,events}){
  return {type,runId,requestId,protocol:legacyHud,gates:{sourceState:'integrity_verified'},
    state:{stageId:s.stageId,elapsedMs:s.elapsedMs,paused:s.paused,choice:s.choice,terminal:Boolean(s.terminal)},
    events:events.filter(x=>x[0]==='learn')};
}

/**
 * Catch identity changes before the existing strict client could drop a malformed
 * reply as unrelated. The coordinator serializes requests, so an unexpected
 * packet is fatal, not a trigger to let official or /1 traffic into /2.
 */
export function makeVerifiedDinaClient({WorkerClass=globalThis.Worker}={}){
  if(typeof WorkerClass!=='function') throw fail('Dina worker host unavailable');
  class GuardedWorker {
    #worker;#pending=null;#closed=false;#fatal=null;
    constructor(url){
      this.#worker=new WorkerClass(url);
    }
    addEventListener(name,fn){
      if(name==='error'){
        this.#fatal=fn;
        this.#worker.addEventListener(name,e=>fn(e));
      }else if(name==='message'){
        this.#worker.addEventListener(name,e=>{
          if(this.#closed)return;
          const m=e?.data,p=this.#pending;
          if(!p||m?.requestId!==p.requestId){
            this.#pending=null;this.#fatal?.(fail('Unexpected /2 Worker request identity'));return;
          }
          this.#pending=null;
          if(m.protocol!==DINA_STAGE1_PROTOCOL||m.runId!==p.runId){
            fn({data:{protocol:DINA_STAGE1_PROTOCOL,runId:p.runId,requestId:p.requestId,type:'error',
              code:'worker-contract',message:'Dina companion response identity mismatch'}});
          }else fn(e);
        });
      }
    }
    postMessage(m){
      if(this.#closed||this.#pending||m?.protocol!==DINA_STAGE1_PROTOCOL||
         (m.type==='init'&&m.mode!==mode))throw fail('Unsafe companion Worker request');
      this.#pending={requestId:m.requestId,runId:m.runId};
      try{this.#worker.postMessage(m);}catch(error){this.#pending=null;throw error;}
    }
    terminate(){this.#closed=true;this.#pending=null;return this.#worker.terminate();}
  }
  return makeStage1DinaClient({WorkerClass:GuardedWorker});
}

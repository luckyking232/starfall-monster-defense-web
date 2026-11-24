/** Observes the existing canonical transport. It never supplies or blocks authoritative replies. */
import {PROFILE_PROTOCOL} from '../profiles.mjs';
import {SCENES} from '../composed-stage20-full-early-hud/scene-profiles.mjs';
const allowed=id=>Number.isSafeInteger(id)&&Object.hasOwn(SCENES,id);
const gameplay=new Set(['step-fixed','advance-unscaled','select','speed','pause','resume']);
function action(m){
  if(m.type==='select')return {type:m.type,selection:Object.fromEntries(['windowId','generation','skillId','confirm'].map(k=>[k,m[k]]))};
  return Object.fromEntries(Object.entries(m).filter(([k])=>['type','ms','count','index'].includes(k)));
}
export function attachPublishedWorker({BaseWorker,openFor,onChange=()=>{},clockUs=()=>Math.floor(performance.now()*1000),isHidden=()=>false}={}){
  if(typeof BaseWorker!=='function'||typeof openFor!=='function')throw Error('Invalid canonical presentation attachment');
  let epoch=0,observer=null,stopAssets=null,tail=Promise.resolve(),state=null,packet=null,frame=null,queued=0,startUs=0,lastWall=0,err=null,ticking=false;
  const publish=()=>{try{onChange();}catch{/* presentation status cannot control authority */}};
  const now=()=>{const t=clockUs()-startUs;lastWall=Math.max(lastWall,Math.min(10_000_000_000,Math.floor(t)));return lastWall;};
  function clear({keepError=false}={}){
    epoch++;observer?.close();stopAssets?.();observer=stopAssets=null;tail=Promise.resolve();
    state=packet=frame=null;queued=0;lastWall=0;ticking=false;if(!keepError)err=null;publish();
  }
  function held(error,token){
    if(token!==epoch)return;
    err=error;clear({keepError:true});
  }
  function enqueue(token,fn){
    if(queued>=32){held(Object.assign(Error('Presentation work queue exceeded its private bound'),{code:'preview-queue-held'}),token);return;}
    queued++;
    tail=tail.then(async()=>{
      if(token!==epoch)return;
      try{await fn();}catch(e){held(e,token);}
      finally{if(token===epoch)queued--;}
    });
  }
  function register(m,r,us){
    if(r?.protocol!==PROFILE_PROTOCOL||r.runId!==m.runId||r.type==='error')return;
    const token=epoch;
    if(m.type==='init'&&allowed(m.stageId)&&r.type==='ready'){
      state=r.state;packet=r;startUs=us;lastWall=0;
      enqueue(token,async()=>{
        const open=await openFor(m.stageId);
        if(token!==epoch){open.observer.close();open.close();return;}
        observer=open.observer;stopAssets=open.close;
        const x=await observer.begin(r,{tape:m.tape,globalRngSeeds:m.globalRngSeeds});
        if(token===epoch){frame=x.frame;publish();}
      });
    }else if(gameplay.has(m.type)&&allowed(m.stageId)&&packet&&r.type==='state'){
      state=r.state;packet=r;
      const wall=now();
      enqueue(token,async()=>{
        if(!observer)throw Error('Canonical display observer did not open');
        const x=await observer.observe(action(m),r,wall);
        if(token===epoch){frame=x.frame;publish();}
      });
      publish();
    }
  }
  class WorkerClass{
    #raw;
    #requests=new Map();
    #listeners=new Set();
    constructor(url,options){
      if(new URL(url).href!==new URL('../worker.js',import.meta.url).href)throw Error('Different rule transport');
      this.#raw=new BaseWorker(url,options);
      this.#raw.addEventListener('message',e=>{
        const raw=e.data;
        const m=this.#requests.get(raw?.requestId);
        if(m)this.#requests.delete(raw.requestId);
        let saved;
        if(m){try{saved=structuredClone(raw);}catch{}}
        for(const listener of this.#listeners)listener(e);
        if(m&&saved){try{register(m,saved,clockUs());}catch(error){held(error,epoch);}}
      });
    }
    addEventListener(kind,listener){if(kind==='message')this.#listeners.add(listener);else this.#raw.addEventListener(kind,listener);}
    postMessage(m){
      if(m?.type==='init'||m?.type==='close'){this.#requests.clear();clear();}
      if(m?.type==='init'&&allowed(m.stageId)||gameplay.has(m?.type)&&allowed(m.stageId)){
        if(this.#requests.size>=64)held(Error('Canonical observer request bound'),epoch);
        else this.#requests.set(m.requestId,structuredClone(m));
      }
      return this.#raw.postMessage(m);
    }
    terminate(){clear();return this.#raw.terminate();}
  }
  function peek(){
    return {frame:frame&&packet?.requestId===frame.requestId?frame:null,state,error:err,working:queued>0,lineage:packet?Object.freeze({
      epoch,stageId:packet.state.stageId,runId:packet.runId,requestId:packet.requestId
    }):null};
  }
  return Object.freeze({
    WorkerClass,peek,close:clear,
    tick(){
      if(ticking||queued||!observer||!packet||packet.state.terminal||packet.state.paused||isHidden())return;
      const token=epoch,t=now();ticking=true;
      enqueue(token,async()=>{
        try{const r=await observer.display(t);if(token===epoch){frame=r.frame;publish();}}
        finally{if(token===epoch)ticking=false;}
      });
    },
    async settled(){await tail;return peek();}
  });
}

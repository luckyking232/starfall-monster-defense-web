/** Local progress uses the original per-stage marker ledger and mount identity.
 * Query and fragment belong to the navigation URL, not to the qualified entry
 * document's save key. They are not consulted by game or resource routing.
 */
export const RELEASE='134377281279792758-r6-local-clearance-1';
const SCHEMA='starfall.offline-cleared-stage/1',SPACE='starfall-monster-defense',GAME=70441022,ACTIVITY=70060517;
const FIRST=78000001,LAST=78000020;
const stageId=x=>Number.isSafeInteger(x)&&x>=FIRST&&x<=LAST;
const keyParts=['schema','release','game','activity','stageId','settlement'];
function hydrateItem(raw,n){
 if(typeof raw!=='string'||raw.length>240)return false;
 try{
  const a=JSON.parse(raw);
  if(!a||typeof a!=='object'||Array.isArray(a)||Object.keys(a).length!==keyParts.length||!keyParts.every(k=>Object.hasOwn(a,k)))return false;
  return a.schema===SCHEMA&&a.release===RELEASE&&a.game===GAME&&a.activity===ACTIVITY&&a.stageId===n&&a.settlement==='confirmed_natural_win';
 }catch{return false;}
}
function locationScope(input,here){
 const root=new globalThis.URL(input),where=new globalThis.URL(here);
 const local=root.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(root.hostname);
 if(!(root.protocol==='https:'||local)||root.origin!==where.origin||root.username||root.password||where.username||where.password||
    root.search||root.hash||!root.pathname.endsWith('/')||
    ![root.pathname,root.pathname+'index.html'].includes(where.pathname))throw Error('Unqualified saved game scope');
 return SPACE+':'+RELEASE+':'+root.href+':';
}
function marker(n){return JSON.stringify({schema:SCHEMA,release:RELEASE,game:GAME,activity:ACTIVITY,stageId:n,settlement:'confirmed_natural_win'});}
const admitted=new WeakSet();
const trusted=x=>{const x0=Object.freeze(x);admitted.add(x0);return x0;};
export const isProgressStore=x=>admitted.has(x);
const empty=Object.freeze({score:0,mode:'session-only'});
/**
 * The caller supplies only the packaged wrapper base. Real window localStorage is used.
 * An invalid/blocked record is never overwritten or proactively cleared.
 */
export function openProgressStore(base){
 let prefix,storage,last=empty;
 try{
  prefix=locationScope(base,globalThis.location.href);
  storage=globalThis.localStorage;
  if(!storage||typeof storage.getItem!=='function'||typeof storage.setItem!=='function')return trusted({get status(){return empty;},load:()=>empty,commit:()=>empty});
 }catch{return trusted({get status(){return empty;},load:()=>empty,commit:()=>empty});}
 const load=()=>{
  let score=0,sealedGap=false,invalid=false;
  try{
   for(let n=FIRST;n<=LAST;n++){
    const x=storage.getItem(prefix+n);
    if(x===null){sealedGap=true;continue;}
    if(!hydrateItem(x,n)||sealedGap){invalid=true;continue;}
    score=n;
   }
   return (last=Object.freeze({score,mode:invalid?'unreadable':'local'}));
  }catch{return (last=empty);}
 };
 return trusted({
  get status(){return last;},
  load,
  commit(n){
   if(!stageId(n))return last;
   const checked=load();
   if(checked.mode!=='local'||n<=checked.score)return checked;
   if(n!==(checked.score===0?FIRST:checked.score+1))
    return (last=Object.freeze({score:checked.score,mode:'unreadable'}));
   try{
    // An immutable per-stage marker means concurrent windows cannot write a lower maximum.
    const k=prefix+n;
    const existing=storage.getItem(k);
    if(existing!==null&&!hydrateItem(existing,n))
     return (last=Object.freeze({score:checked.score,mode:'unreadable'}));
    if(existing===null)storage.setItem(k,marker(n));
    const aud=load();
    return aud.score>=n?aud:(last=Object.freeze({score:aud.score,mode:aud.mode==='unreadable'?'unreadable':'session-only'}));
   }catch{return (last=Object.freeze({score:checked.score,mode:'session-only'}));}
  }
 });
}

from pathlib import Path, PurePosixPath
from hashlib import sha256
import json,posixpath,re,sys
H=Path(__file__).resolve().parent;W=H.parent
P=W/'qualified-game/revisions/r6/cloud-temporary-20108-cpu'
P_PIN='53d490b495da6358d9ebace0460f319ae6874dfe10ef73eadec486948e8f50d9'
def sha(b):return sha256(b).hexdigest()
def enc(x):return (json.dumps(x,sort_keys=True,separators=(',',':'),ensure_ascii=False)+'\n').encode()
def read(p,h):
 b=p.read_bytes();assert sha(b)==h,p;return b
def one(s,a,b,no=1):
 assert s.count(a)==no,(a,s.count(a));return s.replace(a,b)
def relative(host,target):
 p=posixpath.relpath(target,start=posixpath.dirname(host));return p if p.startswith('.') else './'+p
AUTH='/qualified-game/revisions/r6/worker.js'
SRC='/_portable/authority.js'
CORE='/_portable/runtime-core.js'
MAP='/_portable/route-ledger.js'
MODULE='/portable.mjs'
def from_parent():
 m=json.loads(read(P/'VERIFICATION.json',P_PIN))
 routes=json.loads(read(P/'routes.json',m['files']['routes.json']))
 for k,v in routes.items():
  f=W/v['file'];assert str(f.resolve())==str(f) and f.is_relative_to(W)
  assert not k.startswith('//') and '\\' not in k
 return routes
def adapt_code(k,s):
 # Explicit transport substitutions only. Raw Lua, WASM, assets and their receipts are never rewritten.
 s=s.replace('globalThis.location','__p.location').replace('globalThis.fetch','__p.fetch').replace('globalThis.Worker','__p.Worker')
 s=s.replace('self.location','location')
 for a,b in [
  ("o.origin===expectedOrigin&&o.protocol==='http:'&&\n    o.hostname==='127.0.0.1'&&o.port!==''","o.origin===expectedOrigin&&__p.sameOrigin(o)"),
  ("location.hostname==='127.0.0.1'&&location.protocol==='http:'","__p.sameOrigin(location)"),
  ("location.protocol==='http:'&&location.hostname==='127.0.0.1'","__p.sameOrigin(location)"),
  ("local.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(local.hostname)","__p.sameOrigin(local)"),
  ("host.protocol==='http:'&&host.hostname==='127.0.0.1'","__p.sameOrigin(host)"),
  ("['127.0.0.1','localhost','[::1]'].includes(here.hostname)","__p.sameOrigin(here)"),
  ("if(!['localhost','127.0.0.1','[::1]'].includes(location.hostname))","if(!__p.sameOrigin(location))"),
  ("urlBase.startsWith(prefix)&&new URL(urlBase).origin===urlBase","urlBase===__p.location.origin&&new URL(urlBase).origin===urlBase"),
  ("/^http:\\/\\/127\\.0\\.0\\.1:\\d+$/u.test(origin??'')","origin===__p.location.origin"),
  ("/^http:\\/\\/127\\.0\\.0\\.1:\\d+$/u.test(origin)","origin===__p.location.origin"),
 ]:s=s.replace(a,b)
 s=s.replace("import('/presentation-clock/source-tap.mjs')","import(__p.importURL('/presentation-clock/source-tap.mjs'))")
 if '.pathname' in s and '127.0.0.1' in s:
  # Any residual private host guard must be named (only historical code packaged for transitively admitted imports).
  for l in s.splitlines():
   if '127.0.0.1' in l:assert "const prefix='http://127.0.0.1:'" in l,(k,l)
 return s
def classic_boot(k):
 return "importScripts("+json.dumps(relative(k,CORE))+","+json.dumps(relative(k,MAP))+");\n"+f"const __p=globalThis.__starfallMakePortable(new globalThis.URL({json.dumps(relative(k,'/'))},globalThis.location.href),globalThis.__starfallRouteLedger,globalThis.__starfallWorkers);\n"+ "const {URL,fetch}=__p;\nconst location=__p.location;\n"
FROST='/qualified-game/revisions/r6/stage78-frost-source-witness'
FROST_PIN='573b10647da3cada73bf911c5c91db3425b8141e606f27c9999d7c3386ebeb7e'
LAYER='/qualified-game/revisions/r6/cloud-temporary-20108-cpu/site-layer.mjs'
def with_frost(s):
 s="import {openCanonicalObserver as openFrost78,EXPLICIT_LANE as FROST78} from '../stage78-frost-source-witness/observer.mjs';\n"+s
 s=one(s,'deathReceipt=null,rendererLane=','deathReceipt=null,frostReceipt=null,rendererLane=')
 s=one(s,'clearFront();slowReceipt=null;omittedFx=null;deathReceipt=null;stage2Attempt=','clearFront();slowReceipt=null;omittedFx=null;deathReceipt=null;frostReceipt=null;stage2Attempt=')
 s=one(s,'deathReceipt=null;rendererLane=null;', 'deathReceipt=null;frostReceipt=null;rendererLane=null;',2)
 s=one(s,'     earlyFx?(id,opts)=>openEarlyFx', """     map3&&stage78(stageId)?(id,opts)=>openFrost78({...opts,stageId:id,lane:FROST78,onFrostEvidence:x=>{if(turn===opening)frostReceipt=x;}}):
     earlyFx?(id,opts)=>openEarlyFx""")
 return one(s,"  if(syncing)hint.textContent=", """  const frozen=map3&&stage78(stageId)&&visible&&p.frame&&frostReceipt?.frame===p.frame&&frostReceipt.stageId===stageId&&
    frostReceipt.runId===p.frame.runId&&frostReceipt.requestId===p.frame.requestId&&frostReceipt.fixed===b?.fixedFrame&&
    frostReceipt.evidence?.drawable===false&&frostReceipt.evidence.activeTargets.length;
  if(frozen)hint.textContent+=' 原冻结已核对；单位动作随原规则停走，冰冻粒子未绘制。';
  if(syncing)hint.textContent=""")
LATE={9:'0f91d19c0a2bcd313ccbcaba31c4aad65466fd3930bbfa199bb40883e38f37e1',
     10:'0c7d118c5c0a7e5417092ae081370300bcdc72c98cbec371feaf2678bb77b3ea'}
def with_late302(s):
 for n in LATE:
  s=f"import {{openCanonicalObserver as fx{n},EXPLICIT_LANE as FX{n}}} from '../stage{n}-fx-only-summons/observer.mjs';\n"+s
 s=one(s,"     map3&&world910(stageId)?(id,opts)=>openRecoverable910({...opts,stageId:id,lane:R910,onDeathStatus:x=>{if(turn===opening)deathReceipt=x;}}):",
 """     map3&&world910(stageId)?(id,opts)=>(id===78000009?fx9:fx10)({...opts,stageId:id,lane:id===78000009?FX9:FX10,
      onDeathStatus:x=>{if(turn===opening)deathReceipt=x;},
      onOmissions:x=>{if(turn===opening)omittedFx=x;}}):""")
 s=one(s,"Number.isSafeInteger(stageId)&&stageId>=78000003&&stageId<=78000006&&",
       "[78000003,78000004,78000005,78000006,78000009,78000010].includes(stageId)&&")
 s=one(s,"(stageId<=78000004?78000302:78000303)","([78000005,78000006].includes(stageId)?78000303:78000302)")
 return s
def generate(with_progress=False):
 routes=from_parent();new={};transport=[];exactSources=[]
 frost=json.loads(read(W/(FROST[1:]+'/VERIFICATION.json'),FROST_PIN))
 for n in ('observer.mjs','frost-ledger.mjs','companion.js','frost-tap.lua'):
  k=FROST+'/'+n;assert k not in routes
  routes[k]={'file':k[1:],'sha256':frost['files'][n]['sha256']}

 if with_progress:
  for stage,pin in LATE.items():
   path=f'/qualified-game/revisions/r6/stage{stage}-fx-only-summons'
   source=json.loads(read(W/(path[1:]+'/VERIFICATION.json'),pin))
   for n in ('observer.mjs','death.mjs','ledger.mjs','companion.js','source-tap.lua'):
    k=path+'/'+n;assert k not in routes
    routes[k]={'file':k[1:],'sha256':source['files'][n]['sha256']}

 ws=adapt_code(AUTH,read(W/routes[AUTH]['file'],routes[AUTH]['sha256']).decode())
 # Source is executed by a classic Worker bootstrap or cloned by its exact read-only companions.
 work=ws.encode()
 new[SRC]=work
 new[AUTH]=(classic_boot(AUTH)+f"importScripts(__p.importURL({json.dumps(SRC)}));\n").encode()
 workers=[AUTH]
 for k,m in routes.items():
  if k==AUTH:continue
  if k.endswith('/') and k!='/qualified-game/':continue
  if '/qa-' in k or '/cloud-stage2-qa/' in k:continue
  b=read(W/m['file'],m['sha256'])
  if k=='/qualified-game/':
   html=b.decode()
   html=re.sub(r'(\b(?:href|src)=")/',r'\1./',html)
   meta='<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\' blob: \'wasm-unsafe-eval\'; worker-src \'self\'; connect-src \'self\' blob:; img-src \'self\' blob:; style-src \'self\'; font-src \'self\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'">'
   new['/index.html']=one(html,'<meta charset="utf-8">','<meta charset="utf-8">\n  '+meta).encode()
  elif k.endswith('.mjs'):
   source=with_frost(b.decode()) if k==LAYER else b.decode()
   if with_progress:
    from progress.changes import future
    source=future(k,with_late302(source) if k==LAYER else source,m['sha256'])
   s=adapt_code(k,source)
   if re.search(r'\b(?:new URL|fetch\(|location\.|__p\.)',s):
    s=f"import {{P as __p}} from {json.dumps(relative(k,MODULE))};\nconst {{URL,fetch,location,Worker}}=__p;\n"+s
   new[k]=s.encode()
   if new[k]!=b:transport.append(k)
  elif k.endswith('.js') and b"const EXPECTED=" in b:
   s=adapt_code(k,b.decode())
   old=routes[AUTH]['sha256'];assert s.count(old)==1,k
   s=one(s,old,sha(work))
   s=one(s,"bytes('/qualified-game/revisions/r6/worker.js',baseSHA)",f"bytes('{SRC}',baseSHA)")
   s=one(s,"'use strict';","'use strict';\n"+classic_boot(k))
   new[k]=s.encode()
   transport.append(k);workers.append(k)
  else:
   new[k]=b;exactSources.append(k)
 if with_progress:
  from progress.changes import STORAGE
  new[STORAGE]=(H/'progress'/'store.mjs').read_bytes()
 new[CORE]=(H/'runtime-core.js').read_bytes()
 new[MODULE]=(f"import {json.dumps(relative(MODULE,CORE))};\nimport {json.dumps(relative(MODULE,MAP))};\n"
  "export const P=globalThis.__starfallMakePortable(new globalThis.URL('./',import.meta.url),globalThis.__starfallRouteLedger,globalThis.__starfallWorkers);\n").encode()
 ledger={};assets={}
 for k,v in list(new.items()):
  if k=='/index.html':continue
  h=sha(v);ext=posixpath.splitext(k)[1]
  key=(ext,h)
  if ext in ('.png','.json','.lua','.otf','.jsonl','.wasm') and key in assets:
   ledger[k]=[len(v),h,assets[key]];del new[k]
  else:
   ledger[k]=[len(v),h]
   assets[key]=k
 new[MAP]=('globalThis.__starfallRouteLedger=Object.freeze('+enc(ledger).decode().strip()+');\n'
  +'globalThis.__starfallWorkers=Object.freeze('+enc(workers).decode().strip()+');\n').encode()
 assert all(k.startswith('/') and not any(c in k for c in '?#') and PurePosixPath(k).is_absolute() for k in new)
 plan={'schema':'starfall.portable-static-private-build-plan/1','parent':P_PIN,'sourceFileCount':len(routes),'frostSourceProof':FROST_PIN,'files':len(new),'bytesUncompressed':sum(map(len,new.values())),
  'logicalAssetRoutes':len(ledger),'workerRoutes':workers,'verbatimAssetAndDataFiles':len(exactSources),'transportAdaptations':len(transport)+2,
  'folderWrapper':'xingluo-monsters-defense','rootEntry':'xingluo-monsters-defense/index.html','actualBrowserProven':False,'published':False}
 if with_progress:
  plan['explicitLocalSaveVariant']=True
  plan['stage9and10ExactLateSummonProofs']=LATE
 return new,plan
if __name__=='__main__':
 files,plan=generate('--progress' in sys.argv);print(json.dumps(plan,indent=2,ensure_ascii=False))

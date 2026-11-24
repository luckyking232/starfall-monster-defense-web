from pathlib import Path
from hashlib import sha256
import json,sys
H=Path(__file__).resolve().parent;R=H.parent;W=H.parents[3]
P=R/'cloud-early-fx-only-cpu';S=R/'temporary-20108-die'
P_PIN='0c4f841b24b2e9fc28a9af62827256dab671ad4c0789d50477663bf535ed0ffd'
def sha(b):return sha256(b).hexdigest()
def read(p,pin):
 b=p.read_bytes();assert sha(b)==pin,p;return b.decode()
def one(s,a,b):
 assert s.count(a)==1,(a,s.count(a));return s.replace(a,b)
def url(p):return '/'+p.relative_to(W).as_posix()
def generate():
 from pins import S_PIN
 p=json.loads(read(P/'VERIFICATION.json',P_PIN));old=lambda n:read(P/n,p['files'][n])
 src=json.loads(read(S/'VERIFICATION.json',S_PIN))
 html=one(old('index.html'),url(P/'ui.mjs'),url(H/'ui.mjs'))
 ui=old('ui.mjs')
 l=f"import {{openCanonicalObserver as openRecoverable910,EXPLICIT_LANE as R910}} from '../{S.name}/observer.mjs';\n"+old('site-layer.mjs')
 l=one(l,'export function openWorldLayer(',"""export function qualifyingDeathHold({stageId,receipt,lineage,battle,cpu}){
 return cpu===true&&world910(stageId)&&receipt?.stageId===stageId&&lineage?.stageId===stageId&&
  receipt.runId===lineage.runId&&receipt.requestId===lineage.requestId&&receipt.fixed===battle?.fixedFrame&&
  receipt.rendered===false&&receipt.reason==='original_20108_state3_no_draw_until_actual_remove';
}
export function openWorldLayer(""")
 l=one(l,'slowReceipt=null,omittedFx=null,rendererLane=','slowReceipt=null,omittedFx=null,deathReceipt=null,rendererLane=')
 l=one(l,'clearFront();slowReceipt=null;omittedFx=null;stage2Attempt=','clearFront();slowReceipt=null;omittedFx=null;deathReceipt=null;stage2Attempt=')
 l=one(l,'     earlyFx?(id,opts)=>openEarlyFx','     map3&&world910(stageId)?(id,opts)=>openRecoverable910({...opts,stageId:id,lane:R910,onDeathStatus:x=>{if(turn===opening)deathReceipt=x;}}):\n     earlyFx?(id,opts)=>openEarlyFx')
 assert l.count('slowReceipt=null;omittedFx=null;rendererLane=null;')==2
 l=l.replace('slowReceipt=null;omittedFx=null;rendererLane=null;','slowReceipt=null;omittedFx=null;deathReceipt=null;rendererLane=null;')
 l=one(l,"  let carry=false;","  const awaitingRetirement=qualifyingDeathHold({stageId,receipt:deathReceipt,lineage:p.lineage,battle:b,cpu:map3});\n  let carry=false;")
 l=one(l,'failed=!!p.error;','failed=!!p.error||awaitingRetirement;')
 l=one(l,"  if(syncing)hint.textContent=","""  if(awaitingRetirement&&!p.error)
    hint.textContent='20108 原死亡动画无可核验画面，战场暂时隐藏。规则照常；原对象移除后才显示新画面。';
  if(syncing)hint.textContent=""")
 refs=json.loads(old('routes.json'));assert len(refs)==521
 for path,data in [(H/'ui.mjs',ui),(H/'site-layer.mjs',l)]+[(S/k,read(S/k,src['files'][k])) for k in ('observer.mjs','death.mjs','companion.js','clock.mjs')]:
  u=url(path);assert u not in refs
  refs[u]={'file':u[1:],'sha256':sha(data.encode())}
 refs['/qualified-game/']={'file':url(H/'index.html')[1:],'sha256':sha(html.encode())}
 rr=json.dumps(refs,sort_keys=True,indent=2)+'\n'
 s=one(old('server.mjs'),p['files']['routes.json'],sha(rr.encode()))
 s=one(s,'length!==521','length!=='+str(len(refs)))
 s=one(s,'--enable-managed-early-fx-only-cpu','--enable-managed-temporary-20108-cpu')
 return {'index.html':html,'ui.mjs':ui,'site-layer.mjs':l,'routes.json':rr,'server.mjs':s,'package.json':old('package.json').replace('early-fx-only-cpu','temporary-20108-cpu')}
if __name__=='__main__':
 for n,s in generate().items():
  if '--verify' in sys.argv:assert (H/n).read_text()==s,n
  else:(H/n).write_text(s)

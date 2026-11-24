from build import H,P,P_PIN,S,W,sha
from pins import S_PIN
import json,re,shutil,subprocess,sys
assert shutil.disk_usage(H).free>=12*1024**3
subprocess.run([sys.executable,'-B','build.py','--verify'],cwd=H,check=True)
before=json.loads((P/'routes.json').read_bytes());after=json.loads((H/'routes.json').read_bytes())
assert [x for x in before if before[x]!=after.get(x)]==['/qualified-game/'] and len(after)==527
assert [x for x in after if x.endswith('/worker.js')]==['/qualified-game/revisions/r6/worker.js']
for d in after.values():
 p=W/d['file'];assert p.resolve()==p and p.stat().st_size and sha(p.read_bytes())==d['sha256'],p
toolbar=lambda s:re.search(r'<div id="tools" hidden>.*?<div id="runtime-diagnostics">',s,re.S).group()
assert toolbar((P/'index.html').read_text())==toolbar((H/'index.html').read_text())
subprocess.run(['node','--test','--test-concurrency=1','site.test.mjs',str(P/'site.test.mjs'),str(S/'death.test.mjs')],cwd=H,check=True,timeout=55)
o=H/'VERIFICATION.json'
r={'schema':'starfall.r6.cpu-temporary-20108-state3-hold/1','parentScopedEffects':P_PIN,'sameOldRoutesExceptEntry':True,
 'exactOriginalObserverAndCPURaster':S_PIN,'routeCount':len(after),'scopeStages':[9,10],
 'actualNormalStage9KnownFrames':[1516,1517,1547,1548],
 'noPreviousFramesShownAfterActualDeathReceipt':True,'originalModelRemovalAndFreshBodyFrameRequired':True,
 'oldWorkerControlsTimingUntouched':True,'doesNotChangeFrostOrOtherUnknownGuards':True,
 'didNotAccessOwnerMachineRestartPreviewOrExecuteBrowser':True}
r['files']={k.name:sha(k.read_bytes()) for k in sorted(H.iterdir()) if k.is_file() and k!=o}
b=(json.dumps(r,sort_keys=True,indent=2)+'\n').encode()
if '--verify' in sys.argv:assert o.read_bytes()==b
else:
 with o.open('xb') as f:f.write(b)
print(sha(b))

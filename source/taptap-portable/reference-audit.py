"""Audit literal path semantics from the existing sealed ZIP; does not rewrite/package it."""
from pathlib import Path
from zipfile import ZipFile
from urllib.parse import quote
import json,re,sys
from plan import H,sha
W='xingluo-monsters-defense/'
ZIP_PIN='80ebe60ae461583c640cb667035164f9331e3b93f53c4b3181b6e3bc35ccf3f9'
p=Path(sys.argv[1]) if len(sys.argv)==2 else H/'魔物抵御战_TapTap_私有预检.zip'
assert sha(p.read_bytes())==ZIP_PIN
with ZipFile(p) as f:
 b={('/'+quote(name[len(W):],safe='/.-_')):f.read(name) for name in f.namelist() if name.startswith(W)}
ledger=json.JSONDecoder().raw_decode(b['/_portable/route-ledger.js'].decode().split('Object.freeze(',1)[1])[0]
length=lambda k:len(ledger[k]) if k in ledger else 0
record={}
lits=re.compile(r'''['"](/(?:[a-zA-Z0-9_.-]+/)+[a-zA-Z0-9_.%\-]*)['"]''')
calls=re.compile(r'''(?:\bnew\s+URL\(|(?<![A-Za-z_])fetch\(|^\s*importScripts\(|import\(__p\.importURL\()''',re.M)
def mode(k,s):
 if k=='/_portable/authority.js':return 'inherits classic bootstrap from authority wrapper; companions wrap this same SHA-pinned source'
 if k=='/_portable/runtime-core.js':return 'scope resolver itself'
 if k=='/portable.mjs':return 'scope initializer, genuine URL of this module chooses wrapper directory'
 if 'globalThis.__starfallMakePortable(' in s:return 'classic exact worker route with scoped lexical URL/fetch'
 if 'const {URL,fetch,location,Worker}=__p;' in s:return 'module lexical scoped URL/fetch/location/Worker'
 return 'data label or exported route descriptor; not direct network I/O'
for k,raw in b.items():
 if not k.endswith(('.js','.mjs')) or k in ('/_portable/route-ledger.js','/core-worker/inputs/vendor/index.js'):continue
 s=raw.decode();ls=sorted(set(lits.findall(s)));m=mode(k,s)
 if calls.search(s):
  assert m!='data label or exported route descriptor; not direct network I/O',(k,s)
 for x in ls:
  if x in ledger:typ='logical pinned read/expected identity';assert ledger[x][0]>0
  elif x=='/qualified-game/worker.js':typ='virtual legacy base for sibling ../ dependencies; not fetched directly'
  elif x=='/qualified-game/':typ='virtual page identity for exact observer gate; index.html is physical entry'
  elif any(k.startswith(x) for k in ledger) and x.endswith('/'):typ='prefix, only derived/pinned complete keys may be read'
  elif x.startswith('/Assets/'):typ='original Lua prefab identity, never an HTTP path'
  elif x.startswith(('/Bg/','/DPS1/','/DPSProgressBar/')):typ='FairyGUI object path, not HTTP'
  else:raise ValueError((k,x))
  record.setdefault(k,{'binding':m,'literals':[]})['literals'].append([x,typ])
for k,v in ledger.items():
 physical=v[2] if len(v)==3 else k
 assert physical in b and sha(b[physical])==v[1] and len(b[physical])==v[0],k
html=b['/index.html'].decode()
refs=re.findall(r'\b(?:src|href)="([^"]+)"',html)
assert len(refs)==10 and all(x.startswith('./') and x[1:] in b for x in refs)
assert not any(re.search(r'url\(\s*["\']?/',raw.decode()) for k,raw in b.items() if k.endswith('.css'))
q={'archiveSHA':ZIP_PIN,'literalModuleCount':len(record),'logicalReferences':sum(len(x['literals']) for x in record.values()),
 'entryPhysicalRelativeReferences':refs,'testedLedgerRoutes':len(ledger),
 'allLogicalAssetsDigestVerifiedAgainstZIP':True,'vendorBrowserWasmNotes':'Pinned Wasmoon vendor uses original load routine; network goes to declared package byte paths or generated verified Blob object URLs. Browser runtime uses no Node fallback.',
 'modules':record}
print(json.dumps(q,indent=2,ensure_ascii=False))

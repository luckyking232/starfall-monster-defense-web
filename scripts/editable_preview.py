"""Explicit local overrides to authored presentation code, never a ZIP builder."""
from hashlib import sha256
import json
from pathlib import Path
import re

REV = 'qualified-game/revisions/r6'
TOP = REV + '/cloud-temporary-20108-cpu'
ALLOWED = frozenset((
    TOP + '/ui.mjs', TOP + '/site-layer.mjs',
    REV + '/site/shell.mjs', REV + '/site/choice-hud.mjs',
    REV + '/cloud-stage12-no-flash/hold.mjs',
    REV + '/cloud-stage1to20-cpu/hold.mjs',
    REV + '/cloud-stage1to20-input-priority/pointer-priority.mjs',
    REV + '/cloud-stage12-stable-tools/controls.css',
    'offline-shell/private.css',
    'hud-renderer/hud-fields.mjs',
))
MARKER = b'starfall-local-editable-preview'
PREFIX = '/dev-play/'
LEDGER = '_portable/route-ledger.js'
CORE = '_portable/runtime-core.js'


def read_edits(args):
    edits={}
    for pair in args:
        route,ok,path=pair.partition('=')
        if not ok or route not in ALLOWED or route in edits:
            raise ValueError('Provide a unique allowed RUNTIME_PATH=LOCAL_FILE; see --list-editable')
        p=Path(path)
        if p.is_symlink() or not p.is_file() or p.stat().st_size>262144:
            raise ValueError('Each edit must be a regular UTF-8 file ≤256 KiB')
        with p.open('rb') as f:
            data=f.read(262145)
        if len(data)>262144 or b'\0' in data:
            raise ValueError('Edit exceeds bounds or contains NUL')
        edits[route]=data.decode('utf-8')
    return edits


def compile_authored(portable, route, raw, pin):
    if route.endswith('.css'):
        return raw.encode()
    from progress.changes import future
    source=portable.with_frost(raw) if route==portable.LAYER else raw
    source=future(route,portable.with_late302(source) if route==portable.LAYER else source,pin)
    s=portable.adapt_code(route,source)
    if re.search(r'\b(?:new URL|fetch\(|location\.|__p\.)',s):
        s=f"import {{P as __p}} from {json.dumps(portable.relative(route,portable.MODULE))};\nconst {{URL,fetch,location,Worker}}=__p;\n"+s
    return s.encode()


def derive(entries, root, portable, tree, edits, authored):
    checked={k:v for k,v in entries.items()}
    wrapper=root+'/'
    metadata=checked[wrapper+LEDGER].decode()
    start='globalThis.__starfallRouteLedger=Object.freeze('
    table,sep,rest=metadata.removeprefix(start).partition(');\n')
    assert metadata.startswith(start) and sep
    rows=json.loads(table)
    routes=portable.from_parent()
    for name,raw in edits.items():
        if name not in ALLOWED or name not in authored:
            raise ValueError('Development scope is limited to approved authored routes')
        k='/'+name
        info=routes[k]
        if info['file']!=name or len(rows[k])!=2:
            raise ValueError('Editable route must be directly authored and not aliased')
        old=portable.read(tree/name,info['sha256']).decode('utf-8')
        if compile_authored(portable,k,old,info['sha256'])!=checked[wrapper+name]:
            raise ValueError('Editable compilation no longer matches the verified baseline')
        b=compile_authored(portable,k,raw,info['sha256'])
        checked[wrapper+name]=b
        rows[k]=[len(b),sha256(b).hexdigest()]
    # This gate is added only to the in-memory variant. It also blocks a copied
    # variant rehosted as a normal static project on a public origin.
    local=b"""/* starfall-local-editable-preview: this is not a release. */
if (globalThis.location.protocol !== 'http:' ||
    globalThis.location.hostname !== '127.0.0.1' ||
    !globalThis.location.pathname.startsWith('/dev-play/')) {
  throw new Error('Editable preview is available only on local development loopback.');
}
"""
    ck=wrapper+CORE
    checked[ck]=local+checked[ck]
    # CORE is imported as a normal script; keep the route ledger truthful too.
    if '/'+CORE in rows:
        rows['/'+CORE]=[len(checked[ck]),sha256(checked[ck]).hexdigest()]
    checked[wrapper+LEDGER]=(start+portable.enc(rows).decode().strip()+');\n'+rest).encode()
    html=checked[wrapper+'index.html']
    old=b'<head>'
    assert html.count(old)==1
    html=html.replace(old,old+b'\n  <meta name="starfall-local-editable-preview" content="not-for-distribution">')
    header=b'<header>'
    assert html.count(header)==1
    checked[wrapper+'index.html']=html.replace(header,header+'\n      <strong>本机开发预览 · 代码已修改 · 不可发布</strong>'.encode())
    del checked[wrapper+'MANIFEST-PRIVATE.json']
    return checked

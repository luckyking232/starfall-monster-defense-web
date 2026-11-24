"""Mount the public Alpha with the startup patch at an isolated QA path."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

from materialize_public_alpha import deploy

UI = 'qualified-game/revisions/r6/cloud-temporary-20108-cpu/ui.mjs'
MAP = '_portable/route-ledger.js'
PATCH = Path(__file__).resolve().parents[1] / 'packages/ui/startup/alpha-1.patch'
OLD = '716172892a59070e0c66f94afd778b3c356726a8a39b8197e47511864d9ccec2'
NEW = 'e1ce398059925c073248bf0e1c811c6684b7c0d5cf1270680c661d98b01239e9'

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def once(text, old, new):
    if text.count(old) != 1:
        raise ValueError('Missing or ambiguous startup anchor: ' + old)
    return text.replace(old,new,1)

def mount(archive, receipt, output):
    deploy(archive,receipt,output)
    path=output/UI
    old=path.read_bytes()
    if sha(old)!=OLD:
        raise ValueError('Unexpected original entry module')
    new=subprocess.run(['patch','--batch','--forward','--fuzz=0','--silent','-o','-',str(path),str(PATCH)],
                       check=True,stdout=subprocess.PIPE,timeout=10).stdout
    if sha(new)!=NEW:
        raise ValueError('Unexpected candidate entry module')
    index=output/'index.html'
    html=once(index.read_text('utf-8'),'</h1>',
        '</h1>\n      <p id="entry-state" role="status">正在加载选关资源，请稍候…</p>'
        '\n      <noscript>此游戏需要启用 JavaScript 才能运行。</noscript>')
    html=once(html,'<meta charset="utf-8">','<meta charset="utf-8">\n  <meta name="robots" content="noindex">')
    html=once(html,'打开原选关画布','返回选关')
    html=once(html,'（非官方）</title>',' · 选关验收候选（未发布）</title>')
    html=once(html,'<small>开发预览','<small>选关验收候选 · 非正式版本 · 开发预览')
    table=output/MAP
    prefix='globalThis.__starfallRouteLedger=Object.freeze('
    data=table.read_text('utf-8')
    body,sep,rest=data.removeprefix(prefix).partition(');\n')
    if not data.startswith(prefix) or not sep:
        raise ValueError('Unexpected route ledger format')
    routes=json.loads(body)
    if routes.get('/'+UI)!=[len(old),OLD]:
        raise ValueError('Expected exact Alpha UI descriptor')
    routes['/'+UI]=[len(new),NEW]
    modified={UI:new,'index.html':html.encode(),MAP:(prefix+json.dumps(
        routes,sort_keys=True,ensure_ascii=False,separators=(',',':'))+');\n'+rest).encode()}
    # This is a Pages QA mount, not a ZIP or Release; keep its raw-file receipt truthful.
    receipt_path=output/'MANIFEST-PRIVATE.json'
    manifest=json.loads(receipt_path.read_bytes())
    for name,raw in modified.items():
        manifest['rawFiles'][name]=[len(raw),sha(raw)]
    manifest['startupCandidate']={'publishedArtifact':False,'qaOnly':True}
    for name,raw in modified.items():
        (output/name).write_bytes(raw)
    receipt_path.write_bytes((json.dumps(manifest,sort_keys=True,ensure_ascii=False,separators=(',',':'))+'\n').encode())
    print('Mounted startup browser QA; published /play/ build was not modified.')

if __name__=='__main__':
    if len(sys.argv)!=4:
        raise SystemExit('usage: materialize_startup_qa.py PUBLIC_ZIP RECEIPT OUT_DIR')
    mount(*map(Path,sys.argv[1:]))

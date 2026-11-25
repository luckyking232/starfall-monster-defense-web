#!/usr/bin/env python3
"""Prepare a private Stage1 continuity QA overlay. Never build a release ZIP."""
from hashlib import sha256
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

HERE=Path(__file__).resolve().parents[1]/'packages/ui/display-continuity'
UI='qualified-game/revisions/r6/cloud-temporary-20108-cpu/ui.mjs'
LEDGER='_portable/route-ledger.js'
RECEIPT='MANIFEST-PRIVATE.json'
PREFIX='globalThis.__starfallRouteLedger=Object.freeze('
QA_PAIR=('e1ce398059925c073248bf0e1c811c6684b7c0d5cf1270680c661d98b01239e9',
         'c3ceaaa344e7ccbd410a108eca9ea508a9d6ff3c0b1c6b225c1336f4c2919458')
ALPHA='e4815c483ffc9cca7d27d5a91f75ce882ef3a9af3d9f6f0c66b2c690aa15c819'
A=b"!priority.waiting&&['battle'"
B=b"!priority.waiting&&!world?.presentationBusy()&&['battle'"

def check(value, why):
    if not value:
        raise ValueError(why)

def sig(b):
    return [len(b),sha256(b).hexdigest()]

def emit(x):
    return json.dumps(x,ensure_ascii=False,sort_keys=True,separators=(',',':'))

def plan(root, *, startup=False):
    pins=json.loads((HERE/'PATCH-RECEIPT.json').read_bytes())
    patch=(HERE/'portable-alpha1-display-continuity.patch').read_text()
    parts=re.split(r'^--- a/([^\n]+)\n',patch,flags=re.M)
    check(parts[0]=='' and parts[1::2]==sorted(pins),'Each expected path must have exactly one patch')
    manifest=json.loads((root/RECEIPT).read_bytes())
    check(bool(manifest.get('startupCandidate'))==startup,'QA and Alpha paths cannot be mixed')
    inventory=manifest['rawFiles']
    actual={p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file()}
    check(actual=={RECEIPT,*inventory},'Not the complete verified Alpha inventory')
    for path,entry in inventory.items():
        check(sig((root/path).read_bytes())==entry,f'Unexpected input drift: {path}')
    raw=(root/LEDGER).read_text()
    body,sep,rest=raw.removeprefix(PREFIX).partition(');\n')
    check(raw.startswith(PREFIX) and sep,'Unexpected portable ledger format')
    table=json.loads(body)
    edited={}
    for path,diff in zip(parts[1::2],parts[2::2],strict=True):
        check(not (root/path).is_symlink(),'unexpected module link')
        old=(root/path).read_bytes()
        pin=pins[path]
        expected=QA_PAIR if startup and path==UI else (pin['before'],pin['after'])
        entry=manifest['rawFiles'][path]
        check(sig(old)==table['/'+path]==entry and entry[1]==expected[0],f'Unexpected input drift: {path}')
        if path==UI and startup:
            check(old.count(A)==1,'Ambiguous auto-clock anchor')
            new=old.replace(A,B)
        else:
            new=subprocess.run(['patch','--batch','--forward','--fuzz=0','--silent','-o','-',str(root/path)],
                input=(f'--- a/{path}\n'+diff).encode(),stdout=subprocess.PIPE,check=True,timeout=10).stdout
        check(sig(new)[1]==expected[1],f'Unexpected patch output drift: {path}')
        table['/'+path]=sig(new); edited[path]=new
    edited[LEDGER]=(PREFIX+emit(table)+');\n'+rest).encode()
    for p,b in edited.items():
        manifest['rawFiles'][p]=sig(b)
    manifest['displayContinuityCandidate']={'qaOnly':True,'publishedArtifact':False,'sourceAlphaZipSha256':ALPHA}
    edited[RECEIPT]=(emit(manifest)+'\n').encode()
    return edited

def mount(base, output, *, startup=False):
    check(not output.exists() and not output.is_symlink(),'Choose a new output directory')
    check(not base.is_symlink() and not any(p.is_symlink() for p in base.rglob('*')),'QA tree must not contain symlinks')
    check(base.resolve() not in output.resolve().parents,'Output must not be nested in the inputs')
    changed=plan(base,startup=startup)
    with tempfile.TemporaryDirectory(dir=output.parent,prefix='.qa-build-') as t:
        staged=Path(t)/'site'
        shutil.copytree(base,staged)
        for p,b in changed.items():
            (staged/p).write_bytes(b)
        staged.replace(output)
    print('Mounted private QA candidate; nothing published.')

if __name__=='__main__':
    if len(sys.argv)!=4 or sys.argv[1] not in ('--alpha','--startup'):
        raise SystemExit('Usage: overlay.py --alpha|--startup VERIFIED_BASE_FOLDER NEW_OUTPUT_FOLDER')
    mount(Path(sys.argv[2]),Path(sys.argv[3]),startup=sys.argv[1]=='--startup')

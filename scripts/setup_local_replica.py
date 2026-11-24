"""Combine the published authored source and an exact local release input ZIP."""
import argparse
from hashlib import sha256
import json
from pathlib import Path, PurePosixPath
import shutil
import stat
import sys
import tempfile
from zipfile import ZipFile

from check_local_replica import checked_path, inputs, report

ROOT = Path(__file__).resolve().parents[1]
LOCK = ROOT/'release'/'inputs.lock.json'


def read_lock():
    v=json.loads(LOCK.read_text(encoding='utf-8'))
    if v['schema']!='starfall.release-input-lock/1' or v['version']!='v0.1.0-alpha.1':
        raise ValueError('Wrong release lock')
    return v


def replica_source():
    new=ROOT/'packages'/'replica-runtime'
    return new if new.is_dir() else ROOT/'source'


PREFIX = 'monster-defense-source-inputs/'
RELEASE = 'v0.1.0-alpha.1'
BUILDER = 'taptap-portable/wip-release.py'


def check_names(files):
    nodes = {}
    for rel in files:
        p = PurePosixPath(rel)
        if p.is_absolute() or not p.parts or p.as_posix() != rel or '..' in p.parts:
            raise ValueError('Noncanonical overlay path')
        for x in p.parts:
            windows = x.split('.')[0].upper()
            if (x in ('.', '..') or x.endswith((' ', '.')) or
                windows in {'CON','PRN','AUX','NUL', *(f'COM{i}' for i in range(1,10)),
                            *(f'LPT{i}' for i in range(1,10))} or
                any(c in '\\/:<>"|?*' or ord(c)<32 for c in x)):
                raise ValueError('Nonportable overlay path')
        for i in range(1,len(p.parts)+1):
            text = '/'.join(p.parts[:i])
            node = (text, i==len(p.parts))
            previous = nodes.setdefault(text.casefold(),node)
            if previous != node:
                raise ValueError('Overlay casefold or directory/file collision')


def load_overlay(archive):
    lock=read_lock()['inputs']
    if isinstance(archive,bytes):
        payload=archive
    else:
        if archive.is_symlink() or not archive.is_file() or archive.stat().st_size != lock['size']:
            raise ValueError('Exact release overlay bytes are required')
        payload = archive.read_bytes()
    if len(payload)!=lock['size'] or sha256(payload).hexdigest() != lock['sha256']:
        raise ValueError('Overlay bytes or SHA-256 mismatch')
    from io import BytesIO
    with ZipFile(BytesIO(payload)) as z:
        members=z.infolist()
        if len(members)!=lock['entries'] or sum(x.file_size for x in members)>40*1024**2:
            raise ValueError('Overlay bounds mismatch')
        for m in members:
            if (not m.filename.startswith(PREFIX) or m.is_dir() or
                m.flag_bits&1 or stat.S_IFMT(m.external_attr>>16)!=stat.S_IFREG):
                raise ValueError('Unexpected overlay member')
        names=[m.filename[len(PREFIX):] for m in members]
        check_names(names)
        if len(names)!=len(set(names)):
            raise ValueError('Duplicate overlay member')
        manifest=json.loads(z.read(PREFIX+'overlay-manifest.json'))
        rows=manifest['files']
        if (manifest['schema']!='starfall.source-input-overlay/1' or
             manifest['release']!=RELEASE or set(rows)|{'overlay-manifest.json'}!=set(names)):
            raise ValueError('Exact overlay manifest required')
        data={}
        for path, info in rows.items():
            b=z.read(PREFIX+path)  # also checks CRC
            if info['size']!=len(b) or info['sha256']!=sha256(b).hexdigest():
                raise ValueError(f'Overlay member hash mismatch: {path}')
            data[path]=b
    return data


def public_files(source):
    inventory=source/'PUBLIC-SOURCE-LIST.txt'
    paths=inventory.read_text(encoding='utf-8').splitlines()
    check_names(paths)
    if len(paths)!=len(set(paths)) or BUILDER not in paths:
        raise ValueError('Check out the matching release source revision before setup')
    return {p:checked_path(source,p).read_bytes() for p in paths}


def materialize(source, overlay, dest):
    base=public_files(source)
    local=load_overlay(overlay)
    if set(base)&set(local):
        raise ValueError('Public/overlay overlap: use the matching release tag')
    check_names([*base,*local])
    # Never mutate the Git checkout or nonempty existing target. Stage in the same
    # parent and only rename the fresh directory after read-only validation succeeds.
    if dest.is_symlink() or dest.exists() or not dest.parent.is_dir():
        raise ValueError('Output must be a new directory under an existing parent')
    if dest.is_relative_to(source.parent):
        raise ValueError('Choose a work tree outside the public Git checkout')
    if shutil.disk_usage(dest.parent).free < sum(map(len,base.values()))+sum(map(len,local.values()))+1024**2:
        raise ValueError('Insufficient output space')
    with tempfile.TemporaryDirectory(prefix='.monster-defense-setup-',dir=dest.parent) as td:
        tree=Path(td)/'out'
        tree.mkdir()
        for name,b in {**base,**local}.items():
            p=checked_path(tree,name)
            p.parent.mkdir(parents=True,exist_ok=True)
            with p.open('xb') as f: f.write(b)
        rows=report(source,tree,inputs(tree,True),True)
        if any(r['state'] not in ('public','local') for r in rows):
            raise ValueError('Combined tree is not the pinned source release')
        if dest.exists() or dest.is_symlink():
            raise ValueError('Output already exists')
        tree.rename(dest)
    return len(base),len(local)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--overlay',required=True,type=Path)
    p.add_argument('--output',required=True,type=Path)
    p.add_argument('--source',type=Path,default=replica_source())
    a=p.parse_args()
    try:
        # Resolve only the parent; do not follow an output symlink.
        out=a.output.parent.resolve(strict=True)/a.output.name
        n,m=materialize(a.source.resolve(strict=True),a.overlay,out)
    except (OSError,ValueError,KeyError) as e:
        print(f'Cannot set up release: {e}',file=sys.stderr)
        return 2
    print(f'Verified separate work tree: {n} authored files and {m} exact inputs.')
    return 0

if __name__=='__main__':
    sys.exit(main())

"""Build a deterministic TapTap ZIP from a reviewed public static payload."""
import argparse, hashlib, json, re, tempfile, zipfile
from pathlib import Path, PurePosixPath
from check_zip import check

SAFE = re.compile(r'^[a-zA-Z0-9_.][a-zA-Z0-9_. /-]*$')
PUB = {'original-mit', 'licensed-for-public-redistribution', 'public-domain'}
PRIVATE = {'.git', '.env', 'private', 'node_modules', '__MACOSX'}
BLOCKED_SUFFIX = {'.apk', '.ab', '.bundle', '.zip', '.pem', '.key'}

def prepare(source, manifest, output):
    if output.exists() or output.is_symlink():
        raise ValueError('Refusing to overwrite output.')
    if not source.is_dir() or source.is_symlink():
        raise ValueError('A real static build directory is required.')
    data = json.loads(manifest.read_text(encoding='utf-8'))
    if data.get('eligibility') != 'public-playable' or not isinstance(data.get('files'), dict):
        raise ValueError('HOLD: reviewed public-playable manifest not provided.')
    entries = data['files']
    actual = {}
    for path in source.rglob('*'):
        if path.is_symlink():
            raise ValueError('Unexpected symlink.')
        if path.is_dir():
            continue
        if not path.is_file():
            raise ValueError('Unexpected non-regular file.')
        actual[path.relative_to(source).as_posix()] = path
    if len(actual) > 16000 or set(actual) != set(entries) or 'index.html' not in entries:
        raise ValueError('HOLD: build does not match an exact manifest with index.html.')
    names = set()
    for name, record in entries.items():
        pieces = name.split('/')
        if (not SAFE.fullmatch(name) or any(x in PRIVATE or x in ('','.','..')
                or x.startswith('.env.') or x.endswith(('.', ' ')) for x in pieces)
                or PurePosixPath(name).suffix.lower() in BLOCKED_SUFFIX
                or name.casefold() in names):
            raise ValueError('Unsafe, colliding or designated private entry: '+name)
        names.add(name.casefold())
        if (not isinstance(record,dict) or record.get('license') not in PUB
                or not isinstance(record.get('provenance'), str)
                or not record['provenance'].strip()):
            raise ValueError('HOLD: missing per-file provenance and redistribution decision.')
    handle = tempfile.NamedTemporaryFile(dir=output.parent, prefix=output.name+'.', suffix='.partial', delete=False)
    temp = Path(handle.name)
    handle.close()
    try:
        with temp.open('wb') as raw, zipfile.ZipFile(raw, 'w', allowZip64=False) as z:
            for name, path in sorted(actual.items()):
                info = zipfile.ZipInfo('xingluo-monsters-defense/'+name, (1980,1,1,0,0,0))
                info.create_system = 3
                info.external_attr = 0o100644 << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                info._compresslevel = 9
                digest = hashlib.sha256()
                size = 0
                with path.open('rb') as src, z.open(info,'w') as dst:
                    while chunk := src.read(1024*1024):
                        digest.update(chunk)
                        size += len(chunk)
                        dst.write(chunk)
                if size != entries[name].get('bytes') or digest.hexdigest() != entries[name].get('sha256'):
                    raise ValueError('Source changed or hash mismatch: '+name)
        with temp.open('rb') as f:
            r = check(f,temp.stat().st_size)
        if r['status'] != 'STATIC_PREFLIGHT_ONLY':
            raise ValueError('Static archive preflight failed: '+'; '.join(r['errors'][:6]))
        # Do not replace another build produced by a concurrent invocation.
        output.hardlink_to(temp)
    finally:
        if temp.exists() and temp.is_file() and not temp.is_symlink():
            temp.unlink()

if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    for v in ('build','manifest','out'):
        p.add_argument('--'+v, type=Path, required=True)
    a = p.parse_args()
    try:
        prepare(a.build,a.manifest,a.out)
    except (OSError,ValueError,RuntimeError) as e:
        p.exit(2,str(e)+'\n')

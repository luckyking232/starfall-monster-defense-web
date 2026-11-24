"""Validate and expand exactly one pinned public game build for GitHub Pages."""
from pathlib import Path, PurePosixPath
import hashlib, json, re, shutil, stat, sys, unicodedata, zipfile

EXT = {'.css','.html','.js','.json','.jsonl','.lua','.mjs','.otf','.png','.txt','.wasm'}
LICENSES = {'LICENSES/Lua-License.txt','LICENSES/NOTICES.txt',
            'LICENSES/Source-Han-Sans-OFL-1.1.txt','LICENSES/Wasmoon-MIT.txt'}

def deploy(archive, receipt, destination=None):
    m = json.loads(receipt.read_text('utf-8'))
    if archive.stat().st_size != m['bytes'] or not 0 < m['bytes'] <= 314572800:
        raise ValueError('Unexpected portable ZIP size')
    with archive.open('rb') as f:
        if hashlib.file_digest(f, 'sha256').hexdigest() != m['sha256']:
            raise ValueError('Unexpected portable ZIP SHA-256')
    if destination is not None and (destination.exists() or destination.is_symlink()):
        raise ValueError('Expected a fresh Pages build output')
    with zipfile.ZipFile(archive) as z:
        flat = {}
        seen = set()
        wrapper = m['wrapper']
        for entry in z.infolist():
            path = PurePosixPath(entry.filename)
            if (path.as_posix() != entry.filename or len(path.parts) < 2
                    or path.parts[0] != wrapper or any(p in {'.','..'} for p in path.parts)
                    or not re.fullmatch(r'[\w./-]+',entry.filename)
                    or unicodedata.normalize('NFC',entry.filename) != entry.filename
                    or entry.filename.casefold() in seen or entry.is_dir()
                    or stat.S_IFMT(entry.external_attr >> 16) not in (0,stat.S_IFREG)
                    or path.suffix not in EXT or entry.flag_bits & 1):
                raise ValueError('Unexpected portable ZIP member: '+repr(entry.filename))
            seen.add(entry.filename.casefold())
            flat[PurePosixPath(*path.parts[1:]).as_posix()] = entry
        if len(flat) != m['members'] or 'index.html' not in flat or not LICENSES <= flat.keys():
            raise ValueError('Portable ZIP requires the pinned members, entry and notices')
        if sum(e.file_size for e in flat.values()) > 160*1024**2 or z.testzip() is not None:
            raise ValueError('Portable ZIP expanded size or CRC rejected')
        if destination is None:
            return
        destination.mkdir(parents=True)
        for name, entry in flat.items():
            output = destination / name
            output.parent.mkdir(exist_ok=True,parents=True)
            with z.open(entry) as f, output.open('xb') as out:
                shutil.copyfileobj(f,out)

if __name__ == '__main__':
    if len(sys.argv)!=4:
        raise SystemExit('usage: materialize_public_alpha.py ZIP RECEIPT OUT_DIR')
    deploy(*map(Path,sys.argv[1:]))

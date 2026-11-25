"""Current source entry and explicit transitional runtime projection. No deployment."""
import argparse
from importlib.util import module_from_spec, spec_from_file_location
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

from audit_runtime import ledger, sig
from dev import download_input, server
from product_bindings import ACTOR, CLOCK, SHARED, links
from setup_local_replica import BUILDER, materialize, read_lock, replica_source

ROOT = Path(__file__).resolve().parents[1]
DEFAULT = ROOT/'dist'
WRAPPER = 'xingluo-monsters-defense/'
MANIFEST = 'MANIFEST-PRIVATE.json'
LEDGER = '_portable/route-ledger.js'
LEGACY_ENTRY = 'qualified-game/revisions/r6/cloud-temporary-20108-cpu/ui.mjs'
# Temporary physical names. Dependency-relative imports inside the still-unmoved
# world and companions continue to resolve. This is not the target architecture.
PROJECTION = {
    'src/rendering/continuous-world/layer.mjs':
        'qualified-game/revisions/r6/cloud-temporary-20108-cpu/site-layer.mjs',
    'src/rendering/effects/freeze/companion.js':
        'qualified-game/revisions/r6/stage1-2011-companion-probe/companion.js',
    'src/rendering/effects/freeze/observer.mjs':
        'qualified-game/revisions/r6/stage1-2011-companion-probe/observer.mjs',
    'src/rendering/effects/freeze/event-ledger.mjs':
        'qualified-game/revisions/r6/stage78-frost-source-witness/frost-ledger.mjs',
}

def source_projection(overlay, work):
    # Use authored source + exact input assets only; never download or open the
    # published Alpha playable ZIP. The retained alpha builder is an adapter to
    # the remaining historical route descriptors, not a compiled input.
    tree = work/'inputs'
    materialize(replica_source(), overlay, tree)
    script = tree/BUILDER
    spec = spec_from_file_location('transitional_product_inputs', script)
    builder = module_from_spec(spec)
    sys.path.insert(0, str(script.parent))
    try:
        spec.loader.exec_module(builder)
        return {p.removeprefix(WRAPPER): b for p, b in builder.assemble().items()}
    finally:
        sys.path.pop(0)

def game_files(inherited):
    files = dict(inherited)
    files.pop(MANIFEST)
    files.pop('README.zh-CN.txt')
    routes, workers = ledger(files[LEDGER].decode())
    del files[LEGACY_ENTRY]
    del routes['/'+LEGACY_ENTRY]
    for src, dst in PROJECTION.items():
        data = (ROOT/src).read_bytes()
        files[dst] = data
        routes['/'+dst] = sig(data)
    for path, data in links(files):
        files[path] = data
        routes['/'+path] = sig(data)
    for path in (f'{SHARED}/{ACTOR}', f'{SHARED}/{CLOCK}', 'index.html', 'src/app/game.mjs', 'src/rendering/continuous-world/frame-front.mjs',
                 'src/rendering/continuous-world/stage-pixels.mjs', 'src/rendering/continuous-world/front.css'):
        files[path] = (ROOT/path).read_bytes()
        if path != 'index.html':
            routes['/'+path] = sig(files[path])
    compact = lambda v: json.dumps(v, ensure_ascii=False, sort_keys=True, separators=(',',':'))
    files[LEDGER] = (
        f'globalThis.__starfallRouteLedger=Object.freeze({compact(routes)});\n'
        f'globalThis.__starfallWorkers=Object.freeze({compact(workers)});\n'
    ).encode()
    for route, row in routes.items():
        from urllib.parse import unquote
        disk = unquote(row[2] if len(row) == 3 else route)[1:]
        if disk not in files or sig(files[disk]) != row[:2]:
            raise ValueError(f'Invalid runtime route: {route}')
    return files

def build(overlay, output):
    if output.exists() or output.is_symlink():
        raise ValueError('Choose a new output directory; existing builds are not overwritten')
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.starfall-build-', dir=output.parent) as tmp:
        work = Path(tmp)
        blob = overlay if overlay is not None else download_input(read_lock()['inputs'])
        files = game_files(source_projection(blob, work))
        ready = work/'static'
        for path, data in files.items():
            dest = ready/path
            dest.parent.mkdir(parents=True, exist_ok=True)
            with dest.open('xb') as f:
                f.write(data)
        if output.exists() or output.is_symlink():
            raise ValueError('Output appeared during build; refusing to overwrite')
        ready.rename(output)
    return len(files)

def serve(root, port, prefix):
    from dev import static_routes
    from urllib.parse import quote
    if (not prefix.startswith('/') or not prefix.endswith('/') or
        any(p in ('.','..') for p in prefix.split('/')) or
        quote(prefix, safe='/-_.') != prefix or '//' in prefix):
        raise ValueError('Use a canonical ASCII mount, e.g. /qa/build/')
    if not (root/'index.html').is_file() or any(x.is_symlink() for x in root.rglob('*')):
        raise ValueError('Expected a built static directory, without symlinks')
    paths = {WRAPPER+p.relative_to(root).as_posix(): p.read_bytes()
             for p in root.rglob('*') if p.is_file()}
    with server(static_routes(paths, prefix), port) as http:
        print(f'http://127.0.0.1:{http.server_port}{prefix}', flush=True)
        http.serve_forever()

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('mode', choices=('dev','test','build','preview'))
    p.add_argument('--inputs', type=Path, default=os.environ.get('STARFALL_INPUTS'))
    p.add_argument('--out', type=Path, default=DEFAULT)
    p.add_argument('--port', type=int, default=8000)
    p.add_argument('--prefix', default='/')
    a = p.parse_args()
    if a.mode == 'test':
        for args in ([sys.executable,'-m','unittest','discover','-s','tests'],
                     ['node','--test','tests/chooser-gesture.test.mjs','tests/frame-front.test.mjs'],
                     [sys.executable,'scripts/test_public_source.py']):
            subprocess.run(args, cwd=ROOT, check=True)
    elif a.mode == 'build':
        print(f'{build(a.inputs, a.out)} files built from current source and pinned inputs')
    elif a.mode == 'dev':
        with tempfile.TemporaryDirectory(prefix='starfall-product-dev-') as tmp:
            root = Path(tmp)/'static'
            build(a.inputs, root)
            serve(root, a.port, a.prefix)
    else:
        serve(a.out, a.port, a.prefix)

if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, subprocess.CalledProcessError) as e:
        raise SystemExit(str(e))

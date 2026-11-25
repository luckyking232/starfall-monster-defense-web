"""Required byte invariants for the source-built product; not a full rule replay."""
import sys
from pathlib import Path

def compare(before, after):
    mandatory = ['_portable/authority.js', 'qualified-game/revisions/r6/worker.js',
                 '_portable/progress-store.mjs', 'core-worker/inputs/vendor/index.js']
    mandatory += sorted(p.relative_to(before).as_posix() for p in before.rglob('*')
                        if p.suffix in {'.lua', '.wasm'})
    if len(mandatory) != len(set(mandatory)) or not any(p.endswith('.wasm') for p in mandatory):
        raise ValueError('No complete original-rules baseline was supplied')
    for p in mandatory:
        if (before/p).read_bytes() != (after/p).read_bytes():
            raise ValueError(f'Authority, vendor, or persistence bytes changed: {p}')
    return len(mandatory)

if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('Usage: product-runtime-baseline.py BEFORE AFTER')
    print(f'{compare(*(Path(s) for s in sys.argv[1:]))} invariant files verified')

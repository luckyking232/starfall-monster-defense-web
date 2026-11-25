"""Compare the rule and vendor bytes against the sealed QA baseline."""
import sys
from pathlib import Path
from urllib.parse import quote, unquote

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from audit_runtime import ledger, sig
from product_resources import physical_name

def compare(before, after):
    mandatory = ['_portable/authority.js', 'qualified-game/revisions/r6/worker.js',
                 'core-worker/inputs/vendor/index.js']
    mandatory += sorted(p.relative_to(before).as_posix() for p in before.rglob('*')
                        if p.suffix in {'.lua', '.wasm'})
    if len(mandatory) != len(set(mandatory)) or not any(p.endswith('.wasm') for p in mandatory):
        raise ValueError('No complete original-rules baseline was supplied')
    new_routes,_=ledger((after/'_portable/route-ledger.js').read_text())
    for p in mandatory:
        data=(before/p).read_bytes()
        dest=physical_name(p)
        if data != (after/dest).read_bytes():
            raise ValueError(f'Authority or vendor bytes changed: {p}')
        if dest != p:
            key='/'+quote(p,safe='/')
            row=new_routes[key]
            if row[:2]!=sig(data) or len(row)!=3 or unquote(row[2])!='/'+dest or (after/p).exists():
                raise ValueError(f'Not a unique relocated resource with its original logical path: {p}')
    return len(mandatory),sum(p!=physical_name(p) for p in mandatory)

if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('Usage: product-runtime-baseline.py BEFORE AFTER')
    checks,moved=compare(*(Path(s) for s in sys.argv[1:]))
    print(f'{checks} invariant files verified; {moved} relocated with logical IDs intact')

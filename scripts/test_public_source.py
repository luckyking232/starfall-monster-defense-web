"""Run the audited stand-alone module tests without any external inputs."""
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
source = root / 'packages' / 'replica-runtime'
allowed = set((source / 'PUBLIC-SOURCE-LIST.txt').read_text(encoding='utf-8').splitlines())
actual = set(f.relative_to(source).as_posix() for f in source.rglob('*') if f.is_file())
assert actual == allowed | {'README.md','PUBLIC-SOURCE-LIST.txt'}, ('Unexpected or missing source files', actual.symmetric_difference(allowed))
for f in allowed:
    p=source/f
    assert not p.is_symlink() and p.suffix in {'.js','.mjs','.lua','.py','.css','.html','.json'}, f
integration = {'qualified-game/revisions/r6/cloud-temporary-20108-cpu/site.test.mjs'}
tests = sorted(f for f in allowed if f.endswith('.test.mjs') and f not in integration)
assert tests, 'No standalone tests'
subprocess.run(['node','--test',*tests], cwd=source, check=True)

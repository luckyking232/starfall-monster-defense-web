"""Read-only inventory for the pinned replica, not a downloader or deployment tool."""
import argparse
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path, PurePosixPath
import re
import sys


PARENT = 'qualified-game/revisions/r6/cloud-temporary-20108-cpu'
PARENT_SHA = '53d490b495da6358d9ebace0460f319ae6874dfe10ef73eadec486948e8f50d9'
WITNESSES = {
    'stage78-frost-source-witness': ('573b10647da3cada73bf911c5c91db3425b8141e606f27c9999d7c3386ebeb7e',
        ('observer.mjs', 'frost-ledger.mjs', 'companion.js', 'frost-tap.lua')),
    'stage9-fx-only-summons': ('0f91d19c0a2bcd313ccbcaba31c4aad65466fd3930bbfa199bb40883e38f37e1',
        ('observer.mjs', 'death.mjs', 'ledger.mjs', 'companion.js', 'source-tap.lua')),
    'stage10-fx-only-summons': ('0c7d118c5c0a7e5417092ae081370300bcdc72c98cbec371feaf2678bb77b3ea',
        ('observer.mjs', 'death.mjs', 'ledger.mjs', 'companion.js', 'source-tap.lua')),
}
REV = 'qualified-game/revisions/r6'
TOOLS = ('taptap-portable/plan.py', 'taptap-portable/runtime-core.js')
LAYOUT_ONLY = ('.json', '.jsonl', '.png', '.otf', '.wasm')
PIN = re.compile(r'[a-f0-9]{64}\Z')


def checked_path(root, rel):
    p = PurePosixPath(rel)
    if (not p.parts or p.is_absolute() or p.as_posix() != rel or
            any(x in ('..', '.') or ':' in x for x in p.parts) or
            any(ord(c) < 32 or c in '\\?#' for c in rel)):
        raise ValueError('Invalid repository-relative path')
    result = root / rel
    for q in (root.joinpath(*p.parts[:i]) for i in range(1, len(p.parts) + 1)):
        if q.is_symlink():
            raise ValueError(f'Symlink is not accepted: {rel}')
    return result


def digest(path):
    h = sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def inputs(local, progress):
    def read(rel, pin):
        f = checked_path(local, rel)
        if not f.is_file():
            raise ValueError(f'Recipe required before exact enumeration: {rel}')
        x = f.read_bytes()
        if sha256(x).hexdigest() != pin:
            raise ValueError(f'Recipe SHA-256 mismatch: {rel}')
        return json.loads(x)
    paths = {}

    def add(path, pin):
        checked_path(local, path)
        if not isinstance(pin, str) or not PIN.fullmatch(pin):
            raise ValueError(f'Invalid SHA-256: {path}')
        if path in paths and paths[path] != pin:
            raise ValueError(f'Conflicting SHA-256: {path}')
        paths[path] = pin

    p = PARENT + '/VERIFICATION.json'
    m = read(p, PARENT_SHA)
    add(p, PARENT_SHA)
    p = PARENT + '/routes.json'
    pin = m['files']['routes.json']
    routes = read(p, pin)
    add(p, pin)
    for k, m in routes.items():
        if ((not k.endswith('/') or k == '/qualified-game/') and
                '/qa-' not in k and '/cloud-stage2-qa/' not in k):
            add(m['file'], m['sha256'])
    for name, (pin, parts) in list(WITNESSES.items())[:(3 if progress else 1)]:
        prefix = f'{REV}/{name}'
        p = prefix + '/VERIFICATION.json'
        m = read(p, pin)
        add(p, pin)
        for n in parts:
            add(prefix + '/' + n, m['files'][n]['sha256'])
    return paths


def category(rel):
    if rel.startswith('core-worker/inputs/vendor/'):
        return 'external-runtime'
    if (rel.startswith(('core-worker/inputs/lua/', 'core-worker/combat-prefix/inputs/',
                       'core-worker/skill-choice/inputs/')) and rel.endswith('.lua')):
        return ('mixed-source-private-review' if rel.endswith(
            ('/native-prefabs.lua', '/source-derived-helpers.lua', '/choice-original-helpers.lua'))
            else 'original-lua-local-input')
    if rel.endswith(LAYOUT_ONLY):
        return 'local-data-asset-or-receipt'
    # Some Lua observers and JS tables mix original constants and authored glue.
    # Extensions do not establish provenance. Never treat this class as safe to publish.
    if rel.endswith('.lua') or 'original' in rel.lower():
        return 'mixed-source-private-review'
    return 'unpublished-code-review-required'


def report(public, local, wanted, progress):
    rows = []
    extra = TOOLS + (('taptap-portable/progress/store.mjs',
                      'taptap-portable/progress/changes.py') if progress else ())
    for rel, pin in sorted({**wanted, **{k: None for k in extra}}.items()):
        live, overlay = checked_path(public, rel), checked_path(local, rel)
        av = [kind for kind, file in (('public', live), ('local', overlay))
              if file.is_file() and (pin is None or digest(file) == pin)]
        state = av[0] if av else (
            'mismatch' if live.is_file() or overlay.is_file() else 'missing')
        rows.append(dict(path=rel, public=live.is_file(), state=state,
                         kind='build-tool' if pin is None else category(rel)))
    return rows


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--local', required=True, type=Path,
                   help='existing owner-controlled local replica tree with the pinned recipe')
    p.add_argument('--public-source', type=Path,
                   default=Path(__file__).resolve().parents[1] / 'source')
    p.add_argument('--progress', action='store_true')
    p.add_argument('--summary', action='store_true', help='do not print path names')
    a = p.parse_args()
    try:
        local, public = a.local.resolve(strict=True), a.public_source.resolve(strict=True)
        if not local.is_dir() or not public.is_dir() or local == public:
            raise ValueError('Local and public roots must be separate existing directories')
        rows = report(public, local, inputs(local, a.progress), a.progress)
    except (ValueError, KeyError, OSError, TypeError) as e:
        print(f'Cannot audit local inputs: {e}', file=sys.stderr)
        return 2
    summary = {'total': len(rows), 'states': Counter(r['state'] for r in rows),
               'outsidePublicByProvenanceReview': Counter(r['kind'] for r in rows if r['state'] != 'public')}
    # The path list may itself expose private dependency names; it is local diagnostics only.
    print(json.dumps(summary if a.summary else {'summary': summary, 'paths': rows},
                     indent=2, ensure_ascii=False))
    return 1 if any(r['state'] in ('mismatch', 'missing') for r in rows) else 0


if __name__ == '__main__':
    sys.exit(main())

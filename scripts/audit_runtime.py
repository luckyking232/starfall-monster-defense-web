"""Read-only audit of an exact extracted release or QA runtime (Python 3.10+)."""
from collections import Counter, defaultdict, deque
from hashlib import sha256
from html.parser import HTMLParser
import argparse
import json
from pathlib import Path
import posixpath
import re
from urllib.parse import quote, unquote, urlsplit

MODULE = re.compile(r'''(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)['"]([^'"\n]+)['"]''')
CLASSIC = re.compile(r"\bimportScripts\(([^\n;]+)\)")
STRING = re.compile(r"""['"]([^'"\n]+)['"]""")
CSS = re.compile(r"""url\(\s*['"]?([^'"()\s]+)""")
ROOT_REF = re.compile(r"""['"](/[^'"\n]+)['"]""")
CALL = re.compile(r"""\b(?:fetch|importURL|importScripts|import|require|load)\s*\(|\bnew\s+(?:URL|Worker)\s*\(""")
TEXT = {'.mjs', '.js', '.html', '.css', '.lua', '.json', '.jsonl', '.txt'}
CODE = {'.mjs', '.js', '.html', '.css', '.lua'}

def sig(data):
    return [len(data), sha256(data).hexdigest()]

class HTML(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = []
    def handle_starttag(self, tag, attrs):
        self.paths.extend(v for k, v in attrs if v and
                          (k == 'src' or (tag == 'link' and k == 'href')))

def ledger(data):
    decoder = json.JSONDecoder()
    return tuple(decoder.raw_decode(data.split(f'{name}=Object.freeze(', 1)[1])[0]
                 for name in ('__starfallRouteLedger', '__starfallWorkers'))

def audit(base, *, inventory=None):
    if base.is_symlink() or any(p.is_symlink() for p in base.rglob('*')):
        raise ValueError('Audit only a regular-file tree')
    files = {'/'+p.relative_to(base).as_posix(): p.read_bytes()
             for p in sorted(base.rglob('*')) if p.is_file()}
    manifest = json.loads(files['/MANIFEST-PRIVATE.json'])
    if set(files) != {'/MANIFEST-PRIVATE.json', *('/'+p for p in manifest['rawFiles'])}:
        raise ValueError('Manifest inventory mismatch')
    for p, row in manifest['rawFiles'].items():
        if sig(files['/'+p]) != row:
            raise ValueError(f'Manifest hash mismatch: {p}')
    routes, workers = ledger(files['/_portable/route-ledger.js'].decode())
    for path, row in routes.items():
        target = unquote(row[2] if len(row) == 3 else path)
        if target not in files or sig(files[target]) != row[:2]:
            raise ValueError(f'Unverified ledger route: {path}')
    if len(workers) != len(set(workers)) or not set(workers) <= files.keys():
        raise ValueError('Unexpected classic Worker inventory')
    resolve = lambda route: unquote(routes[route][2] if len(routes.get(route, [])) == 3 else route)
    edges, computed, unresolved, labels = set(), {}, set(), {}
    def reference(src, raw, kind):
        u = urlsplit(raw)
        if u.scheme or u.netloc or raw.startswith('#'):
            return
        if not raw.startswith(('.', '/')) and kind in ('module', 'classic'):
            return
        path = posixpath.normpath(posixpath.join(posixpath.dirname(src), unquote(u.path)))
        if path in files or quote(path, safe='/.-_') in routes:
            edges.add((src, resolve(quote(path, safe='/.-_')), kind))
        else:
            unresolved.add((src, raw, kind))
    indexes = defaultdict(list)
    for p, b in files.items():
        indexes[sig(b)[1]].append(p)
        ext = Path(p).suffix
        if ext not in CODE or p in ('/_portable/route-ledger.js', '/core-worker/inputs/vendor/index.js'):
            continue
        source = b.decode()
        if ext == '.html':
            html = HTML()
            html.feed(source)
            for value in html.paths:
                reference(p, value, 'html')
        if ext == '.css':
            for value in CSS.findall(source):
                reference(p, value, 'css')
        if ext in ('.js', '.mjs'):
            for value in MODULE.findall(source):
                reference(p, value, 'module')
            for match in CLASSIC.findall(source):
                for value in STRING.findall(match):
                    reference(p, value, 'classic')
        for match in ROOT_REF.finditer(source):
            raw = match[1]
            if raw in routes:
                edges.add((p, resolve(raw), 'ledger-literal'))
            elif raw.startswith(('/Assets/', '/Bg/', '/DPS1/', '/DPSProgressBar/')):
                labels.setdefault(p, set()).add(raw)
        site_lines = [i for i, line in enumerate(source.splitlines(), 1) if CALL.search(line)]
        if site_lines:
            computed[p] = site_lines
    graph = defaultdict(set)
    for site, target, _ in edges:
        graph[site].add(target)
    queue, visited = deque(['/index.html']), set()
    while queue:
        p = queue.popleft()
        if p not in visited:
            visited.add(p)
            queue.extend(graph[p]-visited)
    # Required candidates, not a proof of reachability: computed URL, Worker,
    # Lua require and content branches can address routes without a quoted literal.
    return {
        'schema': 'starfall.runtime-audit/1',
        'manifestSha256': sig(files['/MANIFEST-PRIVATE.json'])[1],
        'physicalFiles': len(files), 'physicalBytes': sum(map(len, files.values())),
        'typeCounts': dict(sorted(Counter(Path(p).suffix for p in files).items())),
        'physicalInventory': {p: sig(b) for p, b in files.items()},
        'workerEntries': workers, 'ledger': routes,
        'literalEdges': sorted(edges), 'literalClosureFromEntry': sorted(visited),
        'notInLiteralClosure': sorted(set(files)-visited),
        'lexicalNonFileReferences': sorted(unresolved),
        'originalObjectLabels': {p: sorted(s) for p, s in labels.items()},
        'computedCallsiteLines': computed,
        'exactDuplicatePhysicalGroups': [a for a in indexes.values() if len(a)>1],
        'gitInventory': inventory or {},
    }

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('tree', type=Path)
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--repo', type=Path)
    args = p.parse_args()
    inv = {}
    if args.repo:
        import subprocess
        paths = subprocess.check_output(['git','-C',str(args.repo),'ls-files','-z']).decode().split('\0')[:-1]
        groups = defaultdict(list)
        for name in paths:
            groups[sha256((args.repo/name).read_bytes()).hexdigest()].append(name)
        inv = {'trackedFiles': len(paths), 'exactDuplicateGroups': [g for g in groups.values() if len(g)>1]}
    report = audit(args.tree, inventory=inv)
    with args.out.open('x', encoding='utf-8') as out:
        json.dump(report, out, indent=2, ensure_ascii=False, sort_keys=True)
        out.write('\n')
if __name__ == '__main__':
    main()

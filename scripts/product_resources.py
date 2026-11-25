"""Give verified rule data and Wasmoon a physical home without changing logical IDs.

The classic Worker loads these resources through pinned byte fetches. It compiles
Lua from bytes and bootstraps Wasmoon from its verified JS blob; neither loads a
native relative module from these legacy locations. The rule request protocol
and the published release builders are not changed.
"""
from urllib.parse import quote, unquote

VENDOR = {
    'core-worker/inputs/vendor/index.js': 'vendor/wasmoon/index.js',
    'core-worker/inputs/vendor/glue.wasm': 'vendor/wasmoon/glue.wasm',
}
LUA = {
    'core-worker/inputs/lua/': 'assets/lua/battle/',
    'core-worker/combat-prefix/inputs/': 'assets/lua/combat/',
    'core-worker/skill-choice/inputs/': 'assets/lua/choice/',
}

def physical_name(original):
    if original in VENDOR:
        return VENDOR[original]
    if original.endswith('.lua'):
        for src, dst in LUA.items():
            if original.startswith(src):
                return dst + original.removeprefix(src)
    return original

def move_pinned_resources(files, routes, workers, signature):
    moves = {k: physical_name(k) for k in files if physical_name(k) != k}
    if set(moves.values()) & files.keys() or len(set(moves.values())) != len(moves):
        raise ValueError('Physical asset path collision')
    for src, dest in sorted(moves.items()):
        old, new = ('/'+quote(p,safe='/') for p in (src,dest))
        data = files[src]
        mark = signature(data)
        if old in workers or routes.get(old) != mark or new in routes:
            raise ValueError(f'Expected a verified resource, not a Worker entry or alias: {src}')
        for key,row in list(routes.items()):
            if key==old or len(row)==3 and unquote(row[2])=='/'+src:
                if row[:2]!=mark:
                    raise ValueError(f'Resource alias does not match its canonical bytes: {key}')
                routes[key] = [*mark,new]
        routes[new]=mark
        files[dest]=files.pop(src)
    return moves

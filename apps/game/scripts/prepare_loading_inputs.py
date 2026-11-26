"""Recover Loading_fui and the pinned FX dependencies from the original catalogs."""
from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path
from urllib.request import ProxyHandler, build_opener

import UnityPy
from native.bundle import load_bundle

VERSION = '134395529309427262'
CATALOGS = {
    'other_a47f95aad5f05272c41a9d1c3ff5f095.json': 'fairygui_ui_loading_fui_bytes.bundle',
    'arts_406a6a56e93142b5103789306174c8e6.json': 'effects_prefab_ui_prefab_loading_fx_ui_loading_prefab.bundle',
}
APP = Path(__file__).resolve().parents[1]


def catalog_entries(source, with_effects):
    version = json.loads((source / 'version-catalog.json').read_bytes())
    if str(version['timestamp']) != VERSION:
        raise ValueError('Unexpected asset version')
    pinned = {entry['name'].lower(): entry['hash'] for entry in version['data']}
    selected = {}
    for filename, asset in CATALOGS.items():
        if filename.startswith('arts') and not with_effects:
            continue
        path = source / 'manifests' / filename
        expected = path.stem.split('_')[-1]
        if pinned.get(path.stem.split('_')[0]) != expected or hashlib.md5(path.read_bytes()).hexdigest() != expected:
            raise ValueError(f'Catalog MD5 mismatch: {path}')
        env = load_bundle(path)
        catalog, = (o.read_typetree() for o in env.objects if o.type.name == 'MonoBehaviour')
        bundles = catalog['bundles']
        root, = (b for b in bundles if b['name'] == asset)
        selected[root['hash']] = root
        for index in root['deps']:
            entry = bundles[index]
            selected[entry['hash']] = entry
    return selected


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--with-effects', action='store_true')
    parser.add_argument('--fetch', action='store_true', help='Retrieve missing digest-pinned bundles from the domestic CDN')
    args = parser.parse_args()
    entries = catalog_entries(args.source, args.with_effects)
    original = args.source / 'assets' / 'bundles' / VERSION / 'original'
    direct = build_opener(ProxyHandler({}))
    report = []
    loading_fui = None
    for digest, entry in entries.items():
        name = digest + '.bundle'
        cached = args.cache / name
        path = cached if cached.exists() else original / name
        if path.exists():
            data = path.read_bytes()
        elif args.fetch:
            with direct.open('https://elpis.17995cdn.com/Android/Bundles/' + name, timeout=30) as response:
                data = response.read(entry['size'] + 1)
        else:
            raise FileNotFoundError(f'Missing {name} ({entry["name"]}). Provide it in --cache or use --fetch.')
        if len(data) != entry['size'] or hashlib.md5(data).hexdigest() != digest:
            raise ValueError(f'Bundle size or MD5 mismatch: {name}')
        if not path.exists():
            args.cache.mkdir(parents=True, exist_ok=True)
            path = cached
            path.write_bytes(data)
        report.append(dict(bundle=entry['name'], path=str(path), md5=digest, bytes=len(data)))
        if entry['name'] == 'fairygui_ui_loading_fui_bytes.bundle':
            env = UnityPy.load(io.BytesIO(data[data.index(b'UnityFS'):]))
            asset, = (o.read() for o in env.objects if o.type.name == 'TextAsset')
            loading_fui = asset.m_Script.encode('utf-8', errors='surrogateescape')
    if not loading_fui or hashlib.sha256(loading_fui).hexdigest() != 'f29218c53da4e26605d55fb1c32e0b13b1d2de37a978ab3bcb79f371a4e0a645':
        raise ValueError('Loading_fui SHA-256 mismatch')
    out = APP / 'local-inputs' / 'fgui' / 'Loading_fui.bytes'
    out.parent.mkdir(parents=True, exist_ok=True)
    if not out.exists() or out.read_bytes() != loading_fui:
        out.write_bytes(loading_fui)
    args.cache.mkdir(parents=True, exist_ok=True)
    (args.cache / 'loading-inputs.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(f'Verified {len(report)} bundles, {sum(i["bytes"] for i in report)} bytes; {len(loading_fui)} FGUI bytes.')


if __name__ == '__main__':
    main()

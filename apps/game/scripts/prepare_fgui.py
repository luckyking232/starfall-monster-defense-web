"""Decode the original FairyGUI packages used by the monster-defense replica.

Reads the original ``*_fui.bytes`` (FGUI version 6, big endian) from the
verified research export, decodes package index / string table / package items
/ atlas sprites and full component trees following the official FairyGUI-unity
``UIPackage.LoadPackage`` format, then writes one ``<package>.json`` per
package plus byte-exact copies of the original fui bytes and every referenced
atlas PNG into ``public/assets/fgui/`` (atomic writes, no re-encoding).

Usage:
    python scripts/prepare_fgui.py --source <research-root> [--loading-fui <bytes>] [--out <dir>]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import struct
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.fgui.decode import FORMAT_REFERENCE_URL, SCHEMA, build_package_document, resolve_cross_package_names
from scripts.fgui.package import Package, load_package

APP = Path(__file__).resolve().parents[1]
DEFAULT_OUT = APP / 'public' / 'assets' / 'fgui'
UI_SUBDIR = Path('assets') / 'exported' / 'assets' / 'fairygui' / 'ui'
LOADING_FUI = APP / 'local-inputs' / 'fgui' / 'Loading_fui.bytes'
LOADING_SHA256 = 'f29218c53da4e26605d55fb1c32e0b13b1d2de37a978ab3bcb79f371a4e0a645'
LOADING_BUNDLE_MD5 = '7d5edc369c98ff1aaf7cf9c2438fad6e'

# The two activity packages drive the replicated windows; CommonResource is a
# declared dependency of both (BackGround / PopupBg children resolve there).
PACKAGES = ['ActivityDungeon1017', 'ActivityDungeon1017Battle', 'CommonResource', 'Loading']

MANIFEST_SCHEMA = 'starfall-fgui-manifest/1'


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def png_size(data: bytes) -> tuple[int, int]:
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('not a PNG')
    return struct.unpack('>II', data[16:24])


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, tmp_name = tempfile.mkstemp(prefix=path.name + '.', dir=path.parent)
    try:
        with os.fdopen(handle, 'wb') as tmp:
            tmp.write(data)
        os.replace(tmp_name, path)
    except BaseException:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def dump_json(document: dict) -> bytes:
    return (json.dumps(document, ensure_ascii=False, sort_keys=True, indent=1) + '\n').encode('utf-8')


def generate(source_root: Path, out_dir: Path, loading_fui: Path = LOADING_FUI) -> dict:
    source_root = Path(source_root).resolve(strict=True)
    out_dir = Path(out_dir)
    ui_dir = source_root / UI_SUBDIR

    documents: dict[str, dict] = {}
    packages: dict[str, Package] = {}
    manifest_packages: list[dict] = []
    staged: dict[str, bytes] = {}  # file name -> bytes to publish

    for name in PACKAGES:
        fui_name = f'{name}_fui.bytes'
        fui_path = loading_fui if name == 'Loading' else ui_dir / fui_name
        fui_bytes = fui_path.read_bytes()
        digest = sha256_bytes(fui_bytes)
        if name == 'Loading' and digest != LOADING_SHA256:
            raise ValueError(f'Loading FGUI SHA-256 mismatch: {fui_path}')
        package = load_package(fui_path)
        document = build_package_document(package, fui_name, digest, len(fui_bytes))
        if name == 'Loading':
            document['source']['container'] = {
                'file': f'{LOADING_BUNDLE_MD5}.bundle',
                'md5': LOADING_BUNDLE_MD5,
                'textAsset': 'Loading_fui',
                'pathId': '-4728814527088002609',
            }
        documents[name] = document
        packages[name] = package
        staged[fui_name] = fui_bytes

    resolve_cross_package_names(documents)

    for name in PACKAGES:
        document = documents[name]
        package = packages[name]
        atlases: dict[str, dict] = {}
        referenced = {item['sprite']['atlasId'] for item in document['items'].values() if 'sprite' in item}
        for atlas_id in sorted(referenced):
            item = package.items_by_id[atlas_id]
            resolved = package.asset_prefix + (item.file or '')
            data = (ui_dir / resolved).read_bytes()
            width, height = png_size(data)
            atlases[atlas_id] = {
                'file': resolved,
                'sourceFile': item.file,
                'sha256': sha256_bytes(data),
                'width': width,
                'height': height,
            }
            staged[resolved] = data
        document['atlases'] = atlases

    for name in PACKAGES:
        json_bytes = dump_json(documents[name])
        staged[f'{name}.json'] = json_bytes
        manifest_packages.append({
            'name': name,
            'packageId': documents[name]['package']['id'],
            'json': f'{name}.json',
            'jsonSha256': sha256_bytes(json_bytes),
            'fui': f'{name}_fui.bytes',
            'fuiSha256': documents[name]['source']['sha256'],
            'atlases': [
                {'file': atlas['file'], 'sha256': atlas['sha256']}
                for atlas in sorted(documents[name]['atlases'].values(), key=lambda a: a['file'])
            ],
            'dependencies': documents[name]['package']['dependencies'],
        })

    manifest = {
        'schema': MANIFEST_SCHEMA,
        'packageSchema': SCHEMA,
        'generator': 'apps/game/scripts/prepare_fgui.py',
        'source': {
            'root': 'server-exports/monster-defense-research-20261125',
            'uiDir': str(UI_SUBDIR).replace(os.sep, '/'),
            'format': {
                'magic': 'FGUI',
                'version': 6,
                'endianness': 'big',
                'reference': 'FairyGUI-unity UIPackage.LoadPackage (master)',
                'referenceUrl': FORMAT_REFERENCE_URL,
            },
        },
        'packages': manifest_packages,
    }
    staged['fgui-manifest.json'] = dump_json(manifest)

    out_dir.mkdir(parents=True, exist_ok=True)
    for file_name, data in sorted(staged.items()):
        atomic_write(out_dir / file_name, data)
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True, help='Verified monster-defense research directory')
    parser.add_argument('--loading-fui', type=Path, default=LOADING_FUI, help='Original verified Loading_fui TextAsset bytes')
    parser.add_argument('--out', type=Path, default=DEFAULT_OUT, help='Output directory (default: public/assets/fgui)')
    args = parser.parse_args()
    manifest = generate(args.source, args.out, args.loading_fui)
    for package in manifest['packages']:
        print(f"{package['name']}: {package['json']} + {len(package['atlases'])} atlas file(s)")


if __name__ == '__main__':
    main()

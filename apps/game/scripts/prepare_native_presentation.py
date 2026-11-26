"""Export the original native Unity presentation data for the monster-defense replica.

Reads the sixteen original prefab bundles (12 animated units, the zhalan wall
and 3 maps) of asset version 134395529309427262 from the verified research
directory, decodes their complete object graph -- GameObject/Transform trees,
SpriteRenderer references, Sprite rect/pivot/PPU, AnimatorController states and
the compiled AnimationClip sprite curves (StreamedClip/DenseClip payloads) --
and writes one JSON document per prefab plus byte-exact original sprite frames
into ``public/assets/native/``. Every value comes from the bundles or the
original AssetStudio PNG export; bundle md5/sha256 provenance is recorded in
``manifest.json``. Clips without curve data are reported as explicitly empty,
never synthesized.

Usage:
    python scripts/prepare_native_presentation.py --source <research-root> [--out <dir>]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.native.bundle import load_bundle  # noqa: E402
from scripts.native.document import build_cab_index, build_document, sha256_bytes  # noqa: E402

APP = Path(__file__).resolve().parents[1]
DEFAULT_OUT = APP / 'public' / 'assets' / 'native'

ASSET_VERSION = '134395529309427262'
MANIFEST_SCHEMA = 'starfall-native-manifest/1'
HEADER_OFFSET = 32

# key -> (original bundle md5, kind). Keys are the original prefab file stems.
UNITS = {
    'minigamespine_20010_pixel': 'c6a8f72b80fdad185c88326d0da943ce',
    'minigamespine_20011_pixel': 'a1dd0a7ea46319138e6c63a7853c07d3',
    'minigamespine_20108_pixel': '84c63f1a28dcc746b573a764fb661c40',
    'minigamespine_20302_pixel': '41c99955eaf77c3a14f46e07c4cff168',
    'minigamespine_20306_pixel': '21a2c8ff7c36d030ba0cd87133ca1726',
    'minigamespine_20411_pixel': 'a042d4ecec90517e097896afaf6a2a0d',
    'minigamespine_20506_pixel': '0b7bc080b49cf84af10a63fdc066f4cd',
    'minigamespine_10000101_pixel': 'cb13a6e0b1c702ce3b364cc3c7ded074',
    'minigamespine_10000104_pixel': '2843322b24ca395a0f5423508a8aa16f',
    'minigamespine_10000118_pixel': '64dbe5bdd51ae888249eb2111e3d0575',
    'minigamespine_10000134_pixel': '5aa06e0049e335e7c26c88861c4c7d9a',
    'minigamespine_10000198_pixel': 'ec2728fe719e6898eb495aa4d60c2c07',
    'minigamespine_zhalan_pixel': '5d9887f19cdf925e93311026e38d59a9',
}
WALL = 'minigamespine_zhalan_pixel'
MAPS = {
    'minigame022_map1': '0553b6c60dc4a68e44c2ff16ad4692bc',
    'minigame022_map2': 'be94419ee51256c1cf06c416e47807c1',
    'minigame022_map3': '4112b4323c3bbb2ef13890ce5197ee45',
}


def dump_json(document: dict) -> bytes:
    return (json.dumps(document, ensure_ascii=False, sort_keys=True, indent=1) + '\n').encode('utf-8')


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_file() and path.read_bytes() == data:
        return
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


def generate(source_root: Path, out_dir: Path) -> dict:
    source_root = Path(source_root).resolve(strict=True)
    out_dir = Path(out_dir)
    bundles_dir = source_root / 'assets' / 'bundles' / ASSET_VERSION
    processed_dir = bundles_dir / 'processed'

    download_manifest_path = source_root / 'assets' / 'download-manifest.json'
    header_fix_path = source_root / 'assets' / 'header-fix-report.json'
    assets_map_path = source_root / 'assets' / 'map' / 'assets_map.json'
    download_manifest = json.loads(download_manifest_path.read_bytes().decode('utf-8'))
    header_fix = json.loads(header_fix_path.read_bytes().decode('utf-8'))
    if str(download_manifest.get('version')) != ASSET_VERSION:
        raise ValueError(f'download manifest version {download_manifest.get("version")} != {ASSET_VERSION}')
    by_hash = {item['hash']: item for item in download_manifest['files']}
    by_index = {item['manifest_index']: item for item in download_manifest['files']}
    offsets = {Path(item['source']).name: int(item['offset']) for item in header_fix['files']}

    wanted = {**{key: ('wall' if key == WALL else 'unit', md5) for key, md5 in UNITS.items()},
              **{key: ('map', md5) for key, md5 in MAPS.items()}}

    # resolve external references (materials live in sibling bundles)
    needed_cabs: set[str] = set()
    for key, (_kind, md5) in sorted(wanted.items()):
        env = load_bundle(processed_dir / f'{md5}.bundle')
        for obj in env.objects:
            for external in getattr(getattr(obj, 'assets_file', None), 'externals', ()) or ():
                name = str(getattr(external, 'name', '') or '')
                if name:
                    needed_cabs.add(name)
    cab_index = build_cab_index(processed_dir, needed_cabs)

    staged: dict[str, bytes] = {}
    staged_frames: dict[str, bytes] = {}
    prefab_entries: list[dict] = []
    bundle_usage: dict[str, list[str]] = {}
    gaps: list[str] = []

    for key, (kind, md5) in sorted(wanted.items()):
        bundle_info = by_hash.get(md5)
        if bundle_info is None:
            raise ValueError(f'{key}: bundle {md5} missing from download manifest')
        offset = offsets.get(f'{md5}.bundle')
        if offset != HEADER_OFFSET:
            raise ValueError(f'{key}: unexpected header offset {offset} for {md5}')
        dependencies = []
        for dep_index in bundle_info.get('deps', []):
            dep = by_index.get(dep_index)
            dependencies.append({
                'manifestIndex': dep_index,
                'name': dep['name'] if dep else '',
                'hash': dep['hash'] if dep else '',
            })
        document = build_document(key, kind, md5, source_root, bundle_info, offset,
                                  dependencies, cab_index, staged_frames)
        for diagnostic in document['diagnostics']:
            gaps.append(f'{key}: {diagnostic}')
        subdir = 'maps' if kind == 'map' else 'units'
        json_name = f'{subdir}/{key}.json'
        json_bytes = dump_json(document)
        staged[json_name] = json_bytes
        bundle_usage.setdefault(md5, []).append(key)
        states = [state['name'] for controller in document['objects']['animatorControllers']
                  for machine in controller['stateMachines'] for state in machine['states']]
        prefab_entries.append({
            'key': key,
            'kind': kind,
            'container': document['prefab']['container'],
            'rootGameObject': document['prefab']['rootGameObject'],
            'json': json_name,
            'jsonSha256': sha256_bytes(json_bytes),
            'bundle': md5,
            'sprites': len(document['objects']['sprites']),
            'clips': len(document['animations']['clips']),
            'states': states,
        })

    frames_index = {}
    for key, (kind, md5) in sorted(wanted.items()):
        document = json.loads(staged[('maps' if kind == 'map' else 'units') + f'/{key}.json'])
        for sprite in document['objects']['sprites']:
            frame = sprite['frame']
            if not frame['file']:
                continue
            frames_index[sprite['name']] = {
                'file': frame['file'],
                'sha256': frame['sha256'],
                'width': frame['width'],
                'height': frame['height'],
                'prefab': key,
                'sprite': sprite['pathId'],
            }

    bundles_manifest = {}
    for md5, users in sorted(bundle_usage.items()):
        info = by_hash[md5]
        original_bytes = (bundles_dir / 'original' / f'{md5}.bundle').read_bytes()
        processed_bytes = (processed_dir / f'{md5}.bundle').read_bytes()
        bundles_manifest[md5] = {
            'name': info['name'],
            'manifestIndex': info['manifest_index'],
            'category': info.get('category', ''),
            'originalMd5': hashlib.md5(original_bytes).hexdigest(),
            'originalSha256': sha256_bytes(original_bytes),
            'processedSha256': sha256_bytes(processed_bytes),
            'headerOffsetStripped': HEADER_OFFSET,
            'sizeBytes': len(original_bytes),
            'processedSizeBytes': len(processed_bytes),
            'usedBy': sorted(users),
        }

    manifest = {
        'schema': MANIFEST_SCHEMA,
        'prefabSchema': 'starfall-native-prefab/1',
        'generator': 'apps/game/scripts/prepare_native_presentation.py',
        'source': {
            'root': 'server-exports/monster-defense-research-20261125',
            'assetVersion': ASSET_VERSION,
            'bundlesDir': f'assets/bundles/{ASSET_VERSION}',
            'framesDir': 'assets/exported/assets/art/models/minigame022/prefab',
            'downloadManifestSha256': sha256_bytes(download_manifest_path.read_bytes()),
            'headerFixReportSha256': sha256_bytes(header_fix_path.read_bytes()),
            'assetsMapSha256': sha256_bytes(assets_map_path.read_bytes()),
        },
        'prefabs': sorted(prefab_entries, key=lambda entry: entry['key']),
        'frames': dict(sorted(frames_index.items())),
        'bundles': bundles_manifest,
        'gaps': sorted(gaps),
    }
    staged['manifest.json'] = dump_json(manifest)
    for file_name, data in sorted(staged_frames.items()):
        staged[file_name] = data

    out_dir.mkdir(parents=True, exist_ok=True)
    for file_name, data in sorted(staged.items()):
        atomic_write(out_dir / file_name, data)
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True, help='Verified monster-defense research directory')
    parser.add_argument('--out', type=Path, default=DEFAULT_OUT, help='Output directory (default: public/assets/native)')
    args = parser.parse_args()
    manifest = generate(args.source, args.out)
    for entry in manifest['prefabs']:
        print(f"{entry['key']}: {entry['json']} ({entry['sprites']} sprites, {entry['clips']} clips)")
    print(f"{len(manifest['frames'])} frames, {len(manifest['bundles'])} bundles, "
          f"{len(manifest['gaps'])} diagnostic note(s) -> {args.out}")


if __name__ == '__main__':
    main()

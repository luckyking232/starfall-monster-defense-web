"""Prepare original ActivityDungeon1017Battle FGUI sprites with provenance hashes.

Copies every sprite of the battle HUD package (82 images) from the verified
research export into public/assets/ui/battle/ and writes
public/assets/battle-ui.json mapping package sprite names to the copied files.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import struct
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
PACKAGE = 'ActivityDungeon1017Battle'


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def png_size(path: Path) -> tuple[int, int]:
    data = path.read_bytes()
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError(f'{path} is not a PNG')
    return struct.unpack('>II', data[16:24])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True, help='Verified monster-defense research directory')
    args = parser.parse_args()
    source = args.source.resolve(strict=True)
    sprites = source / 'assets' / 'fgui-sprites-by-id' / PACKAGE
    split = source / 'assets' / 'fgui-split' / f'{PACKAGE}_fui'
    destination = APP / 'public' / 'assets' / 'ui' / 'battle'
    destination.mkdir(parents=True, exist_ok=True)

    entries = json.loads((sprites / 'by-id-manifest.json').read_bytes().decode('utf-8'))
    records: dict[str, dict[str, object]] = {}
    by_name: dict[str, object] = {}
    for entry in sorted(entries, key=lambda item: item['sprite_id']):
        source_file = sprites / entry['output_file']
        if not source_file.is_file():
            raise FileNotFoundError(source_file)
        stored = png_size(source_file)
        expected = (entry['width'], entry['height'])
        if stored != expected and not (entry['rotated'] and stored == (entry['height'], entry['width'])):
            raise ValueError(f'{source_file} does not match by-id manifest dimensions')
        target_name = entry['output_file']
        target = destination / target_name
        if not target.exists() or sha(source_file) != sha(target):
            shutil.copyfile(source_file, target)
        records[target_name] = {
            'name': entry['sprite_name'],
            'spriteId': entry['sprite_id'],
            'bytes': target.stat().st_size,
            'sha256': sha(target),
            'width': entry['width'],
            'height': entry['height'],
            'rotated': bool(entry['rotated']),
            'source': str(source_file.relative_to(source)).replace('\\', '/'),
            'provenance': 'original-game-fgui',
        }
        if entry['sprite_name'] in by_name:
            existing = by_name[entry['sprite_name']]
            if isinstance(existing, str):
                by_name[entry['sprite_name']] = [existing, target_name]
            else:
                existing.append(target_name)
        else:
            by_name[entry['sprite_name']] = target_name

    # Cross-check: every uniquely named sprite must match the name-based split cut.
    counts: dict[str, int] = {}
    for entry in entries:
        counts[entry['sprite_name']] = counts.get(entry['sprite_name'], 0) + 1
    for entry in entries:
        if counts[entry['sprite_name']] != 1:
            continue
        split_file = split / f"{entry['sprite_name']}.png"
        if not split_file.is_file():
            raise FileNotFoundError(split_file)
        if sha(split_file) != sha(destination / entry['output_file']):
            raise ValueError(f'{split_file} disagrees with {entry["output_file"]}')

    manifest = {
        'schema': 'starfall.monster-defense.battle-ui/1',
        'package': PACKAGE,
        'sourceManifest': str((sprites / 'by-id-manifest.json').relative_to(source)).replace('\\', '/'),
        'files': records,
        'byName': by_name,
    }
    output = APP / 'public' / 'assets' / 'battle-ui.json'
    output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Prepared {len(records)} battle UI sprites in {destination}')


if __name__ == '__main__':
    main()

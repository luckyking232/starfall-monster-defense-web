"""Prepare original stage-one frames, effects and audio with provenance hashes."""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
FRAME_SETS = (
    'minigamespine_10000118_pixel',
    'minigamespine_10000134_pixel',
    'minigamespine_10000104_pixel',
    'minigamespine_10000101_pixel',
    'minigamespine_10000198_pixel',
    'battlespine_20010_pixel',
    'battlespine_20302_pixel',
)
EFFECTS = {
    'MiniGame022_bullet1.png',
    'Minigame022_guangqiu.png',
    'Minigame022_guangzhu.png',
    'Minigame022_ice.png',
    'Minigame022_liuxue.png',
}


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    args = parser.parse_args()
    source = args.source.resolve(strict=True)
    prefab = source / 'assets' / 'exported' / 'assets' / 'art' / 'models' / 'minigame022' / 'prefab'
    effects = source / 'assets' / 'exported' / 'assets' / 'art' / 'effects' / 'prefab' / 'ui_prefab' / 'minigame' / 'minigame022'
    destination = APP / 'public' / 'assets'
    records: dict[str, dict[str, object]] = {}

    def copy(source_file: Path, target_name: str, provenance: str) -> None:
        if not source_file.is_file():
            raise FileNotFoundError(source_file)
        target = destination / target_name
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists() or sha(source_file) != sha(target):
            shutil.copyfile(source_file, target)
        records[target_name] = {
            'bytes': target.stat().st_size,
            'sha256': sha(target),
            'source': str(source_file.relative_to(source)).replace('\\', '/'),
            'provenance': provenance,
        }

    for prefix in FRAME_SETS:
        for source_file in sorted(prefab.glob(f'{prefix}_*.png'), key=lambda path: int(path.stem.rsplit('_', 1)[1])):
            copy(source_file, f'units/{source_file.name}', 'original-frame')
    copy(prefab / 'minigamespine_zhalan_pixel.png', 'units/minigamespine_zhalan_pixel.png', 'original-wall')
    for name in EFFECTS:
        copy(effects / name, f'effects/{name}', 'original-effect')
    for path in sorted((source / 'assets' / 'audio' / 'minigame022').glob('*.wav')):
        copy(path, f'audio/{path.name}', 'original-sfx')
    for path in sorted((source / 'assets' / 'audio' / 'bgm_b02').glob('*.wav')):
        copy(path, f'audio/{path.name}', 'original-bgm')

    manifest = {'schema': 'starfall.monster-defense.battle-assets/1', 'files': records}
    (destination / 'battle-assets.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Prepared {len(records)} battle assets in {destination}')


if __name__ == '__main__':
    main()

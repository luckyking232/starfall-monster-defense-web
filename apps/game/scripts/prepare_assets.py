"""Copy reviewed original UI assets into the Vite public directory with hashes."""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path

APP = Path(__file__).resolve().parents[1]

UI_SPRITES = {
    'q3oheq': 'ui/home-background.png',
    'q3ohgz': 'ui/stage-unlocked-top.png',
    'q3ohh1': 'ui/stage-unlocked-bottom.png',
    'q3ohgy': 'ui/stage-locked-top.png',
    'q3ohh0': 'ui/stage-locked-bottom.png',
    'q3ohh2': 'ui/stage-node.png',
    'q3ohh3': 'ui/stage-lock.png',
    'q3ohh7': 'ui/stage-infinite.png',
    'q3ohh8': 'ui/stage-infinite-lock.png',
    'q3ohh9': 'ui/stage-line.png',
    'q3ohhb': 'ui/avatar-bar.png',
    'q3ohhc': 'ui/avatar-frame.png',
    'q3ohhe': 'ui/avatar-selected.png',
    'q3ohhg': 'ui/avatar-lock.png',
    'h8pjiy': 'ui/clear-mark.png',
    'spxeid': 'ui/card-78000101.png',
    'spxeie': 'ui/card-78000102.png',
    'spxeic': 'ui/card-78000103.png',
    'spxeib': 'ui/card-78000104.png',
    'spxeif': 'ui/card-78000105.png',
}
MAP_FILES = {f'MiniGame022_map{index}.png': f'maps/map{index}.png' for index in (1, 2, 3)}
LICENSE_FILES = {
    'NOTICES.txt',
    'Source-Han-Sans-OFL-1.1.txt',
    'Lua-License.txt',
    'Wasmoon-MIT.txt',
}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True, help='Verified monster-defense research directory')
    args = parser.parse_args()
    source = args.source.resolve(strict=True)
    destination = APP / 'public' / 'assets'
    records: dict[str, dict[str, object]] = {}

    def copy(source_file: Path, target_name: str, provenance: str) -> None:
        if not source_file.is_file():
            raise FileNotFoundError(source_file)
        target = destination / target_name
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists() or digest(source_file) != digest(target):
            shutil.copyfile(source_file, target)
        records[target_name] = {
            'bytes': target.stat().st_size,
            'sha256': digest(target),
            'source': str(source_file.relative_to(source)).replace('\\', '/'),
            'provenance': provenance,
        }

    for sprite_id, target_name in UI_SPRITES.items():
        copy(source / 'assets' / 'fgui-sprites-by-id' / 'ActivityDungeon1017' / f'{sprite_id}.png', target_name, 'original-game-fgui')
    for source_name, target_name in MAP_FILES.items():
        copy(source / 'assets' / 'exported' / 'assets' / 'art' / 'models' / 'minigame022' / 'prefab' / source_name, target_name, 'original-game-map')
    copy(source / 'web' / 'dist' / 'native-font-shell' / 'SOURCEHANSANSSC-NORMAL-2.otf', 'fonts/source-han-sans.otf', 'third-party-font')
    for name in LICENSE_FILES:
        copy(source / 'web' / 'dist' / 'LICENSES' / name, f'licenses/{name}', 'license-notice')

    manifest = {
        'schema': 'starfall.monster-defense.assets/1',
        'gameResourceVersion': '134395529309427262',
        'licenseReviewRequired': True,
        'files': records,
    }
    (destination / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Prepared {len(records)} original asset files in {destination}')


if __name__ == '__main__':
    main()

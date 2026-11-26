"""Prepare the minimal original Lua/Wasmoon runtime without legacy UI or receipts."""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import zipfile
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
ZIP_ROOT = 'monster-defense-source-inputs/'
ZIP_FILES = (
    'core-worker/inputs/vendor/index.js',
    'core-worker/inputs/vendor/glue.wasm',
    'core-worker/inputs/vendor/LICENSE',
    'core-worker/inputs/vendor/LUA-LICENSE',
    'core-worker/inputs/vendor/provenance.json',
    'core-worker/skill-choice/inputs/MiniGameSkillChoiceWindow.lua',
    'core-worker/skill-choice/inputs/choice-original-helpers.lua',
    'summon-evidence/headless-extension.lua',
)
COMPAT_FILES = (
    'core-worker/spawn-audit-bridge.lua',
    'core-worker/combat-prefix/bridge.lua',
    'core-worker/skill-choice/snapshot-codec.js',
    'core-worker/skill-choice/engine.lua',
    'core-worker/skill-choice/driver.lua',
    'browser-stage1/transport-controls.lua',
)


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release', type=Path, required=True, help='Pinned source-inputs ZIP')
    parser.add_argument('--compat', type=Path, required=True, help='packages/replica-runtime directory')
    args = parser.parse_args()
    release = args.release.resolve(strict=True)
    compat = args.compat.resolve(strict=True)
    destination = APP / 'public' / 'assets' / 'runtime'
    destination.mkdir(parents=True, exist_ok=True)
    records: dict[str, dict[str, object]] = {}

    def write(relative: str, data: bytes, provenance: str) -> None:
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        records[relative] = {'bytes': len(data), 'sha256': sha(data), 'provenance': provenance}

    with zipfile.ZipFile(release) as archive:
        names = set(archive.namelist())
        for relative in ZIP_FILES:
            write(relative, archive.read(ZIP_ROOT + relative), 'pinned-browser-input')
        for prefix in ('core-worker/inputs/lua/', 'core-worker/combat-prefix/inputs/'):
            for name in sorted(names):
                if name.startswith(ZIP_ROOT + prefix) and name.endswith('.lua'):
                    relative = name.removeprefix(ZIP_ROOT)
                    write(relative, archive.read(name), 'original-lua-compatible')
    for relative in COMPAT_FILES:
        write(relative, (compat / relative).read_bytes(), 'audited-compatibility-source')

    if len(records) != 39:
        raise RuntimeError(f'Unexpected runtime file count: {len(records)}')
    lock = {
        'schema': 'starfall.monster-defense.runtime-input/1',
        'gameResourceVersion': '134395529309427262',
        'releaseSha256': sha(release.read_bytes()),
        'fileCount': len(records),
        'files': records,
        'cardAttributeAndMathUtil': {
            'normalizedSourceMatch': True,
            'evidence': 'web/card-math-util-comparison.json',
        },
    }
    (APP / 'runtime-input.lock.json').write_text(json.dumps(lock, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (destination / 'manifest.json').write_text(json.dumps(lock, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Prepared {len(records)} runtime files in {destination}')


if __name__ == '__main__':
    main()

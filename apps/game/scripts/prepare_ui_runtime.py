"""Prepare original window Lua, generated bindings and their require closure."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
VERSION = '134395529309427262'
ENTRY_POINT = 'Activity17MiniGame2MainWindow'
WINDOWS = (
    'Activity17MiniGame2MainWindow.lua',
    'Activity17MiniGameChoice2Window.lua',
    'Activity17MiniGameChoice2_InfoSkillWindow.lua',
    'MiniGameBattleUIWindow.lua',
    'MiniGameSkillChoiceWindow.lua',
    'MiniGameBattlePauseWindow.lua',
    'MiniGameBattleExitWindow.lua',
    'MiniGameBattleEndWindow.lua',
    'MiniGameBattleHurtNum.lua',
    'MiniGameBattleMessageBar.lua',
    'MiniGameBattleActionDisplay.lua',
    'MiniGameBattleBackground.lua',
    'Activity17_MiniGameScriptList.lua',
    'Activity17_MiniGameData.lua',
    'Activity17_MiniGameService.lua',
    'ActivityDungeonData.lua',
    'BaseActivityStageGame.lua',
    'BaseActivityStageConfig.lua',
    'BaseActivity.lua',
    'BaseWord_cn.lua',
    'BattleLoadingWindow.lua',
    'SortingHelper.lua',
    'BaseSoundPath.lua',
)
NATIVE_DEPENDENCIES: set[str] = set()
REQUIRE = re.compile(r'\brequire\("([^"]+)"\)')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    args = parser.parse_args()
    source = args.source.resolve(strict=True)
    decoded = source / 'lua' / VERSION / 'decoded'
    supplemental = APP / 'local-inputs' / 'ui-decoded'
    destination = APP / 'public' / 'assets' / 'runtime' / 'ui'
    destination.mkdir(parents=True, exist_ok=True)
    order: list[str] = []
    requires: dict[str, list[str]] = {}
    visited: set[str] = set()
    visiting: set[str] = set()
    native: set[str] = set()

    def origin_for(name: str) -> Path:
        original = decoded / name
        return original if original.is_file() else supplemental / name

    def visit(name: str) -> None:
        if name in visited:
            return
        if name in visiting:
            raise ValueError(f'Circular require: {name}')
        visiting.add(name)
        text = origin_for(name).read_text(encoding='utf-8')
        dependencies = REQUIRE.findall(text)
        requires[name] = dependencies
        for dependency in dependencies:
            dependency_file = f'{dependency}.lua'
            if origin_for(dependency_file).is_file():
                visit(dependency_file)
            elif dependency in NATIVE_DEPENDENCIES:
                native.add(dependency)
            else:
                raise FileNotFoundError(f'{name} requires unclosed {dependency}')
        visiting.remove(name)
        visited.add(name)
        order.append(name)

    for name in WINDOWS:
        visit(name)

    metadata_path = APP / 'local-inputs' / 'ui-dependencies.json'
    text_assets = json.loads(metadata_path.read_text(encoding='utf-8')) if metadata_path.exists() else {}
    records = {}
    for name in order:
        origin = origin_for(name)
        relative = f'original/{name}'
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists() or hashlib.sha256(target.read_bytes()).digest() != hashlib.sha256(origin.read_bytes()).digest():
            shutil.copyfile(origin, target)
        source_name = origin.relative_to(source).as_posix() if origin.is_relative_to(source) else origin.relative_to(APP).as_posix()
        records[name] = {
            'file': relative,
            'bytes': origin.stat().st_size,
            'sha256': hashlib.sha256(origin.read_bytes()).hexdigest(),
            'source': source_name,
            'provenance': 'original-lua-ui',
            'requires': requires[name],
        }
        if name in text_assets:
            records[name]['originalTextAsset'] = text_assets[name]
    # Platform helpers contain lazy references to other parts of the full game.
    # Only the named helper methods used here are installed on the browser host.
    platform_modules = {}
    for name in ('GlobalConst.lua', 'TimeUtil.lua', 'UIUtil.lua', 'SoundUtil.lua'):
        origin = origin_for(name)
        payload = origin.read_bytes()
        evidence = text_assets[name]
        digest = hashlib.sha256(payload).hexdigest()
        if digest != evidence['decodedSha256']:
            raise ValueError(f'{name} differs from the decoded TextAsset')
        relative = f'platform/{name}'
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists() or target.read_bytes() != payload:
            target.write_bytes(payload)
        platform_modules[name] = {'file': relative, 'sha256': digest, 'originalTextAsset': evidence}
    manifest = {
        'platformModules': platform_modules,
        'schema': 'starfall.monster-defense.ui-input/1',
        'gameResourceVersion': VERSION,
        'entryPoint': ENTRY_POINT,
        'loadOrder': order,
        'nativeDependencies': sorted(native),
        'files': records,
    }
    (destination / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Prepared {len(records)} original UI Lua files; native requires: {sorted(native)}')


if __name__ == '__main__':
    main()

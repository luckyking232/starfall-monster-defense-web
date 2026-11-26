import hashlib
import json
from pathlib import Path
import re
import unittest


APP = Path(__file__).resolve().parents[2]
SOURCE = Path('E:/FallStar/server-exports/monster-defense-research-20261125')
DECODED = SOURCE / 'lua' / '134395529309427262' / 'decoded'
WINDOWS = {
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
}


class UiInputTest(unittest.TestCase):
    def test_original_windows_and_require_closure_are_verbatim(self):
        manifest = json.loads((APP / 'public/assets/runtime/ui/manifest.json').read_text(encoding='utf-8'))
        self.assertEqual(manifest['schema'], 'starfall.monster-defense.ui-input/1')
        self.assertEqual(manifest['gameResourceVersion'], '134395529309427262')
        self.assertEqual(manifest['entryPoint'], 'Activity17MiniGame2MainWindow')
        records = manifest['files']
        names = set(records)
        self.assertTrue(WINDOWS <= names)
        self.assertIn('ActivityDungeon1017_MiniGame2ByName.lua', names)
        self.assertIn('ActivityDungeon1017Battle_BattleUIByName.lua', names)
        self.assertIn('CommonResource_Activity17_MonsterHPByName.lua', names)
        self.assertIn('BaseWord_cn.lua', names)
        for name, record in records.items():
            expected_source = f'lua/134395529309427262/decoded/{name}' if (DECODED / name).is_file() else f'local-inputs/ui-decoded/{name}'
            source = SOURCE / record['source'] if record['source'].startswith('lua/') else APP / record['source']
            generated = APP / 'public/assets/runtime/ui' / record['file']
            self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), record['sha256'], name)
            self.assertEqual(hashlib.sha256(generated.read_bytes()).hexdigest(), record['sha256'], name)
            self.assertEqual(record['provenance'], 'original-lua-ui')
            self.assertEqual(record['source'], expected_source)
            for dependency in record['requires']:
                if dependency in manifest['nativeDependencies']:
                    continue
                self.assertIn(f'{dependency}.lua', names, f'{name} requires {dependency}')
        self.assertEqual(manifest['entryPoint'], 'Activity17MiniGame2MainWindow')

    def test_dependencies_load_before_their_consumers(self):
        manifest = json.loads((APP / 'public/assets/runtime/ui/manifest.json').read_text(encoding='utf-8'))
        records = manifest['files']
        positions = {name: index for index, name in enumerate(manifest['loadOrder'])}
        self.assertEqual(set(positions), set(records))
        for name, record in records.items():
            for dependency in record['requires']:
                if dependency in manifest['nativeDependencies']:
                    continue
                dependency_name = f'{dependency}.lua'
                self.assertLess(positions[dependency_name], positions[name], f'{name} requires {dependency_name}')

    def test_original_data_service_and_activity_configuration(self):
        manifest = json.loads((APP / 'public/assets/runtime/ui/manifest.json').read_text(encoding='utf-8'))
        expected = {
            'Activity17_MiniGameScriptList.lua',
            'Activity17_MiniGameData.lua',
            'Activity17_MiniGameService.lua',
            'ActivityDungeonData.lua',
            'BaseActivityStageGame.lua',
            'BaseActivityStageConfig.lua',
            'BaseActivity.lua',
        }
        self.assertTrue(expected <= set(manifest['files']))

    def test_native_dependencies_are_explicit(self):
        manifest = json.loads((APP / 'public/assets/runtime/ui/manifest.json').read_text(encoding='utf-8'))
        declared = set(manifest['nativeDependencies'])
        records = manifest['files']
        for name, record in manifest['files'].items():
            origin = DECODED / name if (DECODED / name).is_file() else APP / 'local-inputs/ui-decoded' / name
            source = origin.read_text(encoding='utf-8')
            for dependency in re.findall(r'\brequire\("([^"]+)"\)', source):
                self.assertTrue(f'{dependency}.lua' in records or dependency in declared, f'{name} requires unclosed {dependency}')


if __name__ == '__main__':
    unittest.main()

"""Verify generated battle asset and battle UI manifests against original sources."""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import struct
import subprocess
import sys
import unittest
from pathlib import Path

APP = Path(__file__).resolve().parents[2]
WORKSPACE = APP.parents[2]
RESEARCH = Path(os.environ.get('STARFALL_RESEARCH_DIR', WORKSPACE / 'server-exports' / 'monster-defense-research-20261125'))

BATTLE_MANIFEST = APP / 'public' / 'assets' / 'battle-assets.json'
UI_MANIFEST = APP / 'public' / 'assets' / 'battle-ui.json'
HOME_MANIFEST = APP / 'public' / 'assets' / 'manifest.json'

FRAME_SETS = {
    'minigamespine_10000118_pixel': 20,
    'minigamespine_10000134_pixel': 13,
    'minigamespine_10000104_pixel': 13,
    'minigamespine_10000101_pixel': 13,  # source skips index 6
    'minigamespine_10000198_pixel': 14,
    'battlespine_20010_pixel': 25,
    'battlespine_20302_pixel': 26,
}
WALL = 'units/minigamespine_zhalan_pixel.png'
EFFECTS = 5
AUDIO = 46


def load(path: Path) -> dict:
    return json.loads(path.read_bytes().decode('utf-8'))


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def png_size(path: Path) -> tuple[int, int]:
    data = path.read_bytes()
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise AssertionError(f'{path} is not a PNG')
    return struct.unpack('>II', data[16:24])


def frame_index(name: str) -> int:
    return int(Path(name).stem.rsplit('_', 1)[1])


@unittest.skipUnless(RESEARCH.is_dir(), f'research directory missing: {RESEARCH}')
class BattleAssetsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.manifest = load(BATTLE_MANIFEST)
        cls.files = cls.manifest['files']

    def test_schema_and_total_counts(self) -> None:
        self.assertEqual(self.manifest['schema'], 'starfall.monster-defense.battle-assets/1')
        self.assertEqual(len(self.files), 176)
        units = [k for k in self.files if k.startswith('units/')]
        self.assertEqual(len(units), 125)
        self.assertEqual(len([k for k in self.files if k.startswith('effects/')]), EFFECTS)
        self.assertEqual(len([k for k in self.files if k.startswith('audio/')]), AUDIO)

    def test_every_frame_set_is_complete_and_contiguous(self) -> None:
        for prefix, count in FRAME_SETS.items():
            frames = sorted(
                (k for k in self.files if k.startswith(f'units/{prefix}_')),
                key=frame_index,
            )
            self.assertEqual(len(frames), count, prefix)
            indices = [frame_index(k) for k in frames]
            if prefix == 'minigamespine_10000101_pixel':
                self.assertEqual(indices, [0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13], prefix)
            else:
                self.assertEqual(indices, list(range(count)), prefix)
        self.assertIn(WALL, self.files)

    def test_first_stage_monster_20302_has_26_frames(self) -> None:
        frames = [k for k in self.files if k.startswith('units/battlespine_20302_pixel_')]
        self.assertEqual(len(frames), 26)
        self.assertEqual(sorted(frame_index(k) for k in frames), list(range(26)))

    def test_every_recorded_file_exists_with_matching_hash(self) -> None:
        for name, record in self.files.items():
            target = APP / 'public' / 'assets' / name
            self.assertTrue(target.is_file(), name)
            self.assertEqual(target.stat().st_size, record['bytes'], name)
            self.assertEqual(sha(target), record['sha256'], name)

    def test_every_recorded_source_exists_with_matching_hash(self) -> None:
        for name, record in self.files.items():
            source = RESEARCH / record['source']
            self.assertTrue(source.is_file(), name)
            self.assertEqual(sha(source), record.get('sourceSha256', record['sha256']), name)
            self.assertTrue(record['provenance'], name)

    def test_music_is_packaged_once_and_preserves_both_timeline_layers(self) -> None:
        cues = load(APP / 'runtime' / 'audio-cues.json')
        self.assertEqual(cues['clockHz'], 48000)
        self.assertEqual(cues['music']['layers'], [
            {'file': '02_B02-O.flac', 'start': 0, 'offset': 27724, 'loopFrom': 1985514, 'loopTo': 6305514, 'gainDb': -11},
            {'file': '01_B02-R.flac', 'start': 6444, 'offset': 34167, 'loopFrom': 1985513, 'loopTo': 6305513, 'gainDb': -13},
        ])
        for layer in cues['music']['layers']:
            target = APP / 'public' / 'assets' / 'audio' / layer['file']
            self.assertFalse(target.with_suffix('.wav').exists())
            self.assertEqual(self.files[f'audio/{target.name}']['provenance'], 'lossless-original-bgm')

    @unittest.skipUnless(shutil.which('ffmpeg'), 'FFmpeg is required for the decoded PCM comparison')
    def test_music_decodes_to_the_original_pcm_hashes(self) -> None:
        for name, record in self.files.items():
            if record['provenance'] != 'lossless-original-bgm':
                continue
            target = APP / 'public' / 'assets' / name
            for path in (target, RESEARCH / record['source']):
                result = subprocess.run(
                    ['ffmpeg', '-v', 'error', '-nostdin', '-i', str(path), '-c:a', 'pcm_s16le',
                     '-f', 'hash', '-hash', 'sha256', '-'], capture_output=True, check=True, text=True,
                )
                self.assertEqual(result.stdout.strip(), 'SHA256=' + record['pcmSha256'], path)


@unittest.skipUnless(RESEARCH.is_dir(), f'research directory missing: {RESEARCH}')
class BattleUiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.manifest = load(UI_MANIFEST)
        cls.files = cls.manifest['files']
        cls.by_name = cls.manifest['byName']

    def file_for(self, name: str) -> Path:
        file_name = self.by_name[name]
        return APP / 'public' / 'assets' / 'ui' / 'battle' / file_name

    def test_schema_and_complete_82_files(self) -> None:
        self.assertEqual(self.manifest['schema'], 'starfall.monster-defense.battle-ui/1')
        self.assertEqual(self.manifest['package'], 'ActivityDungeon1017Battle')
        self.assertEqual(len(self.files), 82)
        for file_name, record in self.files.items():
            self.assertEqual(record['spriteId'], Path(file_name).stem, file_name)

    def test_skill_icons_resolve_by_name(self) -> None:
        for name in ('Skill_10018_1', 'Skill_10034_1', 'Skill_10018_2', 'Skill_10018_3'):
            target = self.file_for(name)
            self.assertTrue(target.is_file(), name)
            self.assertEqual(png_size(target), (58, 58), name)

    def test_first_stage_portraits_and_tokens_resolve_by_name(self) -> None:
        for name in ('B_10018', 'B_10034'):
            target = self.file_for(name)
            self.assertTrue(target.is_file(), name)
            self.assertEqual(png_size(target), (120, 152), name)
        for name in ('S_10018', 'S_10034'):
            self.assertEqual(png_size(self.file_for(name)), (40, 40), name)

    def test_result_pause_and_pick_card_backgrounds(self) -> None:
        self.assertEqual(png_size(self.file_for('结束面板')), (1668, 313))
        self.assertEqual(png_size(self.file_for('弹窗')), (1668, 132))
        for name in ('底框', '选中底框'):
            self.assertEqual(png_size(self.file_for(name)), (280, 500), name)
        for name in ('暂停底板', '暂停图标', '退出图标', '加速图标', '结束按钮'):
            self.assertTrue(self.file_for(name).is_file(), name)

    def test_digit_sprites_exist_as_two_sets(self) -> None:
        for digit in '0123456789':
            entries = self.by_name[digit]
            self.assertIsInstance(entries, list, digit)
            self.assertEqual(len(entries), 2, digit)
            for file_name in entries:
                self.assertTrue((APP / 'public' / 'assets' / 'ui' / 'battle' / file_name).is_file(), digit)
                self.assertEqual(png_size(APP / 'public' / 'assets' / 'ui' / 'battle' / file_name), (23, 23), digit)

    def test_every_recorded_file_exists_with_matching_hash(self) -> None:
        for file_name, record in self.files.items():
            target = APP / 'public' / 'assets' / 'ui' / 'battle' / file_name
            self.assertTrue(target.is_file(), file_name)
            self.assertEqual(target.stat().st_size, record['bytes'], file_name)
            self.assertEqual(sha(target), record['sha256'], file_name)
            expected = (record['width'], record['height'])
            if record['rotated']:
                self.assertIn(png_size(target), (expected, (record['height'], record['width'])), file_name)
            else:
                self.assertEqual(png_size(target), expected, file_name)

    def test_every_recorded_source_exists_with_matching_hash(self) -> None:
        for file_name, record in self.files.items():
            source = RESEARCH / record['source']
            self.assertTrue(source.is_file(), file_name)
            self.assertEqual(sha(source), record['sha256'], file_name)
            self.assertEqual(record['provenance'], 'original-game-fgui', file_name)

    def test_unique_names_match_fgui_split_cuts(self) -> None:
        split = RESEARCH / 'assets' / 'fgui-split' / 'ActivityDungeon1017Battle_fui'
        names: dict[str, list[str]] = {}
        for record in self.files.values():
            names.setdefault(record['name'], []).append(record['spriteId'])
        for name, records in self.files.items():
            if len(names[records['name']]) != 1:
                continue
            split_file = split / f"{records['name']}.png"
            self.assertTrue(split_file.is_file(), name)
            self.assertEqual(
                sha(split_file),
                sha(APP / 'public' / 'assets' / 'ui' / 'battle' / name),
                records['name'],
            )


class ManifestIndependenceTest(unittest.TestCase):
    def test_battle_ui_manifest_is_separate_from_home_manifest(self) -> None:
        home = load(HOME_MANIFEST)
        battle = load(UI_MANIFEST)
        overlap = set(home['files']) & {f"ui/battle/{k}" for k in battle['files']}
        self.assertEqual(overlap, set())
        self.assertNotEqual(home['schema'], battle['schema'])


if __name__ == '__main__':
    sys.path.insert(0, str(APP))
    unittest.main()

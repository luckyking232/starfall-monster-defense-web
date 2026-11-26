"""Verify generated native Unity presentation data against the original bundles.

The JSON under ``public/assets/native/`` must carry the real object graph of the
sixteen original monster-defense bundles (12 animated units + the zhalan wall +
3 maps): Sprite rect/pivot/PPU, Transform trees, SpriteRenderer/Animator
references, AnimatorController states and fully decoded AnimationClip sprite
curves (compiled ``m_MuscleClip.m_Clip.data`` StreamedClip/DenseClip payloads).

Expected literals below were measured from the processed bundles with UnityPy
and cross-checked against ``assets/map/assets_map.json`` and the original
AssetStudio PNG frames -- never from video or screenshots. Clips that carry no
curve data (20108 ``die``) must be reported as explicitly empty, not faked.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import struct
import subprocess
import sys
import tempfile
import unittest
import zlib
from pathlib import Path

APP = Path(__file__).resolve().parents[2]
WORKSPACE = APP.parents[2]
RESEARCH = Path(os.environ.get('STARFALL_RESEARCH_DIR', WORKSPACE / 'server-exports' / 'monster-defense-research-20261125'))

NATIVE_DIR = APP / 'public' / 'assets' / 'native'
MANIFEST = NATIVE_DIR / 'manifest.json'
SCRIPT = APP / 'scripts' / 'prepare_native_presentation.py'

sys.path.insert(0, str(APP))

ASSET_VERSION = '134395529309427262'
BUNDLES_DIR = RESEARCH / 'assets' / 'bundles' / ASSET_VERSION
FRAMES_DIR = RESEARCH / 'assets' / 'exported' / 'assets' / 'art' / 'models' / 'minigame022' / 'prefab'
ASSETS_MAP = RESEARCH / 'assets' / 'map' / 'assets_map.json'
HEADER_FIX = RESEARCH / 'assets' / 'header-fix-report.json'

# unit key -> (bundle md5, sprite count, animator state names, sprite name prefix)
UNITS = {
    'minigamespine_20010_pixel': ('c6a8f72b80fdad185c88326d0da943ce', 25, {'idle', 'run', 'die', 'skill1'}, 'battlespine_20010_pixel'),
    'minigamespine_20011_pixel': ('a1dd0a7ea46319138e6c63a7853c07d3', 25, {'idle', 'run', 'die', 'skill1'}, 'battlespine_20011_pixel'),
    'minigamespine_20108_pixel': ('84c63f1a28dcc746b573a764fb661c40', 20, {'idle', 'run', 'die', 'skill1'}, 'battlespine_20108_pixel'),
    'minigamespine_20302_pixel': ('41c99955eaf77c3a14f46e07c4cff168', 26, {'idle', 'run', 'die', 'skill1'}, 'battlespine_20302_pixel'),
    'minigamespine_20306_pixel': ('21a2c8ff7c36d030ba0cd87133ca1726', 25, {'idle', 'run', 'die', 'skill1'}, 'battlespine_20306_pixel'),
    'minigamespine_20411_pixel': ('a042d4ecec90517e097896afaf6a2a0d', 25, {'idle', 'run', 'die', 'skill1'}, 'battlespine_20411_pixel'),
    'minigamespine_20506_pixel': ('0b7bc080b49cf84af10a63fdc066f4cd', 28, {'idle', 'run', 'die', 'skill1'}, 'battlespine_20506_pixel'),
    'minigamespine_10000101_pixel': ('cb13a6e0b1c702ce3b364cc3c7ded074', 13, {'idle', 'skill1'}, 'minigamespine_10000101_pixel'),
    'minigamespine_10000104_pixel': ('2843322b24ca395a0f5423508a8aa16f', 13, {'idle', 'skill1'}, 'minigamespine_10000104_pixel'),
    'minigamespine_10000118_pixel': ('64dbe5bdd51ae888249eb2111e3d0575', 20, {'idle', 'skill1', 'skill2'}, 'minigamespine_10000118_pixel'),
    'minigamespine_10000134_pixel': ('5aa06e0049e335e7c26c88861c4c7d9a', 13, {'idle', 'skill1'}, 'minigamespine_10000134_pixel'),
    'minigamespine_10000198_pixel': ('ec2728fe719e6898eb495aa4d60c2c07', 14, {'idle', 'skill1'}, 'minigamespine_10000198_pixel'),
    'minigamespine_zhalan_pixel': ('5d9887f19cdf925e93311026e38d59a9', 1, set(), 'minigamespine_zhalan_pixel'),
}
MAPS = {
    'minigame022_map1': '0553b6c60dc4a68e44c2ff16ad4692bc',
    'minigame022_map2': 'be94419ee51256c1cf06c416e47807c1',
    'minigame022_map3': '4112b4323c3bbb2ef13890ce5197ee45',
}
WALL = 'minigamespine_zhalan_pixel'
# external material objects referenced by the prefabs -> the sibling bundle holding them
EXTERNAL_MATERIAL_BUNDLES = {
    'Sprites-Default_Shadow': 'fcb54c0ebfe8fe5d2af35834a1796dd7',
    'background': '4ea830aef39c09dee50893b3b103c606',
}
FENCE_OFFSETS = [1.8, 1.2, 0.6, 0.0, -0.6, -1.2, -1.8, -2.4]
NEG_FLT_MAX = -3.4028234663852886e+38
TOTAL_SPRITES = sum(entry[1] for entry in UNITS.values()) + len(MAPS)  # 251

try:
    import UnityPy
except ImportError:  # pragma: no cover - environment guard
    UnityPy = None


def load(path: Path) -> dict:
    return json.loads(path.read_bytes().decode('utf-8'))


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def png_size(path: Path) -> tuple[int, int]:
    data = path.read_bytes()
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise AssertionError(f'{path} is not a PNG')
    return struct.unpack('>II', data[16:24])


def f32(value: float) -> float:
    return struct.unpack('<f', struct.pack('<f', value))[0]


def parse_streamed(words: list[int]) -> list[tuple[float, list[tuple[int, list[float]]]]]:
    """Independent StreamedClip frame parser used to audit the generated JSON."""
    frames = []
    index = 0
    while index < len(words):
        time = struct.unpack('<f', struct.pack('<I', words[index]))[0]
        count = words[index + 1]
        index += 2
        keys = []
        for _ in range(count):
            curve = words[index]
            coeffs = [struct.unpack('<f', struct.pack('<I', w))[0] for w in words[index + 1:index + 5]]
            keys.append((curve, coeffs))
            index += 5
        frames.append((time, keys))
    return frames


@unittest.skipUnless(RESEARCH.is_dir(), f'research directory missing: {RESEARCH}')
@unittest.skipUnless(UnityPy is not None, 'UnityPy is required to audit the original bundles')
class NativePresentationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if not MANIFEST.is_file():
            raise AssertionError(f'generated native manifest missing: {MANIFEST} (run scripts/prepare_native_presentation.py)')
        cls.manifest = load(MANIFEST)
        cls.units = {key: load(NATIVE_DIR / 'units' / f'{key}.json') for key in UNITS}
        cls.maps = {key: load(NATIVE_DIR / 'maps' / f'{key}.json') for key in MAPS}
        UnityPy.set_assetbundle_decrypt_key(b'yunguihaowan1234')
        cls.bundle_trees: dict[str, dict[int, tuple[str, dict]]] = {}
        for key, (bundle_md5, *_rest) in list(UNITS.items()) + [(k, (v,)) for k, v in MAPS.items()]:
            env = UnityPy.load(str(BUNDLES_DIR / 'processed' / f'{bundle_md5}.bundle'))
            trees: dict[int, tuple[str, dict]] = {}
            for obj in env.objects:
                try:
                    trees[int(obj.path_id)] = (obj.type.name, obj.read_typetree())
                except Exception:
                    trees[int(obj.path_id)] = (obj.type.name, {})
            cls.bundle_trees[key] = trees

    # ------------------------------------------------------------------ manifest

    def test_manifest_lists_every_prefab_with_provenance(self) -> None:
        manifest = self.manifest
        self.assertEqual(manifest['schema'], 'starfall-native-manifest/1')
        self.assertEqual(manifest['source']['assetVersion'], ASSET_VERSION)
        for field in ('downloadManifestSha256', 'headerFixReportSha256', 'assetsMapSha256'):
            self.assertRegex(manifest['source'][field], r'^[0-9a-f]{64}$', field)
        prefabs = {entry['key']: entry for entry in manifest['prefabs']}
        self.assertEqual(set(prefabs), set(UNITS) | set(MAPS))
        for key, entry in prefabs.items():
            document = self.units.get(key) or self.maps.get(key)
            self.assertIsNotNone(document, key)
            json_path = NATIVE_DIR / entry['json']
            self.assertTrue(json_path.is_file(), entry['json'])
            self.assertEqual(entry['jsonSha256'], sha(json_path), key)
            self.assertEqual(entry['container'], document['prefab']['container'])
        for key, (bundle_md5, sprites, states, _prefix) in UNITS.items():
            entry = prefabs[key]
            self.assertEqual(entry['bundle'], bundle_md5)
            self.assertEqual(entry['sprites'], sprites, key)
            self.assertEqual(set(entry['states']), states, key)
        for key, bundle_md5 in MAPS.items():
            self.assertEqual(prefabs[key]['bundle'], bundle_md5)
            self.assertEqual(prefabs[key]['kind'], 'map')
        self.assertEqual(prefabs[WALL]['kind'], 'wall')
        for key in UNITS:
            if key != WALL:
                self.assertEqual(prefabs[key]['kind'], 'unit', key)

    def test_bundle_hashes_match_original_and_processed_files(self) -> None:
        bundles = self.manifest['bundles']
        self.assertEqual(set(bundles), {md5 for md5, *_ in UNITS.values()} | set(MAPS.values()))
        header_report = {Path(item['source']).name: item for item in load(HEADER_FIX)['files']}
        download = load(RESEARCH / 'assets' / 'download-manifest.json')
        by_hash = {item['hash']: item for item in download['files']}
        for md5, record in bundles.items():
            original = BUNDLES_DIR / 'original' / f'{md5}.bundle'
            processed = BUNDLES_DIR / 'processed' / f'{md5}.bundle'
            original_bytes = original.read_bytes()
            processed_bytes = processed.read_bytes()
            self.assertEqual(record['originalMd5'], md5)
            self.assertEqual(hashlib.md5(original_bytes).hexdigest(), md5, md5)
            self.assertEqual(record['originalSha256'], hashlib.sha256(original_bytes).hexdigest(), md5)
            self.assertEqual(record['processedSha256'], hashlib.sha256(processed_bytes).hexdigest(), md5)
            self.assertEqual(record['sizeBytes'], len(original_bytes))
            self.assertEqual(record['processedSizeBytes'], len(processed_bytes))
            # the processed bundle is the original with the 32-byte encrypted header stripped
            self.assertEqual(record['headerOffsetStripped'], 32)
            self.assertEqual(processed_bytes, original_bytes[32:], md5)
            self.assertEqual(header_report[f'{md5}.bundle']['offset'], 32)
            self.assertEqual(record['manifestIndex'], by_hash[md5]['manifest_index'])
            self.assertEqual(record['name'], by_hash[md5]['name'])
            self.assertTrue(record['usedBy'], md5)

    # ------------------------------------------------------------------- sprites

    def test_every_sprite_matches_the_bundle_exactly(self) -> None:
        for key in list(UNITS) + list(MAPS):
            document = self.units.get(key) or self.maps.get(key)
            trees = self.bundle_trees[key]
            bundle_sprites = {pid: tree for pid, (kind, tree) in trees.items() if kind == 'Sprite'}
            json_sprites = {int(sprite['pathId']): sprite for sprite in document['objects']['sprites']}
            self.assertEqual(set(json_sprites), set(bundle_sprites), key)
            for path_id, tree in bundle_sprites.items():
                sprite = json_sprites[path_id]
                self.assertEqual(sprite['name'], tree['m_Name'])
                for field, source in (('rect', 'm_Rect'), ('pivot', 'm_Pivot'), ('offset', 'm_Offset'),
                                      ('border', 'm_Border'), ('textureRect', 'm_RD.textureRect'),
                                      ('textureRectOffset', 'm_RD.textureRectOffset')):
                    expected = tree
                    for part in source.split('.'):
                        expected = expected[part]
                    self.assertEqual(sprite[field], expected, f'{key}/{tree["m_Name"]}/{field}')
                self.assertEqual(sprite['pixelsToUnits'], tree['m_PixelsToUnits'])
                self.assertEqual(int(sprite['texture']), tree['m_RD']['texture']['m_PathID'])
                frame = sprite['frame']
                png = NATIVE_DIR / frame['file']
                self.assertTrue(png.is_file(), frame['file'])
                self.assertEqual(frame['sha256'], sha(png), frame['file'])
                source_png = FRAMES_DIR / f"{tree['m_Name']}.png"
                self.assertEqual(sha(source_png), frame['sha256'], f'{key}/{tree["m_Name"]} source')
                self.assertEqual(frame['source'], f'assets/exported/assets/art/models/minigame022/prefab/{tree["m_Name"]}.png')
                width, height = png_size(png)
                rect = tree['m_RD']['textureRect']
                self.assertEqual((width, height), (math.ceil(rect['width']), math.ceil(rect['height'])), tree['m_Name'])
                self.assertEqual(frame['width'], width)
                self.assertEqual(frame['height'], height)

    def test_pixel7_pivot_ppu_rect_literals(self) -> None:
        document = self.units['minigamespine_10000118_pixel']
        sprite = next(s for s in document['objects']['sprites'] if s['name'] == 'minigamespine_10000118_pixel_7')
        self.assertEqual(int(sprite['pathId']), -9220094113737002391)
        self.assertAlmostEqual(sprite['pivot']['x'], 0.36645299196243286, places=12)
        self.assertAlmostEqual(sprite['pivot']['y'], 0.24358919262886047, places=12)
        self.assertEqual(sprite['pixelsToUnits'], 100.0)
        self.assertEqual(sprite['rect'], {'x': 408.0, 'y': 408.0, 'width': 204.0, 'height': 204.0})
        self.assertEqual((sprite['frame']['width'], sprite['frame']['height']), (91, 126))
        # pivot differs between units -- a single global pivot would be wrong
        pivots = {
            key: (doc['objects']['sprites'][0]['pivot']['x'], doc['objects']['sprites'][0]['pivot']['y'])
            for key, doc in self.units.items()
        }
        self.assertNotEqual(pivots['minigamespine_10000118_pixel'], pivots['minigamespine_10000134_pixel'])
        self.assertEqual(pivots[WALL], (0.5, 0.0))

    def test_manifest_frame_index_covers_all_sprites(self) -> None:
        frames = self.manifest['frames']
        self.assertEqual(len(frames), TOTAL_SPRITES)
        for name, entry in frames.items():
            png = NATIVE_DIR / entry['file']
            self.assertTrue(png.is_file(), entry['file'])
            self.assertEqual(entry['sha256'], sha(png), name)
            self.assertIn(entry['prefab'], set(UNITS) | set(MAPS))
            self.assertTrue((NATIVE_DIR / 'units' / f"{entry['prefab']}.json").is_file()
                            or (NATIVE_DIR / 'maps' / f"{entry['prefab']}.json").is_file())

    # ------------------------------------------------------------------ transforms

    def test_zhalan_wall_has_eight_real_fence_offsets(self) -> None:
        document = self.units[WALL]
        self.assertEqual(document['kind'], 'wall')
        self.assertEqual(document['animations']['clips'], [])
        self.assertEqual(document['objects']['animators'], [])
        transforms = {t['pathId']: t for t in document['objects']['transforms']}
        by_name = {t['name']: t for t in document['objects']['transforms']}
        model = by_name['model']
        self.assertEqual(len(model['children']), 10)  # 8 fence segments + bullet + hit
        for index, expected_y in enumerate(FENCE_OFFSETS, start=1):
            segment = by_name[f'minigamespine_zhalan_pixel_{index}']
            self.assertEqual(segment['parent'], model['pathId'])
            self.assertEqual(segment['localPosition']['x'], 0.0)
            self.assertEqual(segment['localPosition']['y'], f32(expected_y), segment['name'])
            self.assertEqual(segment['localPosition']['z'], 0.0)
        ordered = [transforms[child] for child in model['children']]
        fence_names = [t['name'] for t in ordered if t['name'].startswith('minigamespine_zhalan_pixel_')]
        self.assertEqual(fence_names, [f'minigamespine_zhalan_pixel_{i}' for i in range(1, 9)])
        renderers = document['objects']['spriteRenderers']
        self.assertEqual(len(renderers), 8)
        sprite_ids = {int(r['sprite']) for r in renderers}
        self.assertEqual(sprite_ids, {-8874190297655503965})
        for renderer in renderers:
            self.assertEqual(renderer['size']['x'], f32(1.02))
            self.assertEqual(renderer['size']['y'], f32(0.84))
            self.assertTrue(renderer['enabled'])

    def test_transform_tree_and_named_nodes_match_bundle(self) -> None:
        document = self.units['minigamespine_10000118_pixel']
        trees = self.bundle_trees['minigamespine_10000118_pixel']
        transforms = {int(t['pathId']): t for t in document['objects']['transforms']}
        bundle_transforms = {pid: tree for pid, (kind, tree) in trees.items() if kind == 'Transform'}
        self.assertEqual(set(transforms), set(bundle_transforms))
        for path_id, tree in bundle_transforms.items():
            node = transforms[path_id]
            self.assertEqual(node['localPosition'], tree['m_LocalPosition'], path_id)
            self.assertEqual(node['localRotation'], tree['m_LocalRotation'], path_id)
            self.assertEqual(node['localScale'], tree['m_LocalScale'], path_id)
            self.assertEqual(node['parent'], str(tree['m_Father']['m_PathID']))
            self.assertEqual(node['children'], [str(c['m_PathID']) for c in tree['m_Children']])
            self.assertEqual(int(node['gameObject']), tree['m_GameObject']['m_PathID'])
        by_path = {t['path']: t for t in document['objects']['transforms']}
        root = document['prefab']['container'].rsplit('/', 1)[-1].removesuffix('.prefab')
        bullet = by_path[f'{root}/model/bullet']
        self.assertEqual(bullet['localPosition']['x'], f32(0.838))
        self.assertEqual(bullet['localPosition']['y'], f32(0.257))
        hit = by_path[f'{root}/model/hit']
        self.assertEqual(hit['localPosition']['x'], f32(0.038))
        self.assertEqual(hit['localPosition']['y'], f32(0.23))
        self.assertIn(f'{root}/model/HeadBuffPoint', by_path)
        self.assertIn(f'{root}/model/BodyBuffPoint', by_path)
        self.assertIn(f'{root}/model/DizzyBuffPoint', by_path)
        # every GameObject owns exactly one Transform and parent/child links are bidirectional
        game_objects = {go['pathId']: go for go in document['objects']['gameObjects']}
        for node in document['objects']['transforms']:
            self.assertIn(node['gameObject'], game_objects)
            if node['parent'] != '0':
                parent = transforms[int(node['parent'])]
                self.assertIn(node['pathId'], parent['children'])
            for child in node['children']:
                self.assertEqual(transforms[int(child)]['parent'], node['pathId'])

    # ---------------------------------------------------------- animator controllers

    def test_animator_controller_states_match_bundle(self) -> None:
        for key in UNITS:
            if key == WALL:
                continue
            document = self.units[key]
            trees = self.bundle_trees[key]
            controllers = document['objects']['animatorControllers']
            self.assertEqual(len(controllers), 1, key)
            controller = controllers[0]
            (controller_id, (_, tree)), = [(pid, item) for pid, item in trees.items() if item[0] == 'AnimatorController']
            self.assertEqual(int(controller['pathId']), controller_id)
            self.assertEqual(controller['name'], tree['m_Name'])
            self.assertEqual([int(c) for c in controller['animationClips']],
                             [c['m_PathID'] for c in tree['m_AnimationClips']], key)
            tos = {int(k): v for k, v in controller['tos'].items()}
            machine = tree['m_Controller']['m_StateMachineArray'][0]['data']
            states = controller['stateMachines'][0]['states']
            self.assertEqual(len(states), len(machine['m_StateConstantArray']), key)
            for state, raw in zip(states, machine['m_StateConstantArray']):
                data = raw['data']
                self.assertEqual(state['name'], tos[data['m_NameID']])
                self.assertEqual(state['nameId'], data['m_NameID'])
                self.assertEqual(state['speed'], data['m_Speed'])
                clip_ids = [node['data']['m_ClipID']
                            for bt in data['m_BlendTreeConstantArray'] for node in bt['data']['m_NodeArray']]
                self.assertEqual(state['clipIds'], clip_ids)
                for clip_id in clip_ids:
                    clip_path_id = controller['animationClips'][clip_id]
                    self.assertIn(int(clip_path_id), {int(c['pathId']) for c in document['animations']['clips']}, key)
            self.assertEqual(controller['stateMachines'][0]['defaultState'], machine['m_DefaultState'])
            # the animator component points at this controller and lives on the sprite GameObject
            (animator,) = document['objects']['animators']
            self.assertEqual(int(animator['controller']), controller_id)
            animator_go = int(animator['gameObject'])
            animator_tree = trees[animator_go][1]
            self.assertEqual(animator_tree['m_Name'], 'model')
            component_types = {c['type'] for c in next(go for go in document['objects']['gameObjects']
                                                       if int(go['pathId']) == animator_go)['components']}
            self.assertEqual(component_types, {'Transform', 'SpriteRenderer', 'Animator'})

    # ------------------------------------------------------------------- clips

    def test_skill1_clip_timing_and_sprite_keys_are_real(self) -> None:
        document = self.units['minigamespine_10000118_pixel']
        clips = {clip['name']: clip for clip in document['animations']['clips']}
        skill1 = clips['skill1']
        self.assertEqual(int(skill1['pathId']), -6997300521606275531)
        self.assertEqual(skill1['sampleRate'], 8.0)
        self.assertEqual(skill1['startTime'], 0.0)
        self.assertEqual(skill1['stopTime'], 0.875)
        self.assertEqual(skill1['duration'], 0.875)
        self.assertEqual(skill1['decodeStatus'], 'decoded')
        (curve,) = skill1['curves']
        self.assertEqual(curve['kind'], 'pptrSprite')
        self.assertEqual(curve['binding']['typeId'], 212)  # SpriteRenderer class id
        self.assertEqual(curve['binding']['path'], 0)  # animator's own GameObject ("model")
        self.assertEqual(curve['target']['resolution'], 'animatorGameObject')
        model_go = next(go for go in document['objects']['gameObjects'] if go['name'] == 'model')
        self.assertEqual(int(curve['target']['gameObject']), int(model_go['pathId']))
        self.assertEqual([k['time'] for k in curve['keys']], [0.0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75])
        self.assertEqual(curve['keys'][0]['rawTime'], NEG_FLT_MAX)
        self.assertTrue(curve['keys'][0]['clampedToStart'])
        mapping = [int(p) for p in skill1['pptrCurveMapping']]
        self.assertEqual(mapping, [-1919717925733692953, -9220094113737002391, 2644253242783901201,
                                   -7974147819265891344, -1377885268295860084, -4511955929668104030,
                                   -4597097467355631549])
        self.assertEqual([int(k['sprite']) for k in curve['keys']], mapping)
        self.assertEqual([k['spriteIndex'] for k in curve['keys']], list(range(7)))
        sprites = {int(s['pathId']): s for s in document['objects']['sprites']}
        for key_frame in curve['keys']:
            sprite = sprites[int(key_frame['sprite'])]
            self.assertEqual(key_frame['spriteName'], sprite['name'])
            self.assertEqual(key_frame['frame'], sprite['frame']['file'])
        idle = clips['idle']
        self.assertEqual(idle['stopTime'], 0.75)
        self.assertEqual(len(idle['curves'][0]['keys']), 6)
        self.assertEqual(clips['skill2']['stopTime'], 0.875)

    def test_all_clips_decode_against_raw_streamed_words(self) -> None:
        decoded = empty = 0
        for key in UNITS:
            document = self.units[key]
            trees = self.bundle_trees[key]
            bundle_clips = {pid: tree for pid, (kind, tree) in trees.items() if kind == 'AnimationClip'}
            clips = {int(clip['pathId']): clip for clip in document['animations']['clips']}
            self.assertEqual(set(clips), set(bundle_clips), key)
            for path_id, tree in bundle_clips.items():
                clip = clips[path_id]
                muscle = tree['m_MuscleClip']
                data = muscle['m_Clip']['data']
                self.assertEqual(clip['name'], tree['m_Name'])
                self.assertEqual(clip['sampleRate'], tree['m_SampleRate'])
                self.assertEqual(clip['startTime'], muscle['m_StartTime'])
                self.assertEqual(clip['stopTime'], muscle['m_StopTime'])
                self.assertEqual(clip['duration'], muscle['m_StopTime'] - muscle['m_StartTime'])
                self.assertEqual(clip['loopTime'], muscle['m_LoopTime'])
                streamed = data['m_StreamedClip']
                self.assertEqual(clip['clipData']['streamed']['words'], streamed['data'], f'{key}/{clip["name"]}')
                self.assertEqual(clip['clipData']['streamed']['curveCount'], streamed['curveCount'])
                self.assertEqual(clip['clipData']['dense']['frameCount'], data['m_DenseClip']['m_FrameCount'])
                self.assertEqual(clip['clipData']['dense']['curveCount'], data['m_DenseClip']['m_CurveCount'])
                self.assertEqual(clip['clipData']['dense']['sampleArray'], data['m_DenseClip']['m_SampleArray'])
                mapping = [p['m_PathID'] for p in tree['m_ClipBindingConstant']['pptrCurveMapping']]
                self.assertEqual([int(p) for p in clip['pptrCurveMapping']], mapping)
                bindings = tree['m_ClipBindingConstant']['genericBindings']
                if not bindings:
                    empty += 1
                    self.assertEqual(clip['decodeStatus'], 'empty', f'{key}/{clip["name"]}')
                    self.assertEqual(clip['curves'], [])
                    self.assertEqual(streamed['data'], [])
                    continue
                decoded += 1
                self.assertEqual(clip['decodeStatus'], 'decoded', f'{key}/{clip["name"]}')
                (binding,) = bindings
                self.assertEqual(binding['isPPtrCurve'], 1)
                (curve,) = clip['curves']
                # independently re-decode the raw words and compare key by key
                frames = parse_streamed(streamed['data'])
                expected = []
                for time, frame_keys in frames:
                    for curve_index, coeffs in frame_keys:
                        value = coeffs[3]
                        expected.append((max(time, muscle['m_StartTime']), time, int(round(value))))
                expected = [item for item in expected if math.isfinite(item[1])]
                self.assertEqual(len(curve['keys']), len(expected), f'{key}/{clip["name"]}')
                for key_frame, (time, raw_time, sprite_index) in zip(curve['keys'], expected):
                    self.assertEqual(key_frame['time'], time)
                    self.assertEqual(key_frame['rawTime'], raw_time)
                    self.assertEqual(key_frame['spriteIndex'], sprite_index)
                    self.assertEqual(int(key_frame['sprite']), mapping[sprite_index])
                    self.assertEqual(key_frame['clampedToStart'], raw_time != time)
                times = [k['time'] for k in curve['keys']]
                self.assertEqual(times, sorted(times), f'{key}/{clip["name"]}')
                self.assertLessEqual(times[-1], clip['stopTime'])
        self.assertEqual(decoded, 38)
        self.assertEqual(empty, 1)

    def test_empty_clip_is_reported_not_faked(self) -> None:
        document = self.units['minigamespine_20108_pixel']
        clips = {clip['name']: clip for clip in document['animations']['clips']}
        die = clips['die']
        self.assertEqual(die['decodeStatus'], 'empty')
        self.assertEqual(die['curves'], [])
        self.assertEqual(die['sampleRate'], 60.0)
        self.assertEqual(die['stopTime'], 1.0)
        self.assertEqual(die['clipData']['streamed']['words'], [])
        self.assertEqual(die['pptrCurveMapping'], [])
        self.assertIn('no curves', die['decodeNote'])
        statuses = {clip['decodeStatus'] for doc in self.units.values() for clip in doc['animations']['clips']}
        self.assertLessEqual(statuses, {'decoded', 'empty'})

    def test_frame_counts_are_not_uniform_across_clips(self) -> None:
        counts = {
            (key, clip['name']): len(clip['curves'][0]['keys'])
            for key, doc in self.units.items() for clip in doc['animations']['clips'] if clip['curves']
        }
        self.assertEqual(counts[('minigamespine_10000118_pixel', 'skill1')], 7)
        self.assertEqual(counts[('minigamespine_10000118_pixel', 'idle')], 6)
        self.assertEqual(counts[('minigamespine_20302_pixel', 'skill1')], 10)
        self.assertEqual(counts[('minigamespine_20010_pixel', 'run')], 4)
        self.assertEqual(counts[('minigamespine_20506_pixel', 'die')], 8)
        self.assertGreater(len(set(counts.values())), 3)

    # ------------------------------------------------------------------ maps

    def test_maps_match_bundles(self) -> None:
        for key, md5 in MAPS.items():
            document = self.maps[key]
            trees = self.bundle_trees[key]
            self.assertEqual(document['kind'], 'map')
            self.assertEqual(document['bundle']['originalMd5'], md5)
            (sprite,) = document['objects']['sprites']
            self.assertEqual(sprite['pixelsToUnits'], 75.0)
            self.assertEqual(sprite['rect'], {'x': 0.0, 'y': 0.0, 'width': 1668.0, 'height': 1004.0})
            self.assertEqual(sprite['pivot'], {'x': 0.5, 'y': 0.5})
            (renderer,) = document['objects']['spriteRenderers']
            self.assertEqual(int(renderer['sprite']), int(sprite['pathId']))
            self.assertEqual(renderer['size']['x'], f32(22.24))
            self.assertEqual(renderer['size']['y'], f32(13.386666297912598))
            (texture,) = document['objects']['textures']
            self.assertEqual((texture['width'], texture['height']), (1668, 1004))
            png = NATIVE_DIR / sprite['frame']['file']
            self.assertEqual(sha(png), sprite['frame']['sha256'])
            self.assertEqual(png_size(png), (1668, 1004))
            self.assertEqual(document['animations']['clips'], [])

    # -------------------------------------------------------------- closure etc.

    def test_reference_closure_inside_every_prefab(self) -> None:
        for key in list(UNITS) + list(MAPS):
            document = self.units.get(key) or self.maps.get(key)
            objects = document['objects']
            sprite_ids = {s['pathId'] for s in objects['sprites']}
            texture_ids = {t['pathId'] for t in objects['textures']}
            go_ids = {go['pathId'] for go in objects['gameObjects']}
            transform_ids = {t['pathId'] for t in objects['transforms']}
            clip_ids = {c['pathId'] for c in document['animations']['clips']}
            for sprite in objects['sprites']:
                self.assertIn(sprite['texture'], texture_ids, key)
            for renderer in objects['spriteRenderers']:
                self.assertIn(renderer['sprite'], sprite_ids, key)
                self.assertIn(renderer['gameObject'], go_ids, key)
                for material in renderer['materials']:
                    if material['fileId'] == 0:
                        continue
                    resolved = material.get('resolved')
                    self.assertIsNotNone(resolved, f'{key} external material {material}')
                    # the only materials referenced by the 16 prefabs, verified by CAB scan:
                    # Sprites-Default_Shadow for units/wall, background for the maps
                    self.assertIn(resolved['objectName'], {'Sprites-Default_Shadow', 'background'})
                    self.assertEqual(resolved['bundle'], EXTERNAL_MATERIAL_BUNDLES[resolved['objectName']])
            for animator in objects['animators']:
                self.assertIn(animator['controller'], {c['pathId'] for c in objects['animatorControllers']})
            for clip in document['animations']['clips']:
                for curve in clip['curves']:
                    for key_frame in curve['keys']:
                        self.assertIn(key_frame['sprite'], sprite_ids, f'{key}/{clip["name"]}')
                        self.assertIn(key_frame['spriteIndex'], range(len(clip['pptrCurveMapping'])))
            for transform in objects['transforms']:
                self.assertIn(transform['gameObject'], go_ids)
                if transform['parent'] != '0':
                    self.assertIn(transform['parent'], transform_ids)
            self.assertIn(document['prefab']['rootGameObject'], go_ids)
            self.assertIn(document['prefab']['rootTransform'], transform_ids)

    def test_assets_map_cross_check(self) -> None:
        entries = load(ASSETS_MAP)
        by_path_id = {}
        for entry in entries:
            by_path_id.setdefault(int(entry['PathID']), entry)
        for key in list(UNITS) + list(MAPS):
            document = self.units.get(key) or self.maps.get(key)
            container = document['prefab']['container']
            for sprite in objects_sprites(document):
                entry = by_path_id.get(int(sprite['pathId']))
                self.assertIsNotNone(entry, f'{key}/{sprite["name"]} missing from assets_map')
                self.assertEqual(entry['Name'], sprite['name'])
                self.assertEqual(entry['Type'], 'Sprite')
                self.assertEqual(entry['Container'], container)
            for clip in document['animations']['clips']:
                entry = by_path_id.get(int(clip['pathId']))
                self.assertIsNotNone(entry, f'{key}/{clip["name"]} missing from assets_map')
                self.assertEqual(entry['Name'], clip['name'])
                self.assertEqual(entry['Type'], 'AnimationClip')
                self.assertEqual(entry['Container'], container)

    def test_unity_crc32_path_binding_convention(self) -> None:
        # binding path 0 hashes the empty relative path; TOS ids are plain crc32
        document = self.units['minigamespine_10000118_pixel']
        controller = document['objects']['animatorControllers'][0]
        tos = {int(k): v for k, v in controller['tos'].items()}
        self.assertEqual(tos[0], '')
        self.assertEqual(zlib.crc32(b'idle'), 3693393173)
        self.assertEqual(tos[zlib.crc32(b'idle')], 'idle')
        self.assertEqual(tos[zlib.crc32(b'minigamespine_10000118_pixel_ani.skill1')],
                         'minigamespine_10000118_pixel_ani.skill1')

    def test_rerun_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out1 = Path(tmp) / 'a'
            out2 = Path(tmp) / 'b'
            for out in (out1, out2):
                subprocess.run(
                    [sys.executable, '-B', str(SCRIPT), '--source', str(RESEARCH), '--out', str(out)],
                    check=True, capture_output=True, text=True, cwd=APP,
                )
            files1 = {p.relative_to(out1): p for p in out1.rglob('*') if p.is_file()}
            files2 = {p.relative_to(out2): p for p in out2.rglob('*') if p.is_file()}
            self.assertEqual(set(files1), set(files2))
            for rel, p1 in files1.items():
                self.assertEqual(sha(p1), sha(files2[rel]), str(rel))
            for rel, p1 in files1.items():
                public = NATIVE_DIR / rel
                self.assertTrue(public.is_file(), str(rel))
                self.assertEqual(sha(p1), sha(public), str(rel))


def objects_sprites(document: dict) -> list[dict]:
    return document['objects']['sprites']


class NativeCurveDecoderTest(unittest.TestCase):
    """Guard the DenseClip/ConstantClip branches no bundle in this dataset exercises."""

    @staticmethod
    def words_of(*floats: float) -> list[int]:
        return [struct.unpack('<I', struct.pack('<f', f))[0] for f in floats]

    def test_dense_clip_decodes_per_frame_samples(self) -> None:
        from scripts.native.curves import decode_clip
        tree = {
            'm_MuscleClip': {'m_StartTime': 0.0, 'm_StopTime': 0.25,
                             'm_Clip': {'data': {
                                 'm_StreamedClip': {'data': [], 'curveCount': 0},
                                 'm_DenseClip': {'m_FrameCount': 3, 'm_CurveCount': 1,
                                                 'm_SampleRate': 8.0, 'm_BeginTime': 0.0,
                                                 'm_SampleArray': [0.0, 1.0, 2.0]},
                                 'm_ConstantClip': {'data': []},
                             }}},
            'm_ClipBindingConstant': {
                'genericBindings': [{'path': 0, 'attribute': 0, 'script': {'m_FileID': 0, 'm_PathID': 0},
                                     'typeID': 212, 'customType': 23, 'isPPtrCurve': 1}],
                'pptrCurveMapping': [{'m_FileID': 0, 'm_PathID': 11}, {'m_FileID': 0, 'm_PathID': 22},
                                     {'m_FileID': 0, 'm_PathID': 33}],
            },
        }
        decoded = decode_clip(tree)
        self.assertEqual(decoded['decodeStatus'], 'decoded')
        (curve,) = decoded['curves']
        self.assertEqual(curve['source'], 'dense')
        self.assertEqual([(k['time'], k['spriteIndex']) for k in curve['keys']],
                         [(0.0, 0), (0.125, 1), (0.25, 2)])

    def test_constant_clip_decodes_single_value(self) -> None:
        from scripts.native.curves import decode_clip
        tree = {
            'm_MuscleClip': {'m_StartTime': 0.0, 'm_StopTime': 1.0,
                             'm_Clip': {'data': {
                                 'm_StreamedClip': {'data': [], 'curveCount': 0},
                                 'm_DenseClip': {'m_FrameCount': 0, 'm_CurveCount': 0,
                                                 'm_SampleRate': 0.0, 'm_BeginTime': 0.0,
                                                 'm_SampleArray': []},
                                 'm_ConstantClip': {'data': [1.0]},
                             }}},
            'm_ClipBindingConstant': {
                'genericBindings': [{'path': 0, 'attribute': 0, 'script': {'m_FileID': 0, 'm_PathID': 0},
                                     'typeID': 212, 'customType': 23, 'isPPtrCurve': 1}],
                'pptrCurveMapping': [{'m_FileID': 0, 'm_PathID': 11}, {'m_FileID': 0, 'm_PathID': 22}],
            },
        }
        decoded = decode_clip(tree)
        self.assertEqual(decoded['decodeStatus'], 'decoded')
        (curve,) = decoded['curves']
        self.assertEqual(curve['source'], 'constant')
        self.assertEqual([(k['time'], k['spriteIndex']) for k in curve['keys']], [(0.0, 1)])

    def test_out_of_range_sprite_index_is_unsupported_not_clamped(self) -> None:
        from scripts.native.curves import decode_clip
        words = ([struct.unpack('<I', struct.pack('<f', -3.4028234663852886e+38))[0], 1, 0]
                 + self.words_of(0.0, 0.0, 0.0, 5.0)
                 + [struct.unpack('<I', struct.pack('<f', float('inf')))[0], 0])
        tree = {
            'm_MuscleClip': {'m_StartTime': 0.0, 'm_StopTime': 0.5,
                             'm_Clip': {'data': {
                                 'm_StreamedClip': {'data': words, 'curveCount': 1},
                                 'm_DenseClip': {'m_FrameCount': 0, 'm_CurveCount': 0,
                                                 'm_SampleRate': 0.0, 'm_BeginTime': 0.0,
                                                 'm_SampleArray': []},
                                 'm_ConstantClip': {'data': []},
                             }}},
            'm_ClipBindingConstant': {
                'genericBindings': [{'path': 0, 'attribute': 0, 'script': {'m_FileID': 0, 'm_PathID': 0},
                                     'typeID': 212, 'customType': 23, 'isPPtrCurve': 1}],
                'pptrCurveMapping': [{'m_FileID': 0, 'm_PathID': 11}],
            },
        }
        decoded = decode_clip(tree)
        self.assertEqual(decoded['decodeStatus'], 'partial-unsupported')
        self.assertEqual(decoded['curves'][0]['keys'], [])
        self.assertIn('outside pptrCurveMapping', decoded['decodeNote'])
        # the raw payload survives verbatim for audit
        self.assertEqual(decoded['clipData']['streamed']['words'], words)


if __name__ == '__main__':
    unittest.main()

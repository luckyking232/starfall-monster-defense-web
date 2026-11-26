"""The battle and loading prefabs must resolve their original geometry and GLES materials."""
import hashlib
import json
from pathlib import Path
import re
import unittest

APP = Path(__file__).resolve().parents[2]
ROOT = APP / 'public' / 'assets' / 'effects'


class MeshProjectileInputs(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = json.loads((ROOT / 'mesh-effects.json').read_bytes())

    def test_opening_attacks_keep_their_mesh_particle_layers(self):
        expected = {f'minigame022_{unit}_skill1_bullet.prefab' for unit in (10000118, 10000134)}
        attacks = {path.rsplit('/', 1)[-1]: layers for path, layers in self.catalog['prefabs'].items()}
        self.assertLessEqual(expected, attacks.keys())
        for layers in (attacks[name] for name in expected):
            self.assertEqual(len(layers), 3)
            for layer in layers:
                mesh = self.catalog['meshes'][layer['mesh']]
                self.assertTrue(mesh['indices'])
                self.assertEqual(len(mesh['vertices']) % 3, 0)
                self.assertLess(max(mesh['indices']), len(mesh['vertices']) // 3)
                self.assertEqual(layer['streams'], [0, 1, 3, 4, 5, 34])
                self.assertEqual(len(layer['transform']), 16)

    def test_dina_boulder_keeps_original_mesh_texture_and_particle_timing(self):
        prefabs = {path.rsplit('/', 1)[-1]: layers for path, layers in self.catalog['prefabs'].items()}
        boulder, smoke = prefabs['minigame022_10000134_skill3_bullet.prefab']
        texture = lambda layer: self.catalog['textures'][self.catalog['materials'][layer['material']]['textures']['_MainTex']]['name']
        self.assertEqual(texture(boulder), 'Minigame022_yunshi')
        self.assertEqual(texture(smoke), 'hym_zj_smoke_005')
        self.assertAlmostEqual(boulder['particle']['spin'], -12.217304, places=5)
        self.assertEqual(boulder['particle']['life'], [1, 1])
        self.assertEqual(boulder['particle']['hold'], True)
        self.assertEqual(boulder['particle']['alpha'][-1][1], 1)
        self.assertEqual(smoke['particle']['rate'], 5)
        self.assertEqual(smoke['particle']['tiles'][:2], [4, 4])
        self.assertEqual(smoke['particle']['velocity'], [-1, 0, 0])

    def test_dina_poison_summon_keeps_its_native_layers(self):
        prefabs = {path.rsplit('/', 1)[-1]: layers for path, layers in self.catalog['prefabs'].items()}
        layers = prefabs['minigame022_10000134_skill2_summon.prefab']
        self.assertEqual(len(layers), 13)
        self.assertEqual(sum('tiles' in layer['particle'] for layer in layers), 1)

    def test_original_shader_variants_bind_full_texture_inputs(self):
        for material in self.catalog['materials'].values():
            program = self.catalog['shaders'][material['shader']]
            self.assertTrue(program['vertex'].startswith('#version 100'))
            self.assertIn('gl_Position', program['vertex'])
            self.assertIn('texture2D', program['fragment'])
            for sampler in re.findall(r'\buniform\s+(?:(?:highp|mediump|lowp)\s+)?sampler2D\s+(\w+)', program['fragment']):
                target = material['textures'][sampler]
                self.assertTrue(target in ('white', 'black') or target in self.catalog['textures'])
            for key in material['textures'].values():
                if key not in self.catalog['textures']:
                    continue
                texture = self.catalog['textures'][key]
                self.assertEqual(hashlib.sha256((ROOT / texture['url']).read_bytes()).hexdigest(), texture['sha256'])

    def test_original_call_prefabs_keep_all_enabled_layers_and_loading_camera(self):
        expected = {
            'fx_ui_loading': 4, 'minigame022_10000101_skill1_bullet': 2, 'minigame022_10000101_skill2_buff': 1,
            'minigame022_10000101_skill3_summon': 6, 'minigame022_10000104_skill1_bullet': 7,
            'minigame022_10000104_skill2_bullet': 4, 'minigame022_10000104_skill3_summon': 3,
            'minigame022_10000118_frost': 1, 'minigame022_10000118_skill1_bullet': 3,
            'minigame022_10000118_skill2_bullet': 5, 'minigame022_10000118_skill3': 8,
            'minigame022_10000134_skill1_bullet': 3, 'minigame022_10000134_skill2_summon': 13,
            'minigame022_10000134_skill3_bullet': 2, 'minigame022_10000198_skill1_bullet': 6,
            'minigame022_10000198_skill2': 15, 'minigame022_10000198_skill3_buff': 3,
            'minigame022_10000198_skill3_heal': 5, 'minigame022_20010_skill1_bullet': 1,
            'minigame022_20108_skill1_bullet': 1, 'minigame022_20306_skill1_bullet': 1,
            'minigame022_20411_skill1_bullet': 1, 'minigame022_monster_appear': 3,
            'minigame022_slowmotion_buff': 2,
        }
        loaded = {Path(path).stem: len(layers) for path, layers in self.catalog['prefabs'].items()}
        self.assertEqual(loaded, expected)
        self.assertEqual(sum(loaded.values()), 100)
        camera, = self.catalog['cameras'].values()
        self.assertEqual(camera['fov'], 24)
        self.assertAlmostEqual(camera['position'][2], -23.52314949)
        trail_layers = [layer for layers in self.catalog['prefabs'].values() for layer in layers if 'trailMaterial' in layer]
        self.assertEqual(len(trail_layers), 4)
        frost, = [layers[0] for path, layers in self.catalog['prefabs'].items() if path.endswith('10000118_frost.prefab')]
        self.assertEqual(frost['particle']['custom'][1][0]['keys'][0][1], -1)
        self.assertIn('lifetimes', json.loads((ROOT / 'manifest.json').read_bytes()))

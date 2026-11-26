"""Verify decoded original FGUI packages against the official FairyGUI format.

The generated JSON in public/assets/fgui/ must carry the real package index,
string-table resolved names, component trees and atlas UVs decoded from the
original ``*_fui.bytes`` (FGUI version 6, big endian) following the official
FairyGUI-unity ``UIPackage.LoadPackage`` format. Expected literals below were
taken from the original bytes and from the original Lua ByName accessors
(``uis.Main.StartBtn`` etc.), never from screenshots.
"""
from __future__ import annotations

import hashlib
import json
import os
import struct
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

APP = Path(__file__).resolve().parents[2]
WORKSPACE = APP.parents[2]
RESEARCH = Path(os.environ.get('STARFALL_RESEARCH_DIR', WORKSPACE / 'server-exports' / 'monster-defense-research-20261125'))
UI_DIR = RESEARCH / 'assets' / 'exported' / 'assets' / 'fairygui' / 'ui'
SPRITES_DIR = RESEARCH / 'assets' / 'fgui-sprites-by-id'
FGUI_DIR = APP / 'public' / 'assets' / 'fgui'
MANIFEST = FGUI_DIR / 'fgui-manifest.json'

PACKAGES = {
    'ActivityDungeon1017': {'id': 'aonql508', 'atlases': 11, 'items': 507, 'components': 213},
    'ActivityDungeon1017Battle': {'id': '1hbjipo6', 'atlases': 1, 'items': 141, 'components': 55},
    'CommonResource': {'id': 'tey9g4p9', 'atlases': 4, 'items': 615, 'components': 150},
    'Loading': {'id': 'sjqdmk59', 'atlases': 0, 'items': 4, 'components': 4},
}


def source_fui(name: str) -> Path:
    return (APP / 'local-inputs' / 'fgui' if name == 'Loading' else UI_DIR) / f'{name}_fui.bytes'


def load(path: Path) -> dict:
    return json.loads(path.read_bytes().decode('utf-8'))


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def png_size(path: Path) -> tuple[int, int]:
    data = path.read_bytes()
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise AssertionError(f'{path} is not a PNG')
    return struct.unpack('>II', data[16:24])


def child(node: dict, name: str) -> dict:
    for c in node.get('children', []):
        if c.get('name') == name:
            return c
    raise AssertionError(f'child {name!r} not found in {node.get("name")!r}')


def component(pkg: dict, name: str) -> dict:
    cid = pkg['componentIndex'].get(name)
    if cid is None:
        raise AssertionError(f'component {name!r} not indexed')
    return pkg['components'][cid]


@unittest.skipUnless(RESEARCH.is_dir(), f'research directory missing: {RESEARCH}')
class FguiPackageTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if not MANIFEST.is_file():
            raise AssertionError(f'generated FGUI manifest missing: {MANIFEST} (run scripts/prepare_fgui.py)')
        cls.manifest = load(MANIFEST)
        cls.pkgs = {name: load(FGUI_DIR / f'{name}.json') for name in PACKAGES}

    # -- package header / provenance -------------------------------------

    def test_package_headers_match_original_bytes(self) -> None:
        for name, want in PACKAGES.items():
            pkg = self.pkgs[name]
            self.assertEqual(pkg['schema'], 'starfall-fgui-package/1')
            self.assertEqual(pkg['package']['id'], want['id'], name)
            self.assertEqual(pkg['package']['name'], name)
            self.assertEqual(pkg['package']['version'], 6, name)
            self.assertFalse(pkg['package']['compressed'], name)
            self.assertEqual(pkg['source']['format']['magic'], 'FGUI')
            self.assertEqual(pkg['source']['format']['endianness'], 'big')
            self.assertIn('UIPackage.cs', pkg['source']['format']['referenceUrl'])
            raw = source_fui(name).read_bytes()
            self.assertEqual(raw[:4], b'FGUI', name)
            self.assertEqual(struct.unpack('>i', raw[4:8])[0], 6, name)

    def test_source_hash_and_copied_bytes(self) -> None:
        for name in PACKAGES:
            pkg = self.pkgs[name]
            src = source_fui(name)
            self.assertEqual(pkg['source']['file'], f'{name}_fui.bytes')
            self.assertEqual(pkg['source']['sha256'], sha(src), name)
            self.assertEqual(pkg['source']['size'], src.stat().st_size, name)
            copied = FGUI_DIR / f'{name}_fui.bytes'
            self.assertTrue(copied.is_file(), name)
            self.assertEqual(sha(copied), pkg['source']['sha256'], name)

    def test_item_and_component_counts(self) -> None:
        for name, want in PACKAGES.items():
            pkg = self.pkgs[name]
            self.assertEqual(len(pkg['items']), want['items'], name)
            self.assertEqual(len(pkg['components']), want['components'], name)
            self.assertEqual(len(pkg['componentIndex']), want['components'], name)
            for cname, cid in pkg['componentIndex'].items():
                self.assertEqual(pkg['components'][cid]['name'], cname)

    # -- original Lua ByName access paths ---------------------------------

    def test_start_page_main_startbtn(self) -> None:
        # Activity17MiniGame2MainWindow: uis.Main.StartBtn (MiniGame2Window > Main > MiniGame2)
        pkg = self.pkgs['ActivityDungeon1017']
        window = component(pkg, 'MiniGame2Window')
        self.assertEqual((window['width'], window['height']), (1334, 750))
        main = child(window, 'Main')
        self.assertEqual(main['objectType'], 'Component')
        self.assertEqual(main['refName'], 'MiniGame2')
        self.assertEqual(main['src'], 'q3oh4o')
        main_com = pkg['components'][main['src']]
        self.assertEqual((main_com['width'], main_com['height']), (1334, 750))
        start = child(main_com, 'StartBtn')
        self.assertEqual(start['objectType'], 'Button')
        self.assertEqual((start['x'], start['y']), (1036, 647))
        self.assertEqual(start['src'], 'q3oh3q')
        self.assertEqual(start['refName'], 'MiniMain2_StartBtn')
        self.assertEqual(start['refUrl'], 'ui://aonql508q3oh3q')
        self.assertTrue(start['visible'])
        self.assertTrue(start['touchable'])
        self.assertEqual(start['alpha'], 1.0)
        self.assertEqual(start['rotation'], 0.0)
        # siblings used by the same window script
        self.assertEqual(child(main_com, 'Top')['refName'], 'MiniMain2_Top')
        self.assertEqual(child(main_com, 'Botton')['refName'], 'MiniMain2_Botton')
        self.assertEqual((child(main_com, 'Botton')['x'], child(main_com, 'Botton')['y']), (0, 600))
        self.assertEqual((child(main_com, 'ReturnBtn')['x'], child(main_com, 'ReturnBtn')['y']), (16, 11))
        back = child(main_com, 'BackGround')
        self.assertEqual(back['packageId'], 'tey9g4p9')  # CommonResource
        self.assertEqual(back['src'], 'kszmrlya')
        # the button component itself keeps its original controller pages
        start_btn = component(pkg, 'MiniMain2_StartBtn')
        self.assertEqual((start_btn['width'], start_btn['height']), (222, 64))
        self.assertEqual(start_btn['extension']['buttonMode'], 'Common')
        [ctrl] = start_btn['controllers']
        self.assertEqual(ctrl['name'], 'button')
        self.assertEqual([p['name'] for p in ctrl['pages']], ['up', 'down'])

    def test_stage_select_main_tipslist(self) -> None:
        # Activity17MiniGameChoice2Window: uis.Main.TipsList (MiniGameChoice2Window > Main > MiniGameChoice2)
        pkg = self.pkgs['ActivityDungeon1017']
        window = component(pkg, 'MiniGameChoice2Window')
        main = child(window, 'Main')
        self.assertEqual(main['refName'], 'MiniGameChoice2')
        main_com = pkg['components'][main['src']]
        tips = child(main_com, 'TipsList')
        self.assertEqual(tips['objectType'], 'List')
        self.assertEqual((tips['x'], tips['y']), (0, 0))
        self.assertEqual((tips['width'], tips['height']), (1334, 750))
        self.assertEqual(tips['layout'], 'SingleRow')
        self.assertEqual(tips['overflow'], 'Scroll')
        self.assertEqual(tips['scroll']['scrollType'], 'Horizontal')
        self.assertEqual(tips['defaultItem'], 'ui://aonql508q3ohh5')
        self.assertEqual(tips['columnGap'], 36)
        self.assertEqual(tips['lineGap'], 20)
        self.assertTrue(tips['autoResizeItem'])
        self.assertTrue(tips['scrollItemToViewOnClick'])
        # defaultItem resolves to the original MiniGameChoice_Map component
        item = pkg['items']['q3ohh5']
        self.assertEqual(item['name'], 'MiniGameChoice_Map')
        self.assertEqual(item['type'], 'Component')

    def test_battle_ui_main_top_pausebtn(self) -> None:
        # BattleUIWindow > Main > BattleUI > Top > BattleTop > PauseBtn
        pkg = self.pkgs['ActivityDungeon1017Battle']
        window = component(pkg, 'BattleUIWindow')
        self.assertEqual((window['width'], window['height']), (1334, 750))
        main = child(window, 'Main')
        self.assertEqual(main['refName'], 'BattleUI')
        battle = pkg['components'][main['src']]
        self.assertEqual((battle['width'], battle['height']), (1334, 750))
        top = child(battle, 'Top')
        self.assertEqual(top['refName'], 'BattleTop')
        self.assertEqual((top['x'], top['y']), (0, 0))
        top_com = pkg['components'][top['src']]
        pause = child(top_com, 'PauseBtn')
        self.assertEqual(pause['objectType'], 'Button')
        self.assertEqual((pause['x'], pause['y']), (133, 17))
        self.assertEqual(pause['refName'], 'PauseBtn')
        pause_btn = component(pkg, 'PauseBtn')
        self.assertEqual((pause_btn['width'], pause_btn['height']), (60, 60))
        self.assertEqual([p['name'] for p in pause_btn['controllers'][0]['pages']], ['up', 'down'])

    def test_skill_choice_main_time_surebtn(self) -> None:
        # SkillChoiceWindow > Main > SkillChoice > Time > SkillChoice_Time > SureBtn
        pkg = self.pkgs['ActivityDungeon1017Battle']
        window = component(pkg, 'SkillChoiceWindow')
        main = child(window, 'Main')
        self.assertEqual(main['refName'], 'SkillChoice')
        choice = pkg['components'][main['src']]
        self.assertEqual((choice['width'], choice['height']), (1334, 750))
        time_node = child(choice, 'Time')
        self.assertEqual(time_node['refName'], 'SkillChoice_Time')
        self.assertEqual((time_node['x'], time_node['y']), (207, 629))
        time_com = pkg['components'][time_node['src']]
        self.assertEqual((time_com['width'], time_com['height']), (920, 50))
        sure = child(time_com, 'SureBtn')
        self.assertEqual(sure['objectType'], 'Button')
        self.assertEqual((sure['x'], sure['y']), (342, 0))
        self.assertEqual(sure['refName'], 'SkillChoice_SureBtn')
        bar1 = child(time_com, 'Time1ProgressBar')
        self.assertEqual(bar1['objectType'], 'ProgressBar')
        self.assertEqual((bar1['x'], bar1['y']), (0, 24))
        self.assertEqual((bar1['value'], bar1['max'], bar1['min']), (100, 100, 0))
        bar2 = child(time_com, 'Time2ProgressBar')
        self.assertEqual((bar2['x'], bar2['y']), (616, 24))
        # skill choice list itself
        tips = child(choice, 'TipsList')
        self.assertEqual(tips['objectType'], 'List')
        self.assertEqual((tips['x'], tips['y']), (207, 105))
        self.assertEqual((tips['width'], tips['height']), (920, 500))
        self.assertEqual(tips['layout'], 'SingleRow')
        self.assertEqual(tips['align'], 'Center')
        self.assertEqual(tips['columnGap'], 40)
        self.assertEqual(tips['defaultItem'], 'ui://1hbjipo6gevl3i')
        popup = child(choice, 'PopupBg')
        self.assertEqual(popup['packageId'], 'tey9g4p9')

    # -- atlas UVs ----------------------------------------------------------

    def test_sprite_uv_literals(self) -> None:
        a = self.pkgs['ActivityDungeon1017']['items']
        self.assertEqual(
            {k: a['q3ohbl']['sprite'][k] for k in ('atlasFile', 'x', 'y', 'width', 'height', 'rotated')},
            {'atlasFile': 'ActivityDungeon1017_atlas0.png', 'x': 1, 'y': 1, 'width': 195, 'height': 195, 'rotated': False},
        )
        self.assertEqual(
            {k: a['t9ozim']['sprite'][k] for k in ('atlasFile', 'x', 'y', 'width', 'height', 'rotated')},
            {'atlasFile': 'ActivityDungeon1017_atlas0.png', 'x': 1, 'y': 198, 'width': 112, 'height': 191, 'rotated': True},
        )
        self.assertEqual(a['t9ozim']['sprite']['originalSize'], [191, 112])  # rotated swaps w/h
        b = self.pkgs['ActivityDungeon1017Battle']['items']
        self.assertEqual(
            {k: b['m1bt4r']['sprite'][k] for k in ('atlasFile', 'x', 'y', 'width', 'height', 'rotated')},
            {'atlasFile': 'ActivityDungeon1017Battle_atlas0.png', 'x': 1670, 'y': 0, 'width': 132, 'height': 793, 'rotated': True},
        )

    def test_every_sprite_uv_matches_independent_research_decode(self) -> None:
        # assets/fgui-sprites-by-id/*/by-id-manifest.json was produced by an
        # independent research tool; every UV must agree with this decode.
        for name, package in PACKAGES.items():
            if package['atlases'] == 0:
                continue
            manifest = load(SPRITES_DIR / name / 'by-id-manifest.json')
            items = self.pkgs[name]['items']
            self.assertEqual(len(manifest), sum(1 for i in items.values() if 'sprite' in i), name)
            for entry in manifest:
                sprite = items[entry['sprite_id']]['sprite']
                self.assertEqual(sprite['atlasFile'], entry['atlas_file'], entry['sprite_id'])
                self.assertEqual(sprite['x'], entry['x'], entry['sprite_id'])
                self.assertEqual(sprite['y'], entry['y'], entry['sprite_id'])
                self.assertEqual(sprite['width'], entry['width'], entry['sprite_id'])
                self.assertEqual(sprite['height'], entry['height'], entry['sprite_id'])
                self.assertEqual(sprite['rotated'], entry['rotated'], entry['sprite_id'])

    def test_atlas_files_copied_byte_exact(self) -> None:
        for name, want in PACKAGES.items():
            pkg = self.pkgs[name]
            self.assertEqual(len(pkg['atlases']), want['atlases'], name)
            referenced = {i['sprite']['atlasFile'] for i in pkg['items'].values() if 'sprite' in i}
            self.assertEqual(referenced, {a['file'] for a in pkg['atlases'].values()}, name)
            for atlas in pkg['atlases'].values():
                copied = FGUI_DIR / atlas['file']
                self.assertTrue(copied.is_file(), atlas['file'])
                src = UI_DIR / atlas['file']
                self.assertEqual(sha(copied), sha(src), atlas['file'])
                self.assertEqual(atlas['sha256'], sha(src), atlas['file'])
                self.assertEqual((atlas['width'], atlas['height']), png_size(src), atlas['file'])

    # -- referential integrity for the Phaser host -------------------------

    def test_all_referenced_resources_resolve(self) -> None:
        for name, pkg in self.pkgs.items():
            dep_ids = {d['id'] for d in pkg['package']['dependencies']}
            for comp in pkg['components'].values():
                for node in self.walk(comp):
                    src = node.get('src')
                    pkg_id = node.get('packageId')
                    if src is None:
                        continue
                    if pkg_id is None:
                        self.assertIn(src, pkg['items'], f'{name}:{comp["name"]}:{node["name"]}')
                    else:
                        self.assertIn(pkg_id, dep_ids, f'{name}:{comp["name"]}:{node["name"]}')
                        if pkg_id in {p['package']['id'] for p in self.pkgs.values()}:
                            other = next(p for p in self.pkgs.values() if p['package']['id'] == pkg_id)
                            self.assertIn(src, other['items'], f'{name}:{comp["name"]}:{node["name"]}')
                    if node.get('refUrl'):
                        self.assertTrue(node['refUrl'].startswith('ui://'))
                    default_item = node.get('defaultItem')
                    if default_item:
                        self.assertTrue(default_item.startswith('ui://'))
                        item_id = default_item[len('ui://') + len(pkg['package']['id']):]
                        self.assertIn(item_id, pkg['items'], f'{name}:{comp["name"]}:{node["name"]}')
            for item in pkg['items'].values():
                if 'sprite' in item:
                    self.assertIn(item['sprite']['atlasId'], pkg['items'], item['id'])
                    self.assertEqual(pkg['items'][item['sprite']['atlasId']]['type'], 'Atlas')

    def walk(self, node: dict):
        yield node
        for c in node.get('children', []):
            yield from self.walk(c)

    def test_cross_package_component_types_resolve(self) -> None:
        # UIPackage.GetItem + UIObjectFactory.NewObject(pi) ignore the declared
        # child type byte: a child referencing CommonResource's Button item must
        # come out as objectType Button, not the declared Component byte.
        main_pkg = self.pkgs['ActivityDungeon1017']
        common = self.pkgs['CommonResource']
        self.assertEqual(common['items']['wi4irlyb']['objectType'], 'Button')
        challenge = component(main_pkg, 'Challenge')
        back = child(challenge, 'ReturnBtn')
        self.assertEqual(back['packageId'], 'tey9g4p9')
        self.assertEqual(back['src'], 'wi4irlyb')
        self.assertEqual(back['objectType'], 'Button')
        self.assertEqual(back['refName'], 'ReturnBtn')
        self.assertEqual(back['refUrl'], 'ui://tey9g4p9wi4irlyb')

    # -- controllers / transitions ------------------------------------------

    def test_controllers_and_transitions_decoded(self) -> None:
        battle = self.pkgs['ActivityDungeon1017Battle']
        choice = component(battle, 'SkillChoice')
        self.assertEqual([t['name'] for t in choice['transitions']], ['in', 'out'])
        trans_in = choice['transitions'][0]
        self.assertEqual(len(trans_in['items']), 6)
        first = trans_in['items'][0]
        self.assertEqual(first['type'], 'Alpha')
        self.assertEqual(first['time'], 0.0)
        # target index resolved to the original child id/name
        self.assertEqual(first['targetName'], 'PopupBg')
        self.assertEqual(first['targetId'], child(choice, 'PopupBg')['id'])
        ui = component(battle, 'BattleUI')
        self.assertEqual([t['name'] for t in ui['transitions']], ['up'])
        # controller action (Passport_TabBtn button controller plays transitions)
        main_pkg = self.pkgs['ActivityDungeon1017']
        tab = component(main_pkg, 'Passport_TabBtn')
        [ctrl] = [c for c in tab['controllers'] if c['name'] == 'button']
        plays = [a for a in ctrl['actions'] if a['type'] == 'PlayTransition']
        self.assertEqual(plays[0]['transitionName'], 'up')
        self.assertEqual(plays[0]['fromPage'], ['0'])
        self.assertEqual(plays[0]['toPage'], ['1', '3'])
        self.assertEqual(plays[0]['playTimes'], 1)

    # -- honesty about what is not decoded ----------------------------------

    def test_battle_bitmap_font_glyphs_come_from_original_image_items(self) -> None:
        from scripts.fgui.decode import build_package_document
        from scripts.fgui.package import load_package

        source = UI_DIR / 'ActivityDungeon1017Battle_fui.bytes'
        document = build_package_document(load_package(source), source.name, sha(source), source.stat().st_size)
        damage = document['items']['gevl1z']['bitmapFont']
        self.assertEqual(damage['size'], 23)
        self.assertFalse(damage['resizable'])
        self.assertEqual(set(damage['glyphs']), set('0123456789'))
        self.assertEqual(damage['glyphs']['1'], {'image': 'gevl1p', 'x': 0, 'y': 0, 'advance': 23})
        self.assertEqual(document['items']['gevl20']['bitmapFont']['glyphs']['i']['image'], 'gevl1y')
        self.assertEqual(document['items']['mj1454']['bitmapFont']['size'], 23)

    def test_generator_includes_original_atlas_free_loading_package(self) -> None:
        from scripts.prepare_fgui import generate

        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp)
            manifest = generate(RESEARCH, target)
            loading_entry = next((entry for entry in manifest['packages'] if entry['name'] == 'Loading'), None)
            self.assertIsNotNone(loading_entry)
            self.assertEqual(loading_entry['packageId'], 'sjqdmk59')
            self.assertEqual(loading_entry['atlases'], [])
            self.assertEqual(loading_entry['fuiSha256'], 'f29218c53da4e26605d55fb1c32e0b13b1d2de37a978ab3bcb79f371a4e0a645')
            package = load(target / 'Loading.json')
            window = component(package, 'BattleLoadingWindow')
            self.assertEqual(child(window, 'PicImage')['fillColor'], '#000000ff')
            self.assertEqual(child(window, 'PicImage')['alpha'], 0.0)
            self.assertEqual(child(window, 'EffectAni')['refUrl'], 'ui://sjqdmk59uvj5lak')
            self.assertEqual(package['source']['container']['pathId'], '-4728814527088002609')
            self.assertEqual([track['name'] for track in window['transitions']], ['in1', 'out1'])
            for transition in window['transitions']:
                [track] = transition['items']
                self.assertEqual((track['type'], track['targetName'], track['tween']['easeType']), ('Alpha', 'EffectAni', 'QuadOut'))
                self.assertAlmostEqual(track['tween']['duration'], 0.75, places=6)
            corrupted = target / 'corrupted.bytes'
            original_bytes = source_fui('Loading').read_bytes()
            corrupted.write_bytes(original_bytes[:-1] + bytes((original_bytes[-1] ^ 1,)))
            with self.assertRaisesRegex(ValueError, 'Loading FGUI SHA-256 mismatch'):
                generate(RESEARCH, target / 'corrupt-output', corrupted)

    def test_unsupported_parts_are_explicit(self) -> None:
        known_item_types = {'Image', 'Component', 'Atlas', 'Font'}
        for name, pkg in self.pkgs.items():
            self.assertIsInstance(pkg['unsupported'], list, name)
            for item in pkg['items'].values():
                self.assertIn(item['type'], known_item_types, f'{name}:{item["id"]}')
                if item['type'] == 'Font':
                    self.assertEqual('bitmapFont' in item, item['decoded'], f'{name}:{item["id"]}')
            for comp in pkg['components'].values():
                self.assertIn(comp['objectType'], {'Component', 'Button', 'ProgressBar', 'ScrollBar'})

    # -- reproducibility ------------------------------------------------------

    def test_manifest_provenance(self) -> None:
        self.assertEqual(self.manifest['schema'], 'starfall-fgui-manifest/1')
        self.assertNotIn('generatedAt', self.manifest)  # fixed provenance, no wall clock
        entries = {p['name']: p for p in self.manifest['packages']}
        self.assertEqual(set(entries), set(PACKAGES))
        for name, entry in entries.items():
            self.assertEqual(entry['json'], f'{name}.json')
            self.assertEqual(entry['jsonSha256'], sha(FGUI_DIR / f'{name}.json'))
            self.assertEqual(entry['fuiSha256'], sha(source_fui(name)))
            self.assertEqual(entry['packageId'], PACKAGES[name]['id'])
            self.assertEqual(len(entry['atlases']), PACKAGES[name]['atlases'])

    def test_rerun_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            out1 = Path(tmp) / 'a'
            out2 = Path(tmp) / 'b'
            for out in (out1, out2):
                subprocess.run(
                    [sys.executable, '-B', str(APP / 'scripts' / 'prepare_fgui.py'), '--source', str(RESEARCH), '--out', str(out)],
                    check=True, capture_output=True, text=True, cwd=APP,
                )
            files1 = {p.relative_to(out1): p for p in out1.rglob('*') if p.is_file()}
            files2 = {p.relative_to(out2): p for p in out2.rglob('*') if p.is_file()}
            self.assertEqual(set(files1), set(files2))
            for rel, p1 in files1.items():
                self.assertEqual(sha(p1), sha(files2[rel]), str(rel))
            # and the committed public output matches a fresh run byte for byte
            for rel, p1 in files1.items():
                public = FGUI_DIR / rel
                self.assertTrue(public.is_file(), str(rel))
                self.assertEqual(sha(p1), sha(public), str(rel))


if __name__ == '__main__':
    unittest.main()

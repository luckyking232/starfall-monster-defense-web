"""Trace the original minigame's Lua paths, native material pointers, and FairyGUI image references."""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
import io
import json
from pathlib import Path
import re
import UnityPy

from prepare_loading_inputs import catalog_entries
from prepare_mesh_projectiles import ASSET_VERSION, Extractor, atomic_write, load_bundle

APP = Path(__file__).resolve().parents[1]
PUBLIC = APP / 'public/assets'
FX_PREFIX = 'assets/art/effects/prefab/ui_prefab/minigame/minigame022/'
FX_LOADING = 'assets/art/effects/prefab/ui_prefab/loading/fx_ui_loading.prefab'
PREFAB = re.compile(r'"(assets/[^"]+\.prefab)"', re.IGNORECASE)
NAME_URL = re.compile(r'"(ActivityDungeon1017(?:Battle)?|CommonResource):([^"]+)"')
ITEM_URL = re.compile(r'(?:ui://)[a-zA-Z0-9]+')
LUA_FILES = re.compile(r'(?:BaseShoot.*|MiniGameBattle.*|MiniGameSkillChoiceWindow|Activity17MiniGame2MainWindow|Activity17MiniGameChoice2.*|Activity17MiniTask2Window)\.lua')
COMPONENT_NAMES = {
    'ActivityDungeon1017': ('MiniGame2Window', 'MiniGameChoice2Window', 'MiniGameChoice2_InfoSkillWindow', 'MiniTask2Window'),
    'ActivityDungeon1017Battle': ('BattleUIWindow', 'SkillChoiceWindow', 'BattlePauseWindow', 'BattleExitWindow',
                                  'BattleEndWindow', 'NormalHitNumberTips', 'CritHitNumberTips', 'GreenHpNumberTips'),
    'CommonResource': ('Activity17_MonsterHP',),
    'Loading': ('BattleLoadingWindow',),
}


def read_json(path):
    return json.loads(path.read_bytes())


def catalogs(source):
    catalog = read_json(source / 'version-catalog.json')
    if str(catalog['timestamp']) != ASSET_VERSION:
        raise ValueError('Unexpected version-catalog version')
    result = {}
    for entry in catalog['data']:
        name = entry['name'].lower()
        if name not in ('arts', 'other'):
            continue
        file = source / 'manifests' / f'{name}_{entry["hash"]}.json'
        if hashlib.md5(file.read_bytes()).hexdigest() != entry['hash']:
            raise ValueError(f'Bad source catalog: {file}')
        data, = (obj.read_typetree() for obj in load_bundle(file).objects if obj.type.name == 'MonoBehaviour')
        for asset in data['assets']:
            path = f'{data["dirs"][asset["dir"]]}/{asset["name"]}'.lower()
            result[path] = data['bundles'][asset['bundle']]
    return result


def lua_references(source):
    current = source / 'lua' / ASSET_VERSION / 'decoded'
    prefabs, images = defaultdict(set), defaultdict(set)
    for file in sorted(current.glob('*.lua')):
        if not LUA_FILES.fullmatch(file.name):
            continue
        for number, line in enumerate(file.read_text(encoding='utf-8-sig').splitlines(), 1):
            location = f'{file.name}:{number}'
            for path in PREFAB.findall(line):
                field = re.match(r'\s*(\w+)\s*=', line)
                prefabs[path.lower()].add(f'{location}:{field[1] if field else "literal"}')
            for package, name in NAME_URL.findall(line):
                images[(package, name)].add(location)
            for package, name in re.findall(r'GetItemUrl\("(\w+)", "([^"]+)"\)', line):
                images[(package, name)].add(location)
    prefabs[FX_LOADING].add('BattleLoadingWindow.lua::literal')
    return prefabs, images


def original_effect_call(references):
    fields = {ref.rsplit(':', 1)[1] for ref in references}
    if fields & {'bullet_effect', 'literal', 'spd', 'settle_effect_path', 'deduce_effect_path'}:
        return 'original-call-path'
    if 'BaseShootSkill.lua:205:effect' in references or 'BaseShootSkill.lua:1160:effect' in references:
        return 'original-call-path'
    if fields:
        return 'config-only'
    return 'no-minigame-lua-reference'


def effect_references(source, output, catalog, prefab_refs, loading_cache):
    source_manifest = read_json(source / 'assets/download-manifest.json')['files']
    downloaded = {entry['hash'] for entry in source_manifest}
    paths = sorted({key for key in catalog if key.startswith(FX_PREFIX) and key.endswith('.prefab')}
                   | {key for key in prefab_refs if key.startswith((FX_PREFIX, FX_LOADING))})
    roots = [catalog[path]['hash'] for path in paths if path in catalog and catalog[path]['hash'] in downloaded]
    reader = Extractor(source, output / 'recovered', roots)
    unresolved = []
    if loading_cache:
        original = source / 'assets' / 'bundles' / ASSET_VERSION / 'original'
        for digest, entry in catalog_entries(source, with_effects=True).items():
            if digest in reader.inputs:
                continue
            path = original / (digest + '.bundle')
            if not path.is_file():
                path = loading_cache / path.name
            if not path.is_file():
                unresolved.append(dict(prefab=FX_LOADING, bundle=digest, reason='bundle not in local loading cache'))
                continue
            data = path.read_bytes()
            if len(data) != entry['size'] or hashlib.md5(data).hexdigest() != digest:
                raise ValueError(f'Invalid loading bundle: {path}')
            if b'UnityFS' in data:
                reader.index_bundle(digest, UnityPy.load(io.BytesIO(data[data.index(b'UnityFS'):])),
                                    digest == catalog[FX_LOADING]['hash'])
    else:
        unresolved.append(dict(prefab=FX_LOADING, reason='local loading cache was not supplied'))
    web = read_json(PUBLIC / 'effects/mesh-effects.json')
    native_manifest = read_json(PUBLIC / 'native/manifest.json')
    native = {prefab['container'].lower(): prefab for prefab in native_manifest['prefabs']}
    source_png = defaultdict(list)
    for file in (source / 'assets/exported').rglob('*.png'):
        source_png[file.stem.casefold()].append(file)

    textures, prefab_entries = {}, {}

    def record_texture(texture, path, render_id, material, uniform):
        if texture is None:
            return
        if texture.type.name != 'Texture2D':
            unresolved.append(dict(prefab=path, object=texture.type.name, uniform=uniform))
            return
        id = str(texture.path_id)
        if id not in textures:
            label = texture.read_typetree()['m_Name']
            relative = [file.relative_to(source).as_posix() for file in source_png[label.casefold()]]
            recovered = None
            recovered_sha256 = None
            if not relative:
                reader.texture(texture)
                recovered = 'recovered/' + reader.textures[id]['url']
                recovered_sha256 = reader.textures[id]['sha256']
            textures[id] = dict(name=label, sourceExports=relative, recovered=recovered,
                                recoveredSha256=recovered_sha256,
                                bundle=reader.bundle_by_cab[texture.assets_file.name.lower()],
                                web=web['textures'].get(id, {}).get('url'), users=[])
        material_id = str(material.path_id) if material else None
        user = dict(prefab=path, renderer=str(render_id), material=material.read_typetree()['m_Name'] if material else None,
                    uniform=uniform, materialId=material_id,
                    webBound=bool(path in web['prefabs'] and any(
                        (material_id is not None and material_id in (layer['material'], layer.get('trailMaterial')) and re.search(
                            r'\bsampler2D\s+' + re.escape(uniform) + r'\s*;',
                            web['shaders'][web['materials'][material_id]['shader']]['fragment']))
                        or (uniform == 'Sprite.texture' and layer['material'].startswith('sprite-')
                            and web['materials'][layer['material']]['textures'].get('_MainTex') == id)
                        for layer in web['prefabs'][path])))
        textures[id]['users'].append(user)

    for path in paths:
        entry = catalog.get(path)
        digest = entry['hash'] if entry else None
        refs = sorted(prefab_refs.get(path, []))
        original = original_effect_call(refs)
        checked_summary = bool(entry and (source / 'assets/prefabs' / Path(entry['name']).with_suffix('.json')).is_file())
        fields = {ref.rsplit(':', 1)[1] for ref in refs}
        draw_path = ('Loading camera' if path == FX_LOADING else 'world bullets' if 'bullet_effect' in fields
                     else 'world units' if 'spd' in fields else 'world effects')
        prefab_entries[path] = dict(references=refs, originalRuntime=original, bundle=digest,
                                    sourceAvailable=digest in reader.root_files,
                                    unityObjectSummary=checked_summary, rendererCounts={}, textureIds=[],
                                    webPrepared=path in web['prefabs'],
                                    webDrawPath=draw_path if path in web['prefabs'] else None)
        if path == FX_LOADING:
            prefab_entries[path]['separateLoadingCatalog'] = 'monster-defense-development-20261126/loading-resolved-pointers.json'
        if digest not in reader.root_files:
            continue
        members = reader.root_files[digest]
        renderers = [obj for obj in members if obj.type.name.endswith('Renderer')]
        counts = Counter()
        for obj in renderers:
            renderer = obj.read_typetree()
            if not renderer.get('m_Enabled', True):
                continue
            counts[obj.type.name] += 1
            if renderer.get('m_Sprite', {}).get('m_PathID'):
                sprite = reader.resolve(obj, renderer['m_Sprite'])
                for channel in ('texture', 'alphaTexture'):
                    pp = sprite.read_typetree()['m_RD'].get(channel)
                    if pp and pp['m_PathID']:
                        record_texture(reader.resolve(sprite, pp), path, obj.path_id, None, f'Sprite.{channel}')
            for material_pointer in renderer.get('m_Materials', []):
                try:
                    mat = reader.resolve(obj, material_pointer)
                    if not mat:
                        continue
                    for uniform, saved in mat.read_typetree()['m_SavedProperties']['m_TexEnvs']:
                        record_texture(reader.resolve(mat, saved['m_Texture']), path, obj.path_id, mat, uniform)
                except (KeyError, ValueError) as error:
                    unresolved.append(dict(prefab=path, renderer=str(obj.path_id), reason=str(error)))
        prefab_entries[path]['rendererCounts'] = dict(counts)
        prefab_entries[path]['textureIds'] = sorted({id for id, texture in textures.items()
                                                    if any(user['prefab'] == path for user in texture['users'])})
    models = {}
    for path, refs in sorted(prefab_refs.items()):
        if path in prefab_entries:
            continue
        entry = catalog.get(path)
        prepared = native.get(path)
        models[path] = dict(references=sorted(refs), bundle=entry['hash'] if entry else None,
                            webPrepared=bool(prepared), webDrawPath='native sprite player' if prepared else None,
                            editorOnly=path.endswith('/green.prefab'), emptyAtRuntime=path.endswith('/empty.prefab'))
    return prefab_entries, textures, models, native_manifest['frames'], unresolved


def fgui_references(source, refs):
    fgui = PUBLIC / 'fgui'
    packages = {name: read_json(fgui / f'{name}.json') for name in COMPONENT_NAMES}
    by_id = {pkg['package']['id']: name for name, pkg in packages.items()}
    by_name = {name: {item.get('name'): key for key, item in pkg['items'].items()} for name, pkg in packages.items()}
    calls = defaultdict(set)
    unresolved = []
    visited = set()

    def mark(package, key, location):
        calls[(package, key)].add(location)
        if (package, key) in visited:
            return
        visited.add((package, key))
        items = packages[package]['items']
        if key not in items:
            unresolved.append(dict(source=location, package=package, item=key))
            return
        component = packages[package]['components'].get(key, {})
        for child in component.get('children', []):
            child_name = location + ' > ' + child['name']
            if child.get('src') and not child.get('refUrl'):
                mark(package, child['src'], child_name)
            for url in set(ITEM_URL.findall(json.dumps(child, ensure_ascii=False))):
                mark_url(url, child_name)
        for extra in component.get('transitions', []):
            for url in set(ITEM_URL.findall(json.dumps(extra, ensure_ascii=False))):
                mark_url(url, location + ' > transition ' + extra['name'])
        if 'bitmapFont' in items[key]:
            for glyph in items[key]['bitmapFont']['glyphs'].values():
                if glyph.get('image'):
                    mark(package, glyph['image'], location + ' > glyph')

    def mark_url(url, location):
        package = by_id.get(url[5:13])
        if package is None:
            unresolved.append(dict(source=location, url=url))
        else:
            mark(package, url[13:], location)

    for package, names in COMPONENT_NAMES.items():
        for name in names:
            mark(package, packages[package]['componentIndex'][name], f'{package}:{name}')
    for (package, name), locations in sorted(refs.items()):
        for location in sorted(locations):
            if name not in by_name[package]:
                unresolved.append(dict(source=location, package=package, name=name))
            else:
                mark(package, by_name[package][name], location)
    images = {}
    for package, doc in packages.items():
        for key, item in doc['items'].items():
            if item['type'] not in ('Image', 'Font', 'MovieClip', 'Spine', 'DragonBones'):
                continue
            atlas = item.get('sprite', {}).get('atlasFile')
            original_atlas = source / 'assets/exported/assets/fairygui/ui' / atlas if atlas else None
            original_slice = source / 'assets/fgui-sprites-by-id' / package / f'{key}.png'
            images[f'{package}/{key}'] = dict(
                type=item['type'], name=item.get('name'), references=sorted(calls[(package, key)]),
                unpacked=bool((original_atlas and original_atlas.is_file()) or original_slice.is_file()
                              or 'bitmapFont' in item), webPrepared=bool((atlas and (fgui / atlas).is_file())
                                                                      or 'bitmapFont' in item), atlas=atlas,
                webDrawPath=('FGUI image / Loader' if atlas else 'FGUI bitmap text' if 'bitmapFont' in item else None)
                if calls[(package, key)] else None,
            )
    return images, unresolved


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--loading-cache', type=Path, help='Verified original Loading catalog cache')
    args = parser.parse_args()
    catalog = catalogs(args.source)
    prefab_refs, image_refs = lua_references(args.source)
    effects, textures, models, frames, effect_gaps = effect_references(
        args.source, args.out, catalog, prefab_refs, args.loading_cache)
    images, ui_gaps = fgui_references(args.source, image_refs)
    counts = dict(
        effects=dict(total=len(effects), summaryExport=sum(x['unityObjectSummary'] for x in effects.values()),
                     prepared=sum(x['webPrepared'] for x in effects.values()),
                     originalRuntime=dict(Counter(x['originalRuntime'] for x in effects.values())),
                     originalCallMissingWeb=sum(x['originalRuntime'] == 'original-call-path' and not x['webPrepared']
                                                for x in effects.values())),
        textures=dict(total=len(textures), alreadyUnpacked=sum(bool(x['sourceExports']) for x in textures.values()),
                      recovered=sum(bool(x['recovered']) for x in textures.values()),
                      prepared=sum(bool(x['web']) for x in textures.values()),
                      bound=sum(any(u['webBound'] for u in x['users']) for x in textures.values())),
        models=dict(total=len(models), prepared=sum(x['webPrepared'] for x in models.values()), frames=len(frames)),
        fgui=dict(total=len(images), referenced=sum(bool(x['references']) for x in images.values()),
                  unpacked=sum(x['unpacked'] for x in images.values()),
                  prepared=sum(x['webPrepared'] for x in images.values()),
                  referencedPrepared=sum(bool(x['references']) and x['webPrepared'] for x in images.values())),
    )
    report = dict(assetVersion=ASSET_VERSION, counts=counts, effectPrefabs=effects, effectTextures=textures,
                  nativeModels=models, nativeFrames=frames, fairyGuiVisualItems=images,
                  unresolved=dict(effects=effect_gaps, fgui=ui_gaps))
    atomic_write(args.out / 'asset-audit.json', (json.dumps(report, ensure_ascii=False, indent=2) + '\n').encode())
    print(json.dumps(counts, indent=2))


if __name__ == '__main__':
    main()

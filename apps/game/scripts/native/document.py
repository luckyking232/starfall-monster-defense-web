"""Assemble per-prefab native documents and the shared frame pool.

Each of the sixteen monster-defense prefab bundles becomes one JSON document
(units and the zhalan wall under ``units/``, maps under ``maps/``) plus
byte-exact copies of the original AssetStudio sprite frames under ``frames/``.
External material PPtrs (``fileId >= 1``) are resolved against the CAB names of
the sibling processed bundles so every reference in the documents closes.
"""
from __future__ import annotations

import hashlib
import math
import struct
from pathlib import Path
from typing import Any

from .bundle import extract_graph, load_bundle, read_trees
from .curves import decode_clip

SCHEMA = 'starfall-native-prefab/1'

CONVENTIONS = {
    'pathIds': 'all Unity path ids are decimal strings (64-bit safe for JSON consumers)',
    'lengthUnit': 'Unity units; sprite pixels convert via sprite.pixelsToUnits',
    'transform': 'localPosition/localRotation/localScale are parent-relative, exactly as serialized',
    'spriteRect': 'pixel rect inside the source texture, origin at texture bottom-left, y up',
    'framePng': ('byte-exact AssetStudio export of the sprite\'s trimmed textureRect; place it at '
                 'textureRectOffset inside sprite.rect (y up), then anchor at sprite.pivot'),
    'clipKeys': ('decoded from m_MuscleClip.m_Clip.data streamed words; key.time is seconds from clip '
                 'start, rawTime is the serialized time (-FLT_MAX sentinel clamps to startTime), '
                 'spriteIndex addresses pptrCurveMapping'),
}


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def png_size(data: bytes) -> tuple[int, int]:
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('not a PNG')
    return struct.unpack('>II', data[16:24])


def build_cab_index(processed_dir: Path, needed: set[str]) -> dict[str, dict[str, Any]]:
    """Map CAB names to their processed bundle by scanning the sibling bundles."""
    index: dict[str, dict[str, Any]] = {}
    if not needed:
        return index
    for path in sorted(processed_dir.glob('*.bundle')):
        try:
            env = load_bundle(path)
        except Exception:
            continue
        for obj in env.objects:
            cab = str(getattr(getattr(obj, 'assets_file', None), 'name', '') or '')
            if cab and cab in needed and cab not in index:
                index[cab] = {'bundle': path.name.removesuffix('.bundle')}
        if needed <= set(index):
            break
    return index


def resolve_object_name(bundle_path: Path, path_id: int) -> str:
    """Read one object name from a sibling bundle (for material provenance)."""
    try:
        env = load_bundle(bundle_path)
    except Exception:
        return ''
    for obj in env.objects:
        if int(obj.path_id) == path_id:
            try:
                return str(obj.read_typetree().get('m_Name', ''))
            except Exception:
                return ''
    return ''


def _resolve_materials(graph: dict[str, Any], cab_index: dict[str, dict[str, Any]],
                       processed_dir: Path, diagnostics: list[str]) -> None:
    externals = {entry['fileId']: entry for entry in graph['externals']}
    cache: dict[tuple[str, int], str] = {}
    for renderer in graph['spriteRenderers']:
        for material in renderer['materials']:
            file_id = material['fileId']
            if file_id == 0:
                continue
            external = externals.get(file_id)
            if external is None:
                diagnostics.append(f"renderer {renderer['pathId']} material fileId {file_id} has no external entry")
                continue
            material['external'] = {'name': external['name'], 'path': external['path']}
            resolved = cab_index.get(external['name'])
            if resolved is None:
                diagnostics.append(f"external {external['name']} not found among processed bundles")
                continue
            target = processed_dir / f"{resolved['bundle']}.bundle"
            key = (resolved['bundle'], int(material['pathId']))
            if key not in cache:
                cache[key] = resolve_object_name(target, int(material['pathId']))
            material['resolved'] = {
                'bundle': resolved['bundle'],
                'objectName': cache[key],
            }


def _fill_curve_targets(document: dict[str, Any], clip: dict[str, Any],
                        animators: list[dict[str, Any]], diagnostics: list[str]) -> None:
    """Resolve each curve binding's target GameObject and key sprite references."""
    sprites = {sprite['pathId']: sprite for sprite in document['objects']['sprites']}
    for curve in clip['curves']:
        binding = curve['binding']
        if binding['path'] == 0:
            if animators:
                curve['target'] = {
                    'resolution': 'animatorGameObject',
                    'gameObject': animators[0]['gameObject'],
                    'component': 'SpriteRenderer' if binding['typeId'] == 212 else '',
                }
            else:
                curve['target'] = {'resolution': 'unresolved', 'gameObject': '0', 'component': ''}
                diagnostics.append(f"clip {clip['name']} curve {curve['index']} binds path 0 but no Animator exists")
        else:
            curve['target'] = {'resolution': 'unresolved', 'gameObject': '0', 'component': ''}
            diagnostics.append(
                f"clip {clip['name']} curve {curve['index']} binds hashed path {binding['path']} "
                '(not the animator root); resolve via crc32 of the relative transform path')
        for key in curve['keys']:
            pointer = clip['pptrCurveMapping'][key['spriteIndex']]
            sprite = sprites.get(pointer)
            if sprite is None:
                diagnostics.append(
                    f"clip {clip['name']} key references sprite {pointer} outside this bundle")
                key['sprite'] = pointer
                key['spriteName'] = ''
                key['frame'] = ''
                continue
            key['sprite'] = sprite['pathId']
            key['spriteName'] = sprite['name']
            key['frame'] = sprite['frame']['file']


def build_document(key: str, kind: str, bundle_md5: str, source_root: Path,
                   bundle_info: dict[str, Any], header_offset: int,
                   dependencies: list[dict[str, Any]], cab_index: dict[str, dict[str, Any]],
                   staged_frames: dict[str, bytes]) -> dict[str, Any]:
    """Build one prefab document and stage its sprite frame PNGs."""
    bundles_dir = source_root / 'assets' / 'bundles' / '134395529309427262'
    processed = bundles_dir / 'processed' / f'{bundle_md5}.bundle'
    original = bundles_dir / 'original' / f'{bundle_md5}.bundle'
    original_bytes = original.read_bytes()
    processed_bytes = processed.read_bytes()
    if hashlib.md5(original_bytes).hexdigest() != bundle_md5:
        raise ValueError(f'{bundle_md5}: original bundle md5 mismatch')
    if processed_bytes != original_bytes[header_offset:]:
        raise ValueError(f'{bundle_md5}: processed bundle is not original[{header_offset}:]')

    env = load_bundle(processed)
    trees, diagnostics = read_trees(env)
    graph = extract_graph(env, trees)
    diagnostics.extend(graph.pop('diagnostics'))
    cab_name = graph.pop('cabName')

    containers = [c for c in graph.pop('containers') if c['path'].endswith('.prefab')]
    if len(containers) != 1:
        diagnostics.append(f'expected exactly one .prefab container, found {len(containers)}')
    container = containers[0] if containers else {'path': '', 'asset': '0'}
    root_go = container['asset']
    root_transform = next((t['pathId'] for t in graph['transforms'] if t['gameObject'] == root_go), '0')

    clip_ids = set(graph.pop('animationClipIds'))
    clips = []
    for path_id in sorted(clip_ids):
        tree = trees[path_id][1]
        decoded = decode_clip(tree)
        muscle = tree['m_MuscleClip']
        clip = {
            'pathId': str(path_id),
            'name': str(tree.get('m_Name', '')),
            'sampleRate': float(tree.get('m_SampleRate', 0.0) or 0.0),
            'wrapMode': int(tree.get('m_WrapMode', 0) or 0),
            'legacy': bool(tree.get('m_Legacy', False)),
            'compressed': bool(tree.get('m_Compressed', False)),
            'startTime': float(muscle.get('m_StartTime', 0.0) or 0.0),
            'stopTime': float(muscle.get('m_StopTime', 0.0) or 0.0),
            'duration': float(muscle.get('m_StopTime', 0.0) or 0.0) - float(muscle.get('m_StartTime', 0.0) or 0.0),
            'loopTime': bool(muscle.get('m_LoopTime', False)),
            'loopBlend': bool(muscle.get('m_LoopBlend', False)),
            'events': list(tree.get('m_Events', ())),
            **decoded,
        }
        clips.append(clip)

    sprite_source = source_root / 'assets' / 'exported' / 'assets' / 'art' / 'models' / 'minigame022' / 'prefab'
    for sprite in graph['sprites']:
        png_path = sprite_source / f"{sprite['name']}.png"
        if not png_path.is_file():
            diagnostics.append(f"sprite {sprite['name']} has no exported PNG frame")
            sprite['frame'] = {'file': '', 'sha256': '', 'width': 0, 'height': 0, 'source': ''}
            continue
        data = png_path.read_bytes()
        width, height = png_size(data)
        rect = sprite['textureRect']
        if (width, height) != (math.ceil(rect['width']), math.ceil(rect['height'])):
            diagnostics.append(
                f"sprite {sprite['name']} PNG is {width}x{height}, expected "
                f"{math.ceil(rect['width'])}x{math.ceil(rect['height'])} from textureRect")
        file_name = f'frames/{sprite["name"]}.png'
        existing = staged_frames.get(file_name)
        if existing is not None and existing != data:
            raise ValueError(f'frame name collision with different bytes: {file_name}')
        staged_frames[file_name] = data
        sprite['frame'] = {
            'file': file_name,
            'sha256': sha256_bytes(data),
            'width': width,
            'height': height,
            'source': f'assets/exported/assets/art/models/minigame022/prefab/{sprite["name"]}.png',
        }

    document: dict[str, Any] = {
        'schema': SCHEMA,
        'key': key,
        'kind': kind,
        'prefab': {
            'container': container['path'],
            'rootGameObject': root_go,
            'rootTransform': root_transform,
        },
        'bundle': {
            'file': f'{bundle_md5}.bundle',
            'name': bundle_info['name'],
            'manifestIndex': bundle_info['manifest_index'],
            'originalMd5': bundle_md5,
            'originalSha256': sha256_bytes(original_bytes),
            'processedSha256': sha256_bytes(processed_bytes),
            'headerOffsetStripped': header_offset,
            'sizeBytes': len(original_bytes),
            'processedSizeBytes': len(processed_bytes),
            'cabName': cab_name,
            'dependencies': dependencies,
        },
        'conventions': CONVENTIONS,
        'objects': {
            'gameObjects': graph['gameObjects'],
            'transforms': graph['transforms'],
            'spriteRenderers': graph['spriteRenderers'],
            'animators': graph['animators'],
            'animatorControllers': graph['animatorControllers'],
            'sprites': graph['sprites'],
            'textures': graph['textures'],
        },
        'animations': {'clips': clips},
        'diagnostics': diagnostics,
    }

    _resolve_materials(graph, cab_index, bundles_dir / 'processed', diagnostics)
    for clip in clips:
        _fill_curve_targets(document, clip, graph['animators'], diagnostics)
    return document

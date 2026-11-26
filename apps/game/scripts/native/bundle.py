"""Extract the native object graph of one processed monster-defense bundle.

Every value is read from the bundle's typetrees with UnityPy and copied
verbatim (path ids become strings so 64-bit ids survive JSON/JavaScript).
Unresolved or unexpected data is reported in ``diagnostics`` instead of being
silently dropped or repaired.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

DECRYPT_KEY = b'yunguihaowan1234'

GRAPH_TYPES = {'GameObject', 'Transform', 'SpriteRenderer', 'Animator', 'AnimatorController',
               'Sprite', 'Texture2D', 'AnimationClip', 'AssetBundle'}


def load_bundle(bundle_path: Path):
    import UnityPy

    UnityPy.set_assetbundle_decrypt_key(DECRYPT_KEY)
    return UnityPy.load(str(bundle_path))


def read_trees(env) -> tuple[dict[int, tuple[str, dict[str, Any]]], list[str]]:
    """Read every object's typetree, returning ``{pathId: (typeName, tree)}``."""
    diagnostics: list[str] = []
    trees: dict[int, tuple[str, dict[str, Any]]] = {}
    for obj in env.objects:
        path_id = int(obj.path_id)
        type_name = obj.type.name
        try:
            trees[path_id] = (type_name, obj.read_typetree())
        except Exception as exc:  # keep the object visible even if undecodable
            diagnostics.append(f'typetree read failed for {type_name} {path_id}: {exc}')
            trees[path_id] = (type_name, {})
    return trees, diagnostics


def _vec(value: Any, keys: tuple[str, ...]) -> dict[str, float]:
    if not isinstance(value, dict):
        return {key: 0.0 for key in keys}
    return {key: float(value.get(key, 0.0)) for key in keys}


def _ptr(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {'fileId': 0, 'pathId': '0'}
    return {'fileId': int(value.get('m_FileID', 0) or 0), 'pathId': str(int(value.get('m_PathID', 0) or 0))}


def _pid(value: Any) -> str:
    return _ptr(value)['pathId']


def external_files(env) -> list[dict[str, Any]]:
    """The serialized file's external references (PPtr fileId table, 1-based)."""
    found: dict[tuple[int, str, str], dict[str, Any]] = {}
    for obj in env.objects:
        serialized = getattr(obj, 'assets_file', None)
        for file_id, external in enumerate(getattr(serialized, 'externals', ()) or (), start=1):
            name = str(getattr(external, 'name', '') or '')
            path = str(getattr(external, 'path', '') or '')
            found.setdefault((file_id, name, path), {'fileId': file_id, 'name': name, 'path': path})
    return [found[key] for key in sorted(found)]


def cab_name(env) -> str:
    for obj in env.objects:
        name = str(getattr(getattr(obj, 'assets_file', None), 'name', '') or '')
        if name:
            return name
    return ''


def extract_graph(env, trees: dict[int, tuple[str, dict[str, Any]]]) -> dict[str, Any]:
    """Build the JSON-safe object graph document for one bundle."""
    diagnostics: list[str] = []
    names = {pid: str(tree.get('m_Name', '')) for pid, (kind, tree) in trees.items() if kind == 'GameObject'}

    game_objects = []
    for path_id in sorted(pid for pid, (kind, _) in trees.items() if kind == 'GameObject'):
        _, tree = trees[path_id]
        components = []
        for entry in tree.get('m_Component', ()):
            pointer = entry.get('component') if isinstance(entry, dict) else entry
            component_id = int((pointer or {}).get('m_PathID', 0) or 0)
            component_type = trees.get(component_id, ('Missing', {}))[0]
            if component_id and component_id not in trees:
                diagnostics.append(f'GameObject {path_id} references missing component {component_id}')
            components.append({'pathId': str(component_id), 'type': component_type})
        game_objects.append({
            'pathId': str(path_id),
            'name': names[path_id],
            'active': bool(tree.get('m_IsActive', True)),
            'layer': int(tree.get('m_Layer', 0) or 0),
            'tag': int(tree.get('m_Tag', 0) or 0),
            'components': components,
        })

    transform_go: dict[int, int] = {}
    for path_id, (kind, tree) in trees.items():
        if kind != 'Transform':
            continue
        go = int((tree.get('m_GameObject') or {}).get('m_PathID', 0) or 0)
        if go in transform_go:
            diagnostics.append(f'GameObject {go} has more than one Transform')
        transform_go[go] = path_id

    def hierarchy_path(transform_id: int) -> str:
        parts: list[str] = []
        seen: set[int] = set()
        current = transform_id
        while current:
            if current in seen:
                diagnostics.append(f'transform cycle at {current}')
                break
            seen.add(current)
            kind, tree = trees.get(current, ('Missing', {}))
            if kind != 'Transform':
                break
            go = int((tree.get('m_GameObject') or {}).get('m_PathID', 0) or 0)
            parts.append(names.get(go, f'<GameObject:{go}>'))
            current = int((tree.get('m_Father') or {}).get('m_PathID', 0) or 0)
        return '/'.join(reversed(parts))

    transforms = []
    for path_id in sorted(pid for pid, (kind, _) in trees.items() if kind == 'Transform'):
        _, tree = trees[path_id]
        go = int((tree.get('m_GameObject') or {}).get('m_PathID', 0) or 0)
        children = [str(int(c.get('m_PathID', 0) or 0)) for c in tree.get('m_Children', ())]
        parent = int((tree.get('m_Father') or {}).get('m_PathID', 0) or 0)
        sibling_index = 0
        if parent:
            parent_tree = trees.get(parent, ('Missing', {}))[1]
            sibling_index = next((i for i, c in enumerate(parent_tree.get('m_Children', ()))
                                  if int(c.get('m_PathID', 0) or 0) == path_id), 0)
        transforms.append({
            'pathId': str(path_id),
            'gameObject': str(go),
            'name': names.get(go, ''),
            'path': hierarchy_path(path_id),
            'parent': str(parent),
            'children': children,
            'siblingIndex': sibling_index,
            'localPosition': _vec(tree.get('m_LocalPosition'), ('x', 'y', 'z')),
            'localRotation': _vec(tree.get('m_LocalRotation'), ('x', 'y', 'z', 'w')),
            'localScale': _vec(tree.get('m_LocalScale'), ('x', 'y', 'z')),
        })

    sprite_renderers = []
    for path_id in sorted(pid for pid, (kind, _) in trees.items() if kind == 'SpriteRenderer'):
        _, tree = trees[path_id]
        sprite_renderers.append({
            'pathId': str(path_id),
            'gameObject': _pid(tree.get('m_GameObject')),
            'enabled': bool(tree.get('m_Enabled', True)),
            'sprite': _pid(tree.get('m_Sprite')),
            'color': _vec(tree.get('m_Color'), ('r', 'g', 'b', 'a')),
            'flipX': bool(tree.get('m_FlipX', False)),
            'flipY': bool(tree.get('m_FlipY', False)),
            'drawMode': int(tree.get('m_DrawMode', 0) or 0),
            'size': _vec(tree.get('m_Size'), ('x', 'y')),
            'adaptiveModeThreshold': float(tree.get('m_AdaptiveModeThreshold', 0.0) or 0.0),
            'spriteTileMode': int(tree.get('m_SpriteTileMode', 0) or 0),
            'spriteSortPoint': int(tree.get('m_SpriteSortPoint', 0) or 0),
            'maskInteraction': int(tree.get('m_MaskInteraction', 0) or 0),
            'sortingLayerId': int(tree.get('m_SortingLayerID', 0) or 0),
            'sortingLayer': int(tree.get('m_SortingLayer', 0) or 0),
            'sortingOrder': int(tree.get('m_SortingOrder', 0) or 0),
            'materials': [_ptr(m) for m in tree.get('m_Materials', ())],
        })

    animators = []
    for path_id in sorted(pid for pid, (kind, _) in trees.items() if kind == 'Animator'):
        _, tree = trees[path_id]
        animators.append({
            'pathId': str(path_id),
            'gameObject': _pid(tree.get('m_GameObject')),
            'enabled': bool(tree.get('m_Enabled', True)),
            'controller': _pid(tree.get('m_Controller')),
            'avatar': _pid(tree.get('m_Avatar')),
            'cullingMode': int(tree.get('m_CullingMode', 0) or 0),
            'updateMode': int(tree.get('m_UpdateMode', 0) or 0),
            'applyRootMotion': bool(tree.get('m_ApplyRootMotion', False)),
            'hasTransformHierarchy': bool(tree.get('m_HasTransformHierarchy', False)),
        })

    animator_controllers = []
    for path_id in sorted(pid for pid, (kind, _) in trees.items() if kind == 'AnimatorController'):
        _, tree = trees[path_id]
        tos = {str(int(k)): str(v) for k, v in tree.get('m_TOS', ())}
        name_by_hash = {int(k): str(v) for k, v in tree.get('m_TOS', ())}
        controller = tree.get('m_Controller', {})
        state_machines = []
        for machine_entry in controller.get('m_StateMachineArray', ()):
            machine = machine_entry.get('data', machine_entry)
            states = []
            for state_entry in machine.get('m_StateConstantArray', ()):
                state = state_entry.get('data', state_entry)
                blend_trees = []
                for blend_entry in state.get('m_BlendTreeConstantArray', ()):
                    blend = blend_entry.get('data', blend_entry)
                    nodes = []
                    for node_entry in blend.get('m_NodeArray', ()):
                        node = node_entry.get('data', node_entry)
                        nodes.append({
                            'clipId': int(node.get('m_ClipID', 0) or 0),
                            'duration': float(node.get('m_Duration', 0.0) or 0.0),
                            'cycleOffset': float(node.get('m_CycleOffset', 0.0) or 0.0),
                            'mirror': bool(node.get('m_Mirror', False)),
                            'blendType': int(node.get('m_BlendType', 0) or 0),
                        })
                    blend_trees.append({'nodes': nodes})
                clip_ids = [node['clipId'] for blend in blend_trees for node in blend['nodes']]
                transition_count = len(state.get('m_TransitionConstantArray', ()))
                if transition_count:
                    diagnostics.append(
                        f'state {name_id} has {transition_count} transition(s) recorded as count only')
                name_id = int(state.get('m_NameID', 0) or 0)
                states.append({
                    'name': name_by_hash.get(name_id, ''),
                    'nameId': name_id,
                    'pathId': int(state.get('m_PathID', 0) or 0),
                    'fullPathId': int(state.get('m_FullPathID', 0) or 0),
                    'speed': float(state.get('m_Speed', 1.0) or 0.0),
                    'cycleOffset': float(state.get('m_CycleOffset', 0.0) or 0.0),
                    'mirror': bool(state.get('m_Mirror', False)),
                    'loop': bool(state.get('m_Loop', False)),
                    'ikOnFeet': bool(state.get('m_IKOnFeet', False)),
                    'writeDefaultValues': bool(state.get('m_WriteDefaultValues', False)),
                    'tagId': int(state.get('m_TagID', 0) or 0),
                    'clipIds': clip_ids,
                    'blendTrees': blend_trees,
                    'transitions': transition_count,
                })
            state_machines.append({
                'defaultState': int(machine.get('m_DefaultState', 0) or 0),
                'states': states,
                'anyStateTransitions': len(machine.get('m_AnyStateTransitionConstantArray', ())),
            })
        layers = []
        for layer_entry in controller.get('m_LayerArray', ()):
            layer = layer_entry.get('data', layer_entry)
            layers.append({
                'stateMachineIndex': int(layer.get('m_StateMachineIndex', 0) or 0),
                'defaultWeight': float(layer.get('m_DefaultWeight', 0.0) or 0.0),
                'ikPass': bool(layer.get('m_IKPass', False)),
                'binding': int(layer.get('m_Binding', 0) or 0),
            })
        animator_controllers.append({
            'pathId': str(path_id),
            'name': str(tree.get('m_Name', '')),
            'animationClips': [_pid(p) for p in tree.get('m_AnimationClips', ())],
            'tos': tos,
            'layers': layers,
            'stateMachines': state_machines,
        })

    sprites = []
    for path_id in sorted(pid for pid, (kind, _) in trees.items() if kind == 'Sprite'):
        _, tree = trees[path_id]
        render_data = tree.get('m_RD', {})
        sub_meshes = render_data.get('m_SubMeshes', ()) or ()
        index_buffer = render_data.get('m_IndexBuffer', b'') or b''
        if isinstance(index_buffer, (list, tuple)):  # typetree returns one int per byte
            index_buffer = bytes(int(b) & 0xFF for b in index_buffer)
        indices = [int.from_bytes(index_buffer[i:i + 2], 'little') for i in range(0, len(index_buffer), 2)]
        sprites.append({
            'pathId': str(path_id),
            'name': str(tree.get('m_Name', '')),
            'rect': _vec(tree.get('m_Rect'), ('x', 'y', 'width', 'height')),
            'offset': _vec(tree.get('m_Offset'), ('x', 'y')),
            'pivot': _vec(tree.get('m_Pivot'), ('x', 'y')),
            'pixelsToUnits': float(tree.get('m_PixelsToUnits', 100.0) or 0.0),
            'border': _vec(tree.get('m_Border'), ('x', 'y', 'z', 'w')),
            'extrude': int(tree.get('m_Extrude', 0) or 0),
            'isPolygon': bool(tree.get('m_IsPolygon', False)),
            'texture': _pid(render_data.get('texture')),
            'alphaTexture': _pid(render_data.get('alphaTexture')),
            'textureRect': _vec(render_data.get('textureRect'), ('x', 'y', 'width', 'height')),
            'textureRectOffset': _vec(render_data.get('textureRectOffset'), ('x', 'y')),
            'downscaleMultiplier': float(render_data.get('downscaleMultiplier', 1.0) or 1.0),
            'mesh': {
                'vertexCount': sum(int(s.get('vertexCount', 0) or 0) for s in sub_meshes),
                'indexCount': sum(int(s.get('indexCount', 0) or 0) for s in sub_meshes),
                'indices': indices,
            },
        })

    textures = []
    for path_id in sorted(pid for pid, (kind, _) in trees.items() if kind == 'Texture2D'):
        _, tree = trees[path_id]
        textures.append({
            'pathId': str(path_id),
            'name': str(tree.get('m_Name', '')),
            'width': int(tree.get('m_Width', 0) or 0),
            'height': int(tree.get('m_Height', 0) or 0),
            'textureFormat': int(tree.get('m_TextureFormat', 0) or 0),
            'mipCount': int(tree.get('m_MipCount', 0) or 0),
            'dataSize': int(tree.get('m_CompleteImageSize', 0) or 0),
        })

    containers = []
    for path_id, (kind, tree) in trees.items():
        if kind != 'AssetBundle':
            continue
        for container_path, entry in tree.get('m_Container', ()):
            asset = (entry or {}).get('asset', {})
            containers.append({'path': str(container_path), 'asset': _pid(asset)})
    containers.sort(key=lambda item: item['path'])

    animation_clips = []
    for path_id in sorted(pid for pid, (kind, _) in trees.items() if kind == 'AnimationClip'):
        animation_clips.append(path_id)

    return {
        'gameObjects': game_objects,
        'transforms': transforms,
        'spriteRenderers': sprite_renderers,
        'animators': animators,
        'animatorControllers': animator_controllers,
        'sprites': sprites,
        'textures': textures,
        'containers': containers,
        'animationClipIds': animation_clips,
        'externals': external_files(env),
        'cabName': cab_name(env),
        'diagnostics': diagnostics,
    }

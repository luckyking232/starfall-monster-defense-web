"""Export original GLES materials and mesh emitters for the supported battle effects."""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
from pathlib import Path
import re
import struct

import numpy as np
import UnityPy
from UnityPy.helpers.CompressionHelper import decompress_lz4
from UnityPy.helpers.MeshHelper import MeshHandler

from native.bundle import load_bundle
from prepare_loading_inputs import catalog_entries
from prepare_native_presentation import ASSET_VERSION, atomic_write

ROOTS = (
    '6dc1c1a160b245faf655943af35fb351', '5cff5eb939dd2dd8d6002dd38691ae5b', 'd090a8dadccfce8ba49c3015b833bb1e',
    '5f43f1e62346002ab73f026a6bdfbb3f', '184da0b640674fdfc3f777748686155e', 'fc4d105a7dadb36f5643a856a1050abb',
    'd1de97331c03829cbb74cf4ca3154925', '10f90efd13a3004dd1015915d5cf8c2e', '6a66a468fd1aa40ed57abb8c30a3d3b6',
    'af8584569c4dad7cae9fcb1fc85a137d', '0d8edbda8a2fb3bc10dd357d1f17d558', 'c24ecb11af96b6625ab0ec361b74fd06',
    '1ff380bb47f9fbd014dacd53715de43c', '2786746e41f99244837de00139c5b540', '9c840c8f8a81af368d3bcd9d4b65c9f3',
    '5e6a8dbaee99f9a70b6833919afd5ce2', '65a6d962fcb2b42659111897d5367ac4', 'b57751f518f5b4796799d8e2e6538385',
    'b9f9d8f24f2f7ecc2fa6d4f57675dfa9',
    '8a02985753c02765768052453d962b5a',
    'dda59d6870ac0ba06721a482c7ec382b',
    '296d22740d04a333ea782365caa329f8',  # Dina's boulder projectile
    'e8d4e3121ba1e2f48cc3025ef46c929e',  # Dina's poison summon
)
APP = Path(__file__).resolve().parents[1]
LOADING = '7f1c82ca083451e0e7221d51f16a3e27'


def components(value, keys):
    return [value[k] for k in keys]


def column_major(matrix):
    return matrix.T.flatten().tolist()


def transform(tree):
    x, y, z, w = components(tree['m_LocalRotation'], 'xyzw')
    matrix = np.eye(4)
    rotation = np.array([
        [1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
        [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)],
        [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)],
    ])
    matrix[:3, :3] = rotation @ np.diag(components(tree['m_LocalScale'], 'xyz'))
    matrix[:3, 3] = components(tree['m_LocalPosition'], 'xyz')
    return matrix


def constant(value):
    if value['minMaxState'] != 0:
        raise ValueError('The source must contain a constant particle property')
    return value['scalar']


def value_range(value):
    if value['minMaxState'] == 0:
        return [value['scalar']] * 2
    if value['minMaxState'] == 3:
        return [value['minScalar'], value['scalar']]
    raise ValueError('Unexpected particle range')


def gradient_keys(gradient, count, times, channels):
    return [[gradient[f'{times}{i}'] / 65535, *components(gradient[f'key{i}'], channels)]
            for i in range(gradient[count])]


def gradient_data(gradient):
    return dict(rgb=gradient_keys(gradient, 'm_NumColorKeys', 'ctime', 'rgb'),
                alpha=gradient_keys(gradient, 'm_NumAlphaKeys', 'atime', 'a'))


def curve(value):
    mode = value['minMaxState']
    if mode == 0:
        return constant(value)
    if mode == 3:
        return value_range(value)
    if mode == 1:
        return [dict(scale=value['scalar'], keys=[[key[item] if math.isfinite(key[item]) else None for item in ('time', 'value', 'inSlope', 'outSlope')]
                for key in value['maxCurve']['m_Curve']])]
    raise ValueError(f'Unsupported curve mode {mode}')


def particle_data(system):
    initial = system['InitialModule']
    emission = system['EmissionModule']
    data = dict(delay=constant(system['startDelay']), speed=system['simulationSpeed'],
                life=value_range(initial['startLifetime']), size=value_range(initial['startSize']),
                rate=constant(emission['rateOverTime']), limit=initial['maxNumParticles'],
                duration=system['lengthInSec'], loop=system['looping'], hold=system['ringBufferMode'] != 0,
                ring=system['ringBufferMode'], ringRange=components(system['ringBufferLoopRange'], 'xy'),
                world=system['moveWithTransform'] == 1,
                bursts=[[item['time'], curve(item['countCurve']), item['cycleCount'], item['repeatInterval'], item['probability']]
                        for item in emission['m_Bursts']],
                startSpeed=curve(initial['startSpeed']), gravity=curve(initial['gravityModifier']),
                rotation=[curve(initial['startRotationX']) if initial['rotation3D'] else 0,
                          curve(initial['startRotationY']) if initial['rotation3D'] else 0, curve(initial['startRotation'])])
    if initial['startColor']['minMaxState'] == 2:
        data['minColor'] = components(initial['startColor']['minColor'], 'rgba')
    color = system['ColorModule']
    if color['enabled']:
        data.update(gradient_data(color['gradient']['maxGradient']))
    size = system['SizeModule']
    if size['enabled']:
        data['sizeOverLife'] = [curve(size['curve']), curve(size['y']), curve(size['z'])] if size['separateAxes'] else [curve(size['curve'])]
    rotation = system['RotationModule']
    if rotation['enabled']:
        data['spin'] = curve(rotation['curve'])
        if rotation['separateAxes']:
            data['spinXY'] = [curve(rotation['x']), curve(rotation['y'])]
    shape = system['ShapeModule']
    if shape['enabled']:
        data['shape'] = dict(kind=shape['type'], radius=shape['radius']['value'], thickness=shape['radiusThickness'],
                             coneAngle=shape['angle'], arc=shape['arc']['value'], scale=components(shape['m_Scale'], 'xyz'),
                             position=components(shape['m_Position'], 'xyz'), rotation=components(shape['m_Rotation'], 'xyz'),
                             randomDirection=shape['randomDirectionAmount'], sphericalDirection=shape['sphericalDirectionAmount'])
    velocity = system['VelocityModule']
    if velocity['enabled']:
        data['velocity'] = [curve(velocity[axis]) for axis in 'xyz']
        data['velocity'] = [val[0] if isinstance(val, list) and len(val) == 2 and val[0] == val[1] else val for val in data['velocity']]
        data['velocityModifier'] = curve(velocity['speedModifier'])
        data['velocityWorld'] = velocity['inWorldSpace']
    limit = system['ClampVelocityModule']
    if limit['enabled']:
        data['velocityLimit'] = dict(magnitude=curve(limit['magnitude']), dampen=limit['dampen'], drag=curve(limit['drag']),
                                     axes=[curve(limit[k]) for k in 'xyz'] if limit['separateAxis'] else None)
    noise = system['NoiseModule']
    if noise['enabled']:
        data['noise'] = dict(strength=curve(noise['strength']), frequency=noise['frequency'],
                             scroll=curve(noise['scrollSpeed']), position=curve(noise['positionAmount']),
                             rotation=curve(noise['rotationAmount']), size=curve(noise['sizeAmount']))
    custom = system['CustomDataModule']
    if custom['enabled']:
        data['custom'] = [curve(custom[f'vector0_{i}']) for i in range(custom['vectorComponentCount0'])]
    uv = system['UVModule']
    if uv['enabled']:
        frame = uv['frameOverTime']
        data['tiles'] = [uv['tilesX'], uv['tilesY'], frame['scalar']]
        data['flipbook'] = dict(frame=curve(frame), start=curve(uv['startFrame']),
                                cycles=uv['cycles'], row=uv['rowIndex'] if uv['animationType'] and uv['rowMode'] == 0 else None,
                                randomRow=bool(uv['animationType'] and uv['rowMode'] == 1))
    trail = system['TrailModule']
    if trail['enabled']:
        data['trail'] = dict(life=curve(trail['lifetime']), width=curve(trail['widthOverTrail']),
                             ratio=trail['ratio'], minDistance=trail['minVertexDistance'], **gradient_data(trail['colorOverTrail']['maxGradient']))
    return data


def programs(shader):
    """Unity 2021.3 subprogram table records offset, size and segment in little-endian order."""
    platform = shader['platforms'].index(5)  # GLES 2.0
    offset, = shader['offsets'][platform]
    length, = shader['compressedLengths'][platform]
    size, = shader['decompressedLengths'][platform]
    packed = bytes(shader['compressedBlob'])[offset:offset + length]
    blob = decompress_lz4(packed, size)
    count, = struct.unpack_from('<I', blob)
    variants = {}
    for index in range(count):
        start, length, segment = struct.unpack_from('<III', blob, 4 + 12 * index)
        if segment:
            raise ValueError('Multiple program segments require separate decoding')
        entry = blob[start:start + length]
        begin = entry.find(b'#ifdef VERTEX\n')
        if begin < 4:
            continue
        length, = struct.unpack_from('<I', entry, begin - 4)
        raw = entry[begin:begin + length].decode().rstrip('\0\r\n')
        match = re.fullmatch(r'#ifdef VERTEX\n(.*?)\n#endif\s*#ifdef FRAGMENT\n(.*?)\n#endif', raw, re.S)
        if not match:
            raise ValueError('Unrecognized GLES stage layout')
        keywords = frozenset(k.decode() for k in re.findall(rb'_[A-Z][A-Z_0-9]{2,}', entry[:begin]))
        variants[keywords] = dict(vertex=match[1], fragment=match[2], index=index,
                                  sha256=hashlib.sha256(entry[begin:begin + length]).hexdigest())
    return variants


class Extractor:
    def __init__(self, research, output, roots=ROOTS, loading_cache=None):
        self.output = output
        self.roots = roots
        manifest = json.loads((research / 'assets/download-manifest.json').read_bytes())
        if str(manifest['version']) != ASSET_VERSION:
            raise ValueError('Unexpected asset version')
        by_index = {item['manifest_index']: item for item in manifest['files']}
        by_hash = {item['hash']: item for item in manifest['files']}
        self.prefabs = {}
        self.objects = {}
        self.inputs = {}
        self.materials = {}
        self.meshes = {}
        self.textures = {}
        self.shaders = {}
        self.variants = {}
        self.root_files = {}
        self.bundle_by_cab = {}
        self.cameras = {}
        self.lifetimes = {}
        base = research / 'assets' / 'bundles' / ASSET_VERSION
        for root in roots:
            for item in [by_hash[root], *(by_index[i] for i in by_hash[root]['deps'])]:
                digest = item['hash']
                if digest in self.inputs:
                    continue
                name = digest + '.bundle'
                data = (base / 'original' / name).read_bytes()
                trimmed = (base / 'processed' / name).read_bytes()
                if (len(data) != item['size'] or hashlib.md5(data).hexdigest() != digest or
                        data[data.index(b'UnityFS'):] != trimmed):
                    raise ValueError('Invalid source bundle ' + name)
                self.index_bundle(digest, load_bundle(base / 'processed' / name), digest in roots)
                self.inputs[digest] = dict(name=item['name'], sha256=hashlib.sha256(data).hexdigest())
        if loading_cache is not None:
            self.roots = (*roots, LOADING)
            for digest, item in catalog_entries(research, with_effects=True).items():
                if digest in self.inputs:
                    continue
                name = digest + '.bundle'
                file = base / 'original' / name
                data = (file if file.exists() else loading_cache / name).read_bytes()
                if len(data) != item['size'] or hashlib.md5(data).hexdigest() != digest:
                    raise ValueError('Invalid loading bundle ' + name)
                if b'UnityFS' in data:
                    self.index_bundle(digest, UnityPy.load(io.BytesIO(data[data.index(b'UnityFS'):])), digest == LOADING)
                self.inputs[digest] = dict(name=item['name'], sha256=hashlib.sha256(data).hexdigest())

    def index_bundle(self, digest, env, root=False):
        objects = list(env.objects)
        for obj in objects:
            cab = obj.assets_file.name.lower()
            self.objects[(cab, obj.path_id)] = obj
            self.bundle_by_cab[cab] = digest
        if root:
            self.root_files[digest] = objects

    def resolve(self, obj, pointer):
        path = pointer['m_PathID']
        if not path:
            return None
        index = pointer['m_FileID']
        name = obj.assets_file.name if not index else obj.assets_file.externals[index-1].path.rsplit('/', 1)[-1]
        return self.objects[(name.lower(), path)]

    def texture(self, obj):
        key = str(obj.path_id)
        if key not in self.textures:
            tree = obj.read_typetree()
            data = io.BytesIO()
            obj.read().image.save(data, format='PNG')
            name = f'textures/{key}.png'
            atomic_write(self.output / name, data.getvalue())
            settings = tree['m_TextureSettings']
            self.textures[key] = dict(url=name, name=tree['m_Name'], filter=settings['m_FilterMode'],
                                      wrapU=settings['m_WrapU'], wrapV=settings['m_WrapV'],
                                      sha256=hashlib.sha256(data.getvalue()).hexdigest())
        return key

    def material(self, obj):
        key = str(obj.path_id)
        if key in self.materials:
            return key
        tree = obj.read_typetree()
        shader = self.resolve(obj, tree['m_Shader'])
        typetree = shader.read_typetree()
        if shader.path_id not in self.variants:
            self.variants[shader.path_id] = programs(typetree)
        keywords = frozenset(tree['m_ValidKeywords'])
        program = self.variants[shader.path_id][keywords]
        program_key = f'{shader.path_id}_{program["index"]}'
        self.shaders[program_key] = program
        props = tree['m_SavedProperties']
        saved = typetree['m_ParsedForm']
        defaults = {p['m_Name']: p for p in saved['m_PropInfo']['m_Props']}
        tex = {name: p['m_DefTexture']['m_DefaultName'] for name, p in defaults.items() if p['m_Type'] == 4}
        vec = {name + '_ST': [1, 1, 0, 0] for name in tex}
        vec.update({name: [p[f'm_DefValue[{i}]'] for i in range(4)] for name, p in defaults.items() if p['m_Type'] in (0, 1)})
        vec.update({name: components(value, 'rgba') for name, value in props['m_Colors']})
        scalars = {name: p['m_DefValue[0]'] for name, p in defaults.items() if p['m_Type'] in (2, 3, 5)}
        scalars.update(props['m_Floats'])
        for name, value in props['m_TexEnvs']:
            texture = self.resolve(obj, value['m_Texture'])
            tex[name] = self.texture(texture) if texture else tex.get(name, '')
            vec[name + '_ST'] = components(value['m_Scale'], 'xy') + components(value['m_Offset'], 'xy')
        state = saved['m_SubShaders'][0]['m_Passes'][0]['m_State']
        def state_value(item):
            return int(scalars.get(item['name'], item['val']))
        self.materials[key] = dict(name=tree['m_Name'], shader=program_key, keywords=sorted(keywords),
                                   textures=tex, vectors=vec, scalars=scalars,
                                   blend=[state_value(state['rtBlend0'][field]) for field in ('srcBlend', 'destBlend')],
                                   cull=state_value(state['culling']))
        return key

    def mesh(self, obj):
        key = str(obj.path_id)
        if key not in self.meshes:
            mesh = MeshHandler(obj.read())
            mesh.process()
            def flat(values):
                return [item for row in values or [] for item in row]
            self.meshes[key] = dict(vertices=flat(mesh.m_Vertices), normals=flat(mesh.m_Normals),
                                    uv0=flat(mesh.m_UV0), uv1=flat(mesh.m_UV1),
                                    indices=[i for group in mesh.get_triangles() for tri in group for i in tri])
        return key

    def quad(self, key, extent=(-.5, -.5, .5, .5), uv=(0, 0, 1, 1), color=None):
        if key not in self.meshes:
            l, b, r, t = extent
            x, y, u, v = uv
            self.meshes[key] = dict(vertices=[l,b,0,r,b,0,r,t,0,l,t,0], normals=[0,0,-1]*4,
                                    uv0=[x,y,u,y,u,v,x,v], uv1=[], indices=[0,2,1,0,3,2])
            if color:
                self.meshes[key]['colors'] = color
        return key

    def sprite(self, renderer, renderer_tree, material):
        sprite = self.resolve(renderer, renderer_tree['m_Sprite'])
        tree = sprite.read_typetree()
        image = self.resolve(sprite, tree['m_RD']['texture'])
        field = image.read_typetree()
        rect, pivot, ppu = tree['m_RD']['textureRect'], tree['m_Pivot'], tree['m_PixelsToUnits']
        ox, oy = components(tree['m_RD']['textureRectOffset'], 'xy')
        pivot_x, pivot_y = tree['m_Rect']['width'] * pivot['x'], tree['m_Rect']['height'] * pivot['y']
        w, h = rect['width'], rect['height']
        l, b = (ox - pivot_x) / ppu, (oy - pivot_y) / ppu
        u, v = rect['x'], rect['y']
        uv = [u / field['m_Width'], v / field['m_Height'], (u + w) / field['m_Width'], (v + h) / field['m_Height']]
        key = f'sprite-{sprite.path_id}'
        mesh = self.quad(key, [l, b, l + w / ppu, b + h / ppu], uv)
        source = self.materials[material]
        self.materials[key] = {**source, 'textures': {**source['textures'], '_MainTex': self.texture(image)}}
        return mesh, key

    def prefab(self, digest):
        objects = self.root_files[digest]
        groups = {}
        transforms = {}
        for obj in objects:
            tree = obj.read_typetree()
            if obj.type.name == 'AssetBundle':
                path = tree['m_Container'][0][0]
            if 'm_GameObject' in tree:
                groups.setdefault(tree['m_GameObject']['m_PathID'], {})[obj.type.name] = (obj, tree)
            if obj.type.name == 'Transform':
                transforms[obj.path_id] = tree
        path = path.lower()
        layers = []
        seconds, loop = 0, False
        for group in groups.values():
            current = group.get('Transform', (None, None))[1]
            matrix = np.eye(4)
            while current:
                matrix = transform(current) @ matrix
                current = transforms.get(current['m_Father']['m_PathID'])
            if 'Camera' in group:
                _, camera = group['Camera']
                self.cameras[path] = dict(view=column_major(np.linalg.inv(matrix)), position=matrix[:3, 3].tolist(),
                                          near=camera['near clip plane'], far=camera['far clip plane'],
                                          fov=camera['field of view'])
            key = next((key for key in ('ParticleSystemRenderer', 'SpriteRenderer', 'MeshRenderer') if key in group), None)
            if not key:
                continue
            renderer, r = group[key]
            if not r['m_Enabled']:
                continue
            material = self.material(self.resolve(renderer, r['m_Materials'][0]))
            layer = dict(material=material, color=components(r['m_Color'], 'rgba') if key == 'SpriteRenderer' else [1]*4,
                         transform=column_major(matrix), inverse=column_major(np.linalg.pinv(matrix)),
                         order=r['m_SortingOrder'])
            if key == 'MeshRenderer':
                mesh, data = group['MeshFilter']
                layer['mesh'] = self.mesh(self.resolve(mesh, data['m_Mesh']))
            elif key == 'SpriteRenderer':
                layer['mesh'], layer['material'] = self.sprite(renderer, r, material)
            else:
                _, system = group['ParticleSystem']
                particle = particle_data(system)
                burst_end = max((time + max(0, repeats-1) * repeat for time, _, repeats, repeat, _ in particle['bursts']), default=0)
                emission_end = max(burst_end, particle['duration'] if particle['rate'] else 0)
                seconds = max(seconds, (particle['delay'] + emission_end + max(particle['life'])) / particle['speed'])
                loop |= particle['loop']
                mode = r['m_RenderMode']
                mesh = self.mesh(self.resolve(renderer, r['m_Mesh'])) if mode == 4 else self.quad('particle-billboard')
                layer.update(mesh=mesh, color=components(system['InitialModule']['startColor']['maxColor'], 'rgba'),
                             streams=r['m_VertexStreams'], mode=mode, alignment=r['m_RenderAlignment'],
                             lengthScale=r['m_LengthScale'], velocityScale=r['m_VelocityScale'],
                             sortingFudge=r['m_SortingFudge'], particle=particle)
                if particle.get('trail'):
                    trail_material = self.material(self.resolve(renderer, r['m_Materials'][-1]))
                    gradient = particle['trail']
                    rgb = [channel for _, *channel in gradient['rgb']] or [[1]*3]
                    start, end = rgb[0], rgb[-1]
                    alpha = [val for _, val in gradient['alpha']] or [1]
                    layer.update(trailMaterial=trail_material,
                                 trailMesh=self.quad(f'trail-{material}', (0,-.5,1,.5), color=[
                                     *start, alpha[0], *end, alpha[-1], *end, alpha[-1], *start, alpha[0],
                                 ]))
            layers.append(layer)
        self.lifetimes[path] = dict(seconds=seconds, loop=loop)
        self.prefabs[path] = sorted(layers, key=lambda layer: layer['order'])

    def run(self):
        for digest in self.roots:
            self.prefab(digest)
        data = dict(version=ASSET_VERSION, inputs=self.inputs, prefabs=self.prefabs, shaders=self.shaders,
                    lifetimes=self.lifetimes, cameras=self.cameras,
                    meshes=self.meshes, materials=self.materials, textures=self.textures)
        output = self.output / 'mesh-effects.json'
        atomic_write(output, (json.dumps(data, sort_keys=True, separators=(',', ':'), allow_nan=False) + '\n').encode())
        files = {value['url']: {'sha256': value['sha256']} for value in self.textures.values()}
        files[output.name] = {'sha256': hashlib.sha256(output.read_bytes()).hexdigest()}
        atomic_write(self.output / 'manifest.json',
                     (json.dumps({'files': files, 'lifetimes': self.lifetimes}, sort_keys=True, indent=2) + '\n').encode())
        print(f'{len(self.prefabs)} prefabs, {sum(map(len,self.prefabs.values()))} layers, '
              f'{len(self.meshes)} meshes, {len(self.shaders)} shader variants, {len(self.textures)} textures')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--loading-cache', type=Path, default=None)
    parser.add_argument('--out', type=Path, default=APP / 'public' / 'assets' / 'effects')
    args = parser.parse_args()
    loading_cache = args.loading_cache or args.source.parent / 'monster-defense-development-20261126' / 'inputs'
    Extractor(args.source, args.out, loading_cache=loading_cache).run()

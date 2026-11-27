import { GlMeshRenderer, loadBattleImage, type GlMeshTexture } from './gl-mesh';
import { GlContextLost, GlContextRecovery } from './gl-context';
import type { NativeModel } from './native-world';
import type { Point3 } from './orthographic';
import { evaluateCurve, particleSamples, rotationAxes, type ParticleEmitter, type ParticleSample } from './particle-sampling';
import { assetUrl } from '../platform/assets';

type Mesh = Parameters<GlMeshRenderer['createMesh']>[0];
type Draw = Parameters<GlMeshRenderer['render']>[0][number];
type Material = Awaited<ReturnType<GlMeshRenderer['createMaterial']>>;
type Vec3 = [number, number, number];

interface SourceLayer {
  mesh: string;
  material: string;
  order: number;
  color: number[];
  transform: number[];
  inverse: number[];
  mode?: number;
  alignment?: number;
  lengthScale?: number;
  velocityScale?: number;
  sortingFudge?: number;
  pivotOffset?: Vec3;
  particle?: ParticleEmitter;
  trailMaterial?: string;
  trailMesh?: string;
}

interface EffectCamera {
  view: number[];
  position: number[];
  near: number;
  far: number;
  fov: number;
}

interface Catalog {
  prefabs: Record<string, SourceLayer[]>;
  meshes: Record<string, Mesh>;
  shaders: Record<string, { vertex: string; fragment: string }>;
  materials: Record<string, {
    shader: string;
    scalars: Record<string, number>;
    vectors: Record<string, number[]>;
    textures: Record<string, string>;
    blend: [source: number, destination: number];
    cull: number;
  }>;
  textures: Record<string, { url: string; filter: number; wrapU: number; wrapV: number }>;
  cameras: Record<string, EffectCamera>;
}

interface Layer { order: number; depth: number; additive: boolean; command: Draw }
interface MatrixPose { pose: ArrayLike<number>; inverse: ArrayLike<number> }
interface PositionHistory { age: number; position: Point3 }
interface ProjectileRequest {
  paths: ReadonlySet<string> | undefined;
  prepared: boolean;
  pending?: Promise<void>;
}

function projectileGraphics(canvas: HTMLCanvasElement) {
  return {
    renderer: new GlMeshRenderer(canvas, true),
    meshes: new Map<string, ReturnType<GlMeshRenderer['createMesh']>>(),
    materials: new Map<string, Material>(),
    materialLoads: new Map<string, Promise<void>>(),
    additive: new Set<string>(),
    prefabs: {} as Catalog['prefabs'],
    cameras: {} as Catalog['cameras'],
  };
}

const root = () => assetUrl('effects/');
const wrap = ['repeat','clamp','mirror','mirror'] as const;
// Unity BlendMode values correspond to the original GLES material pass state.
const blend = [0, 1, 0x0306, 0x0300, 0x0307, 0x0302, 0x0301, 0x0304, 0x0305, 0x0308, 0x0303] as const;
const battleProjection = [750 / (5 * 1334),0,0,0, 0,1/5,0,0, 0,0,0.002,0, 0,0,-0.8,1];
const battleCamera = [0,0,-100];
const origin: Vec3 = [0,0,0];
let library: Promise<Catalog> | undefined;

function loadCatalog(): Promise<Catalog> {
  library ??= fetch(new URL('mesh-effects.json', root())).then(response => {
    if (!response.ok) throw new Error('无法读取原生特效材质与网格');
    return response.json() as Promise<Catalog>;
  }).catch(error => {
    library = undefined;
    throw error;
  });
  return library;
}

function effectEntries(catalog: Catalog, group: 'battle' | 'loading', paths?: ReadonlySet<string>) {
  return Object.entries(catalog.prefabs).filter(([path]) =>
    (path in catalog.cameras) === (group === 'loading') && (!paths || paths.has(path)));
}

function materialKeys(layers: readonly SourceLayer[]): Set<string> {
  return new Set(layers.flatMap(layer => layer.trailMaterial ? [layer.material, layer.trailMaterial] : [layer.material]));
}

function materialTextures(catalog: Catalog, key: string): Record<string, GlMeshTexture> {
  const material = catalog.materials[key]!, program = catalog.shaders[material.shader]!;
  const textures: Record<string, GlMeshTexture> = {};
  for (const match of (program.vertex + program.fragment).matchAll(/uniform\s+(?:(?:lowp|mediump|highp)\s+)?sampler2D\s+(\w+)/g)) {
    const name = match[1]!, id = material.textures[name]!;
    if (id === 'white' || id === 'black') textures[name] = id;
    else {
      const source = catalog.textures[id];
      if (!source) throw new Error(`原特效材质缺纹理 ${name} (${key})`);
      textures[name] = { url: new URL(source.url, root()).href, filter: source.filter === 0 ? 'point' : 'bilinear',
        wrapU: wrap[source.wrapU]!, wrapV: wrap[source.wrapV]! };
    }
  }
  return textures;
}

function multiply(a: ArrayLike<number>, b: ArrayLike<number>): Float32Array {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      let value = 0;
      for (let k = 0; k < 4; k++) value += a[k * 4 + row]! * b[column * 4 + k]!;
      out[column * 4 + row] = value;
    }
  }
  return out;
}

function projection(source: EffectCamera, width: number, height: number) {
  const f = 1 / Math.tan(source.fov * Math.PI / 360);
  const distance = source.far - source.near;
  // Unity's camera looks along local +Z. WebGL clip depth maps near/far to [-1,1].
  const perspective = [f * height / width,0,0,0, 0,f,0,0, 0,0,(source.far+source.near)/distance,1,
    0,0,-2*source.far*source.near/distance,0];
  return multiply(perspective, source.view);
}

function transform(position: Vec3, scale: Vec3, rotation: Vec3, pivot?: Vec3): MatrixPose {
  const [sx,sy,sz] = scale;
  const [axisX,axisY,axisZ] = rotationAxes(rotation);
  const [x,y,z] = pivot ? position.map((value, axis) => value +
    axisX[axis]! * sx * pivot[0] + axisY[axis]! * sy * pivot[1] + axisZ[axis]! * sz * pivot[2]) as Vec3 : position;
  const pose = [axisX[0]*sx,axisX[1]*sx,axisX[2]*sx,0,
    axisY[0]*sy,axisY[1]*sy,axisY[2]*sy,0, axisZ[0]*sz,axisZ[1]*sz,axisZ[2]*sz,0, x,y,z,1];
  const inverse = [axisX[0]/sx,axisY[0]/sy,axisZ[0]/sz,0, axisX[1]/sx,axisY[1]/sy,axisZ[1]/sz,0,
    axisX[2]/sx,axisY[2]/sy,axisZ[2]/sz,0,
    -(x*axisX[0]+y*axisX[1]+z*axisX[2])/sx, -(x*axisY[0]+y*axisY[1]+z*axisY[2])/sy,
    -(x*axisZ[0]+y*axisZ[1]+z*axisZ[2])/sz,1];
  return { pose, inverse };
}

function applyPoint(matrix: ArrayLike<number>, [x,y,z]: Vec3): Vec3 {
  return [
    matrix[0]!*x + matrix[4]!*y + matrix[8]!*z + matrix[12]!,
    matrix[1]!*x + matrix[5]!*y + matrix[9]!*z + matrix[13]!,
    matrix[2]!*x + matrix[6]!*y + matrix[10]!*z + matrix[14]!,
  ];
}

function translate(matrix: Float32Array, delta: Vec3) {
  for (let i = 0; i < 3; i++) matrix[12 + i] = matrix[12 + i]! + delta[i]!;
}

function positionBehind(history: PositionHistory[], age: number): Point3 {
  const after = history.findIndex(({ age: stored }) => stored > age);
  if (after === -1) return history.at(-1)!.position;
  if (after === 0) return history[0]!.position;
  const prev = history[after - 1]!, next = history[after]!;
  const ratio = (age - prev.age) / (next.age - prev.age);
  return { x: prev.position.x + (next.position.x - prev.position.x) * ratio,
    y: prev.position.y + (next.position.y - prev.position.y) * ratio,
    z: prev.position.z + (next.position.z - prev.position.z) * ratio };
}

function drawPose(layer: SourceLayer, world: MatrixPose, sample: ParticleSample, delta: Vec3): MatrixPose {
  const worldPosition = applyPoint(world.pose, sample.position);
  for (let i = 0; i < 3; i++) worldPosition[i] = worldPosition[i]! + delta[i]!;
  if (layer.alignment === 0 && layer.mode !== 4) {
    const lengths = [0,4,8].map(i => Math.hypot(world.pose[i]!, world.pose[i+1]!, world.pose[i+2]!) || 1);
    const size = sample.size.map((value, i) => value * lengths[i]!) as Vec3;
    const rotation: Vec3 = [...sample.rotation];
    if (layer.mode === 1) {
      const ahead = applyPoint(world.pose, sample.position.map((x, i) => x + sample.velocity[i]!) as Vec3);
      const dx = ahead[0] - (worldPosition[0] - delta[0]), dy = ahead[1] - (worldPosition[1] - delta[1]);
      size[1] *= Math.max(1, layer.lengthScale ?? 1) + Math.hypot(dx, dy) * (layer.velocityScale ?? 0);
      if (dx || dy) rotation[2] += Math.atan2(dy, dx) - Math.PI / 2;
    }
    return transform(worldPosition, size, rotation, layer.pivotOffset);
  }
  const local = transform(sample.position, sample.size, sample.rotation, layer.pivotOffset);
  const pose = multiply(world.pose, local.pose);
  translate(pose, delta);
  const inverse = multiply(local.inverse, world.inverse);
  const translation = applyPoint(inverse, delta);
  for (let i = 0; i < 3; i++) inverse[12 + i] = 2 * inverse[12 + i]! - translation[i]!;
  return { pose, inverse };
}

export class MeshProjectiles {
  private graphics: ReturnType<typeof projectileGraphics>;
  private readonly recovery: GlContextRecovery;
  private readonly history = new Map<number, PositionHistory[]>();
  private readonly draws: Layer[] = [];
  private readonly live = new Set<number>();
  private requested: ProjectileRequest | undefined;
  private rebuilding: Promise<void> | undefined;
  private restorationFailure: {reason: unknown} | undefined;
  private disposed = false;

  get renderer(): GlMeshRenderer { return this.graphics.renderer; }

  get drawable(): boolean {
    return !this.disposed && !this.recovery.waiting && !this.rebuilding && !this.restorationFailure;
  }

  static async prefetch(paths?: ReadonlySet<string>): Promise<HTMLImageElement[]> {
    const catalog = await loadCatalog();
    const layers = effectEntries(catalog, 'battle', paths).flatMap(([, layers]) => layers);
    const urls = new Set<string>();
    for (const key of materialKeys(layers)) for (const texture of Object.values(materialTextures(catalog, key))) {
      if (typeof texture !== 'string') urls.add(texture.url);
    }
    return Promise.all([...urls].map(loadBattleImage));
  }

  resize(width: number, height: number): void {
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
  }

  constructor(width: number, height: number, private readonly group: 'battle' | 'loading',
    private readonly callbacks: {restored?: () => void; fail: (reason: unknown) => void},
    private readonly canvas = document.createElement('canvas')) {
    this.canvas.width = width;
    this.canvas.height = height;
    this.graphics = projectileGraphics(canvas);
    this.recovery = new GlContextRecovery(canvas, this.renderer.gl, () => this.renderer.invalidate(), this.restore);
  }

  prepare(paths?: ReadonlySet<string>): Promise<void> {
    const active = this.requested;
    if (active?.pending && active.paths === paths) return active.pending;
    const request: ProjectileRequest = {paths, prepared:false};
    this.requested = request;
    request.pending = this.loadWhenAvailable(request).then(() => {
      request.prepared = this.isCurrent(request);
    }).finally(() => { delete request.pending; });
    return request.pending;
  }

  private readonly restore = () => {
    try {
      this.graphics = projectileGraphics(this.canvas);
      const request = this.requested;
      // Pending callers already wait for this context and retain their own error handling.
      const rebuilding = request?.prepared ? this.loadWhenAvailable(request) : Promise.resolve();
      this.rebuilding = rebuilding;
      void rebuilding.then(() => {
        if (this.disposed || this.rebuilding !== rebuilding) return;
        this.rebuilding = undefined;
        this.callbacks.restored?.();
      }, error => {
        if (this.disposed || this.rebuilding !== rebuilding) return;
        this.rebuilding = undefined;
        if (this.requested === request) this.failRestore(error);
      });
    } catch (error) {
      if (!this.recoverFrom(error)) this.failRestore(error);
    }
  };

  private failRestore(reason: unknown): void {
    this.restorationFailure = {reason};
    if (!this.disposed) this.callbacks.fail(reason);
  }

  recoverFrom(error: unknown): boolean {
    return error instanceof GlContextLost && !!this.recovery.waiting;
  }

  private isCurrent(request: ProjectileRequest): boolean { return !this.disposed && this.requested === request; }

  private async loadWhenAvailable(request: ProjectileRequest): Promise<void> {
    while (this.isCurrent(request)) {
      if (this.restorationFailure) throw this.restorationFailure.reason;
      const waiting = this.recovery.waiting;
      if (waiting) {
        await waiting;
        continue;
      }
      const graphics = this.graphics;
      try {
        await this.load(graphics, request);
        if (graphics === this.graphics && !this.recovery.waiting) return;
      } catch (error) {
        if (!this.isCurrent(request)) return;
        if (!(error instanceof GlContextLost) || (graphics === this.graphics && !this.recovery.waiting)) throw error;
      }
    }
  }

  private async load(graphics: ReturnType<typeof projectileGraphics>, request: ProjectileRequest): Promise<void> {
    const {renderer, meshes, prefabs} = graphics;
    const catalog = await loadCatalog();
    if (!this.isCurrent(request)) return;
    const entries = effectEntries(catalog, this.group, request.paths).filter(([path]) => !(path in prefabs));
    const layers = entries.flatMap(([, layers]) => layers);
    const meshKeys = new Set(layers.flatMap(layer => layer.trailMesh ? [layer.mesh, layer.trailMesh] : [layer.mesh]));
    for (const key of meshKeys) {
      if (meshes.has(key)) continue;
      const mesh = catalog.meshes[key]!;
      const vertices = mesh.vertices.length / 3;
      const zero = new Float32Array(vertices * 4);
      meshes.set(key, renderer.createMesh({
        ...mesh, ...(mesh.normals?.length ? { normals: mesh.normals } : { normals: new Float32Array(vertices * 3) }),
        ...(mesh.uv0?.length ? { uv0: mesh.uv0 } : { uv0: new Float32Array(vertices * 2) }),
        uv1: mesh.uv1?.length ? mesh.uv1 : new Float32Array(vertices * 2),
        texcoord1: zero, texcoord2: zero,
      }));
    }
    await Promise.all([...materialKeys(layers)].map(key => this.loadMaterial(graphics, catalog, key)));
    if (!this.isCurrent(request)) return;
    renderer.endFrame();
    for (const [path, layers] of entries) prefabs[path] = layers;
    graphics.cameras = catalog.cameras;
  }

  private loadMaterial(graphics: ReturnType<typeof projectileGraphics>, catalog: Catalog, key: string): Promise<void> | undefined {
    const {renderer, materials, materialLoads, additive} = graphics;
    if (materials.has(key)) return;
    const cached = materialLoads.get(key);
    if (cached) return cached;
    const load = (async () => {
      const material = catalog.materials[key]!, program = catalog.shaders[material.shader]!;
      const [src, dst] = material.blend;
      if (dst === 1) additive.add(key);
      const cull = material.cull === 1 ? 'front' : material.cull === 2 ? 'back' : undefined;
      const ready = await renderer.createMaterial({
        vertexShader: program.vertex, fragmentShader: program.fragment, textures: materialTextures(catalog, key),
        uniforms: { _ImageExporterRenderShaderBlendMASK: 0, _WorldSpaceLightPos0: [0,0,0,0],
          _ClipBox: [0,0,0,0], ...material.scalars, ...material.vectors },
        blend: { src: blend[src]!, dst: blend[dst]! },
        ...(cull ? { cull } : {}),
      });
      materials.set(key, ready);
    })().finally(() => materialLoads.delete(key));
    materialLoads.set(key, load);
    return load;
  }

  private modelHistory(model: NativeModel, layers: SourceLayer[]): PositionHistory[] {
    const age = model.age ?? 0;
    if (model.instance === undefined || !layers.some(layer => layer.particle?.world || layer.trailMesh)) {
      return [{ age, position: model.position }];
    }
    let samples = this.history.get(model.instance);
    if (!samples || age < samples.at(-1)!.age) {
      samples = [];
      this.history.set(model.instance, samples);
    }
    const previous = samples.at(-1);
    if (!previous || age > previous.age) samples.push({ age, position: model.position });
    while (samples.length > 2 && samples[1]!.age < age - 5) samples.shift();
    return samples;
  }

  layers(models: readonly NativeModel[], seconds: number): Layer[] {
    const { draws, live } = this;
    const { prefabs, cameras, additive, meshes, materials } = this.graphics;
    draws.length = 0;
    live.clear();
    const time = [seconds/20,seconds,seconds*2,seconds*3];
    for (const model of models) {
      const layers = prefabs[model.path];
      if (!layers) continue;
      if (model.instance !== undefined) live.add(model.instance);
      const { x: sx, y: sy, z: sz } = model.scale;
      if (!sx || !sy || !sz) continue;
      const angle = model.right ? Math.atan2(model.right.y, model.right.x) : 0;
      const { x,y,z } = model.position;
      const base = transform([x,y,z], [sx,sy,sz], [0,0,angle]);
      const sourceCamera = cameras[model.path];
      const viewProjection = sourceCamera ? projection(sourceCamera, this.canvas.width, this.canvas.height) : battleProjection;
      const cameraPosition = sourceCamera?.position ?? battleCamera;
      const history = this.modelHistory(model, layers);
      const age = model.age ?? 0;
      for (const [index, layer] of layers.entries()) {
        const world = { pose: multiply(base.pose, layer.transform), inverse: multiply(layer.inverse, base.inverse) };
        const command = (mesh: string, material: string, pose: MatrixPose, color: number[], particle?: ParticleSample) => {
          draws.push({ order: model.order + layer.order, depth: pose.pose[14]! + (layer.sortingFudge ?? 0),
            additive: additive.has(material),
            command: { mesh: meshes.get(mesh)!, material: materials.get(material)!,
              objectToWorld: pose.pose, worldToObject: pose.inverse, viewProjection, cameraPosition,
              time, vertexColor: color,
              ...(particle?.uv ? { uvRect: particle.uv } : {}), ...(particle?.custom1 ? { custom1: particle.custom1 } : {}),
            },
          });
        };
        const emitter = layer.particle;
        if (!emitter) {
          command(layer.mesh, layer.material, world, layer.color);
          continue;
        }
        const samples = particleSamples(emitter, layer.color, age, model.instance ?? 0, index);
        for (const sample of samples) {
          if (!sample.size.every(value => value > 0) || !sample.color[3]) continue;
          const old = emitter.world ? positionBehind(history, sample.emittedAt) : model.position;
          const delta: Vec3 = [old.x - x, old.y - y, old.z - z];
          if (layer.mode !== 5) command(layer.mesh, layer.material, drawPose(layer, world, sample, delta), sample.color, sample);
          if (!emitter.trail || !layer.trailMesh || !layer.trailMaterial) continue;
          const duration = evaluateCurve(emitter.trail.life, 0);
          const back = positionBehind(history, age - duration);
          const dx = x - back.x, dy = y - back.y;
          const distance = Math.hypot(dx, dy);
          if (!distance) continue;
          const width = Math.abs(sy) * sample.size[0] * evaluateCurve(emitter.trail.width, 0);
          const head = applyPoint(world.pose, origin);
          const tail = transform([head[0]-dx,head[1]-dy,head[2]], [distance,width,1], [0,0,Math.atan2(dy,dx)]);
          command(layer.trailMesh, layer.trailMaterial, tail, sample.color);
        }
      }
    }
    for (const key of this.history.keys()) if (!live.has(key)) this.history.delete(key);
    return draws.sort((a,b) => a.order-b.order || b.depth-a.depth);
  }

  draw(context: CanvasRenderingContext2D, layers: readonly Layer[], from = 0, to = layers.length): void {
    if (from === to) return;
    context.save();
    try {
      let start = from;
      while (start < to) {
        const additive = layers[start]!.additive;
        let end = start + 1;
        while (end < to && layers[end]!.additive === additive) end++;
        this.renderer.beginFrame();
        this.drawRange(layers, start, end);
        this.renderer.endFrame();
        context.globalCompositeOperation = additive ? 'lighter' : 'source-over';
        context.drawImage(this.canvas,0,0);
        start = end;
      }
    } finally {
      context.restore();
    }
  }

  drawRange(layers: readonly Layer[], start: number, end: number): void {
    for (let i = start; i < end; i++) this.renderer.draw(layers[i]!.command);
  }

  clearStage(): void {
    this.requested = undefined;
    this.history.clear();
    this.live.clear();
    this.draws.length = 0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.recovery.dispose();
    this.renderer.dispose();
  }
}

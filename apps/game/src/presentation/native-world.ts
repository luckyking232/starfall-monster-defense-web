import { createOrthographicProjection, type Point3 } from './orthographic';
import { compilePrefabPlayer, drawPrefabSpriteRange, type PrefabSpriteCommand } from './prefab-player';
import type { RuleState } from '../engine/protocol';
import { MeshProjectiles } from './mesh-projectiles';
import { loadBattleImage } from './gl-mesh';
import { assetUrl } from '../platform/assets';
import { GlSprites } from './gl-sprites';
import { visitWorldLayers } from './world-layers';

export interface NativeModel {
  path: string;
  position: Point3;
  scale: Point3;
  clip?: string;
  time: number;
  order: number;
  right?: Point3;
  age?: number;
  instance?: number;
}
interface Catalog {
  prefabs: {container:string; json:string; kind:string}[];
}
declare const __STARFALL_STAGE_ASSETS__: Readonly<Record<number, readonly string[]>>;
const stageAssets = new Map<number, ReadonlySet<string>>(Object.entries(
  typeof __STARFALL_STAGE_ASSETS__ === 'undefined' ? {} : __STARFALL_STAGE_ASSETS__,
).map(([stage, paths]) => [Number(stage), new Set(paths)]));
const base = () => assetUrl('native/');
async function readJson<T>(url: URL): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error('无法读取原生画面资源 '+url.pathname);
  return await response.json() as T;
}
type Player = ReturnType<typeof compilePrefabPlayer>;
type Prefab = Parameters<typeof compilePrefabPlayer>[0];
interface StageResources {
  players: Map<string, Player>;
  frames: Map<string, HTMLImageElement>;
  // Retain decoded effect textures for the same window as the sprite frames.
  effectImages: readonly HTMLImageElement[];
}
const camera = {
  position:{x:0,y:0,z:-100},rotation:{x:0,y:0,z:0,w:1},orthographicSize:5,
};
let catalog: Promise<Catalog> | undefined;
const prefabs = new Map<string, Promise<{ player: Player; files: string[] }>>();
const stageLoads = new Map<number, Promise<StageResources>>();
const recentStages = new Map<number, StageResources>();
const RESIDENT_STAGES = 2;

function loadPrefab(item: Catalog['prefabs'][number]) {
  let entry = prefabs.get(item.json);
  if (!entry) {
    entry = readJson<Prefab>(new URL(item.json, base())).then(document => ({
      player: compilePrefabPlayer(document, { filterForTexture: () => item.kind === 'map' ? 'bilinear' : 'point' }),
      files: document.objects.sprites.map(sprite => sprite.frame.file),
    })).catch(error => { prefabs.delete(item.json); throw error; });
    prefabs.set(item.json, entry);
  }
  return entry;
}

function loadStage(stageId: number): Promise<StageResources> {
  const cached = recentStages.get(stageId);
  if (cached) {
    recentStages.delete(stageId);
    recentStages.set(stageId, cached);
    return Promise.resolve(cached);
  }
  const existing = stageLoads.get(stageId);
  if (existing) return existing;
  catalog ??= readJson<Catalog>(new URL('manifest.json', base())).catch(error => { catalog = undefined; throw error; });
  const paths = stageAssets.get(stageId);
  const sprites = catalog.then(async manifest => {
    const entries = paths ? manifest.prefabs.filter(item => paths.has(item.container.toLowerCase())) : manifest.prefabs;
    const players = new Map<string,Player>();
    const files = new Set<string>();
    await Promise.all(entries.map(async item => {
      const prefab = await loadPrefab(item);
      players.set(item.container.toLowerCase(), prefab.player);
      for (const file of prefab.files) files.add(file);
    }));
    const frames = new Map<string,HTMLImageElement>();
    await Promise.all([...files].map(async (file) => {
      frames.set(file,await loadBattleImage(new URL(file,base()).href));
    }));
    return { players, frames };
  });
  const stage = Promise.all([sprites, MeshProjectiles.prefetch(paths)]).then(([sprites, effectImages]) => {
    const resources = { ...sprites, effectImages };
    recentStages.set(stageId, resources);
    if (recentStages.size > RESIDENT_STAGES) recentStages.delete(recentStages.keys().next().value!);
    return resources;
  }).finally(() => stageLoads.delete(stageId));
  stageLoads.set(stageId, stage);
  return stage;
}

export class NativeBattlefield {
  private readonly ready: Promise<void>;
  private canvas!: HTMLCanvasElement;
  private context: CanvasRenderingContext2D | undefined;
  private effects!: MeshProjectiles;
  private sprites: GlSprites | undefined;
  private resources: Awaited<ReturnType<typeof loadStage>> | undefined;
  private readonly commands: PrefabSpriteCommand[] = [];
  private readonly models: NativeModel[] = [];
  private readonly mapCommands: PrefabSpriteCommand[] = [];
  private map: NativeModel | undefined;
  private disposed = false;
  private generation = 0;
  private economy = false;
  private project = createOrthographicProjection(camera,{width:1334,height:750});

  setEconomy(enabled: boolean): void {
    if (this.economy === enabled) return;
    this.economy = enabled;
    const width = enabled ? 667 : 1334, height = enabled ? 375 : 750;
    this.project = createOrthographicProjection(camera,{width,height});
    this.canvas.width = width;
    this.canvas.height = height;
    this.effects?.resize(width,height);
    this.map = undefined;
    this.mapCommands.length = 0;
  }

  constructor(private readonly parent: HTMLElement, merged = new URLSearchParams(location.search).get('world') === 'webgl') {
    this.ready = this.prepareRenderer(merged);
  }

  static async prefetch(stageId: number): Promise<void> { await loadStage(stageId); }

  async prepareStage(stageId: number): Promise<void> {
    const generation = ++this.generation;
    const dependencies = stageAssets.get(stageId);
    const [, resources] = await Promise.all([this.ready, loadStage(stageId)]);
    if (this.disposed || generation !== this.generation) return;
    await this.effects.prepare(dependencies);
    if (this.disposed || generation !== this.generation) return;
    if (this.sprites) {
      try {
        this.sprites.prepare(resources.frames);
        this.effects.renderer.endFrame();
      } catch {
        this.sprites.dispose();
        this.sprites = undefined;
        this.effects.dispose();
        await this.prepareRenderer(false);
        await this.effects.prepare(dependencies);
      }
    }
    if (!this.disposed && generation === this.generation) this.resources = resources;
  }

  private async prepareRenderer(merged: boolean): Promise<void> {
    const canvas = document.createElement('canvas');
    canvas.width = this.economy ? 667 : 1334;
    canvas.height = this.economy ? 375 : 750;
    canvas.style.cssText = 'width:100%;height:100%;display:block';
    canvas.setAttribute('aria-label','战场画面');
    canvas.dataset['renderer'] = merged ? 'webgl' : 'canvas';
    this.canvas = canvas;
    try {
      if (!merged) {
        const context = canvas.getContext('2d');
        if (!context) throw new Error('浏览器无法创建战场画布');
        this.context = context;
      }
      this.effects = new MeshProjectiles(canvas.width, canvas.height, 'battle', merged ? canvas : undefined);
      if (merged) {
        this.sprites = new GlSprites(this.effects.renderer.gl);
        this.effects.renderer.endFrame();
      }
      this.parent.replaceChildren(canvas);
    } catch (error) {
      this.sprites?.dispose();
      this.sprites = undefined;
      this.effects?.dispose();
      if (!merged || this.disposed) throw error;
      await this.prepareRenderer(false);
    }
  }

  private sample(model: NativeModel, output: PrefabSpriteCommand[]): void {
    const player = this.resources!.players.get(model.path);
    if (!player) return;
    const angle = model.right ? Math.atan2(model.right.y,model.right.x) / 2 : 0;
    player.sample(this.project, {
      pose: {position:model.position,scale:model.scale,rotation:{x:0,y:0,z:Math.sin(angle),w:Math.cos(angle)}},
      sortingOrderOffset:model.order,
      ...(model.clip ? {animation:{clipName:model.clip,elapsedSeconds:model.time}} : {}),
    }, output);
  }

  private readonly resolveFrame = (file: string) => this.resources!.frames.get(file);

  render(state: RuleState): void {
    if (!this.resources) return;
    const { commands, models, context, sprites, effects } = this;
    const map = state.background;
    if (!sameMap(this.map, map)) {
      this.map = map;
      this.mapCommands.length = 0;
      if (map) this.sample(map, this.mapCommands);
    }
    commands.length = 0;
    commands.push(...this.mapCommands);
    models.length = 0;
    for (const unit of state.units) if (unit.model) models.push(unit.model);
    if (state.bullets) models.push(...state.bullets);
    if (state.effects) models.push(...state.effects);
    for (const model of models) this.sample(model, commands);
    const layers = effects.layers(models, state.fixedFrame / 30);
    if (sprites) {
      effects.renderer.beginFrame();
      visitWorldLayers(commands, layers, (start, end) => sprites.draw(commands, start, end),
        (start, end) => effects.drawRange(layers, start, end));
      effects.renderer.endFrame();
    } else if (context) {
      context.clearRect(0,0,this.canvas.width,this.canvas.height);
      visitWorldLayers(commands, layers, (start, end) => drawPrefabSpriteRange(context, commands, this.resolveFrame, start, end),
        (start, end) => effects.draw(context, layers, start, end));
    }
  }

  reset(): void {
    this.generation++;
    this.resources = undefined;
    this.context?.clearRect(0,0,this.canvas.width,this.canvas.height);
    if (this.sprites) this.effects.renderer.beginFrame();
    this.effects?.layers([],0);
    this.map = undefined;
    this.mapCommands.length = this.commands.length = this.models.length = 0;
  }

  dispose(): void {
    this.disposed = true;
    this.resources = undefined;
    this.sprites?.dispose();
    this.effects?.dispose();
    this.canvas.remove();
  }
}

function samePoint(a: Point3 | undefined, b: Point3 | undefined): boolean {
  return a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.z === b.z);
}

function sameMap(a: NativeModel | undefined, b: NativeModel | undefined): boolean {
  return a === b || (!!a && !!b && a.path === b.path && a.order === b.order && a.clip === b.clip &&
    (!a.clip || a.time === b.time) && samePoint(a.position, b.position) && samePoint(a.scale, b.scale) && samePoint(a.right, b.right));
}

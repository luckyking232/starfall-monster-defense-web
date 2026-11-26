import { createOrthographicProjection, type Point3 } from './orthographic';
import { compilePrefabPlayer, drawPrefabSprites, type PrefabSpriteCommand } from './prefab-player';
import type { RuleState } from '../engine/protocol';
import { MeshProjectiles } from './mesh-projectiles';
import { loadBattleImage } from './gl-mesh';

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
const base = () => new URL('assets/native/',document.baseURI);
async function readJson<T>(url: URL): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error('无法读取原生画面资源 '+url.pathname);
  return await response.json() as T;
}
type Player = ReturnType<typeof compilePrefabPlayer>;
type Prefab = Parameters<typeof compilePrefabPlayer>[0];
const project = createOrthographicProjection({
  position:{x:0,y:0,z:-100},rotation:{x:0,y:0,z:0,w:1},orthographicSize:5,
},{width:1334,height:750});
let library: Promise<{players:Map<string,Player>; frames:Map<string,HTMLImageElement>}> | undefined;
function loadLibrary() {
  library ??= (async () => {
    const manifest = await readJson<Catalog>(new URL('manifest.json',base()));
    const players = new Map<string,Player>();
    const files = new Set<string>();
    await Promise.all(manifest.prefabs.map(async (item) => {
      const document = await readJson<Prefab>(new URL(item.json,base()));
      const player = compilePrefabPlayer(document,{filterForTexture:()=>item.kind==='map'?'bilinear':'point'});
      players.set(item.container.toLowerCase(),player);
      for (const sprite of document.objects.sprites) files.add(sprite.frame.file);
    }));
    const frames = new Map<string,HTMLImageElement>();
    await Promise.all([...files].map(async (file) => {
      frames.set(file,await loadBattleImage(new URL(file,base()).href));
    }));
    return {players,frames};
  })().catch(error=>{ library=undefined; throw error; });
  return library;
}

export class NativeBattlefield {
  readonly ready: Promise<void>;
  private readonly canvas = document.createElement('canvas');
  private readonly context: CanvasRenderingContext2D;
  private readonly effects: MeshProjectiles;
  private resources: Awaited<ReturnType<typeof loadLibrary>> | undefined;
  constructor(parent: HTMLElement) {
    this.canvas.width=1334;
    this.canvas.height=750;
    this.canvas.style.cssText='width:100%;height:100%;display:block';
    this.canvas.setAttribute('aria-label','战场画面');
    const ctx=this.canvas.getContext('2d');
    if(!ctx) throw new Error('浏览器无法创建战场画布');
    this.context=ctx;
    parent.replaceChildren(this.canvas);
    this.effects = new MeshProjectiles(this.canvas.width, this.canvas.height);
    this.ready = Promise.all([loadLibrary(), this.effects.ready]).then(([resources]) => {
      this.resources = resources;
    });
  }
  render(state: RuleState): void {
    if (!this.resources) return;
    const commands: PrefabSpriteCommand[]=[];
    const sample=(model?:NativeModel)=>{
      if(!model) return;
      const player=this.resources!.players.get(model.path);
      if(!player) return;
      const angle=model.right ? Math.atan2(model.right.y,model.right.x)/2 : 0;
      commands.push(...player.sample(project,{
        pose:{position:model.position,scale:model.scale,rotation:{x:0,y:0,z:Math.sin(angle),w:Math.cos(angle)}},
        sortingOrderOffset:model.order,
        ...(model.clip ? {animation:{clipName:model.clip,elapsedSeconds:model.time}} : {}),
      }));
    };
    const models = [
      ...state.units.flatMap((unit) => unit.model ? [unit.model] : []),
      ...state.bullets ?? [],
      ...state.effects ?? [],
    ];
    sample(state.background);
    for (const model of models) sample(model);
    this.context.clearRect(0,0,1334,750);
    const resolveFrame = (file: string) => this.resources!.frames.get(file);
    const effects = this.effects.layers(models, state.fixedFrame / 30);
    if (!effects.length) {
      drawPrefabSprites(this.context, commands, resolveFrame);
      return;
    }
    // Merge both renderer types in the original sorting layer and order.
    let pending = commands;
    let cursor = 0;
    while (cursor < effects.length) {
      const order = effects[cursor]!.order;
      const behind = (item: PrefabSpriteCommand) => item.sortingLayer < 0 ||
        (item.sortingLayer === 0 && item.sortingOrder <= order);
      drawPrefabSprites(this.context, pending.filter(behind), resolveFrame);
      pending = pending.filter(item => !behind(item));
      let end = cursor + 1;
      while (end < effects.length && effects[end]!.order === order) end++;
      this.effects.draw(this.context, effects.slice(cursor, end));
      cursor = end;
    }
    drawPrefabSprites(this.context, pending, resolveFrame);
  }

  reset(): void {
    this.context.clearRect(0,0,this.canvas.width,this.canvas.height);
    this.effects.layers([],0);
  }

  dispose(): void {
    this.effects.dispose();
    this.canvas.remove();
  }
}

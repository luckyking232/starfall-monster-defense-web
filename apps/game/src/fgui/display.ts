import Phaser from 'phaser';
import { layoutList, layoutLoader } from './layout';
import type { UiOp, UiTreeNode } from '../../runtime/ui/protocol';
import { installPhaserViewport } from '../platform/viewport';
import { toFguiChild } from '../ui/tree';
import {
  PackageRegistry, type FguiBitmapFont, type FguiChild, type FguiComponent, type FguiDependencies, type FguiPackage, type FguiSprite,
  type FguiTransitionTrack, type FguiTransitionValue,
} from './package';
import { FguiTransitionPlayback, type FguiTransitionCallbacks } from './transition';
import { paintUbbColors, parseUbbColors, wrapFguiText } from './ubb';

export interface FguiNode {
  path: string;
  source: FguiChild;
  definition: FguiComponent | undefined;
  parent: FguiNode | undefined;
  container: Phaser.GameObjects.Container;
  x: number;
  y: number;
  width: number;
  height: number;
  children: Map<string, FguiNode>;
  content?: Phaser.GameObjects.GameObject;
  bitmapText?: { draw(value: string): void };
  ubbSource?: string;
  list?: {
    container: Phaser.GameObjects.Container;
    items: FguiNode[];
    scrollX: number;
    scrollY: number;
    clip?: { mask: Phaser.Display.Masks.GeometryMask } | { viewport: Phaser.GameObjects.Container };
  };
  controllers: Map<string, number>;
  explicitVisible: boolean;
  maskOnly?: boolean;
  clip?: FguiNode;
  hasAction?: boolean;
  acceptsWheel?: boolean;
}

export interface FguiAction {
  path: string;
  sourceId: string;
  objectType: string;
  componentId?: number;
}

interface ScrollPress {
  node: FguiNode;
  originX: number;
  originY: number;
  scrollX: number;
  scrollY: number;
  horizontal: boolean;
}

interface PointerPress {
  action: FguiNode | undefined;
  scroll: ScrollPress | undefined;
  dragged: boolean;
}

const DAMAGE_NUMBERS = new Set(['NormalHitNumberTips', 'CritHitNumberTips', 'GreenHpNumberTips']);
const DAMAGE_NUMBER_POOL_LIMIT = 96;

function nineSliceAxis(
  sourceSize: number,
  startBorder: number,
  endBorder: number,
  trimStart: number,
  trimSize: number,
  targetSize: number,
) {
  const borders = startBorder + endBorder;
  const borderScale = borders > targetSize ? targetSize / borders : 1;
  const source = [0, startBorder, sourceSize - endBorder, sourceSize];
  const target = [0, startBorder * borderScale, targetSize - endBorder * borderScale, targetSize];
  return [0, 1, 2].flatMap((index) => {
    const start = source[index]!;
    const end = source[index + 1]!;
    const targetStart = target[index]!;
    const targetSpan = target[index + 1]! - targetStart;
    const visibleStart = Math.max(start, trimStart);
    const visibleEnd = Math.min(end, trimStart + trimSize);
    if (visibleEnd <= visibleStart || targetSpan <= 0) return [];
    const scale = targetSpan / (end - start);
    return [{
      sourceStart: visibleStart - trimStart,
      sourceSize: visibleEnd - visibleStart,
      targetStart: targetStart + (visibleStart - start) * scale,
      targetSize: (visibleEnd - visibleStart) * scale,
    }];
  });
}

export class FguiRuntime {
  private registry: PackageRegistry | null = null;
  private game: Phaser.Game | null = null;
  private scene: Phaser.Scene | null = null;
  private ready: Promise<Phaser.Scene> | null = null;
  private root: FguiNode | null = null;
  private nodes = new Map<string, FguiNode>();
  private readonly windowViews = new Map<string, { root: FguiNode; nodes: Map<string, FguiNode> }>();
  private readonly windowLayers = new Map<string, number>();
  private readonly annotations = new WeakMap<FguiNode, Phaser.GameObjects.Text>();
  private readonly componentIds = new Map<number, { view: string; node: FguiNode }>();
  private readonly transitions = new Map<FguiNode, Map<string, FguiTransitionPlayback<FguiNode>>>();
  private readonly damageNumbers = new Map<string, FguiNode[]>();
  private readonly presses = new Map<number, PointerPress>();
  private readonly transitionBeganAt = new WeakMap<FguiTransitionPlayback<FguiNode>, number>();
  private readonly atlasLoads = new Map<string, Promise<void>>();
  private readonly loadedCharacters = new Set<string>();
  private activeView = '';
  private disposed = false;
  private nextCanvasSlice = 0;
  private paused = false;
  private transitionTimeScale = 1;
  private sceneTransitionTime: number | undefined;
  private ignoreSceneDelta = false;
  private readonly resetSceneDelta = () => { this.ignoreSceneDelta = true; };

  constructor(
    private readonly parent: HTMLElement,
    private readonly onAction: (action: FguiAction) => void,
    private readonly transparent = false,
    private readonly atlasProgress?: (fraction: number) => void,
    private readonly lazyAssets = false,
  ) {}

  get views(): ReadonlyMap<string, { root: FguiNode }> {
    return this.windowViews;
  }

  get renderFps(): number { return this.game?.loop.actualFps ?? 0; }

  get topWindow(): string | undefined {
    let top: string | undefined;
    let highest = Number.NEGATIVE_INFINITY;
    for (const [key, view] of this.windowViews) {
      const depth = view.root.container.depth;
      if (depth >= highest) {
        highest = depth;
        top = key;
      }
    }
    return top;
  }

  setWindowLayer(window: string, depth: number): void {
    this.windowLayers.set(window, depth);
    this.windowViews.get(window)?.root.container.setDepth(depth);
  }

  setAnnotation(node: FguiNode, value: string, centerX: number, top: number, fontSize: number): void {
    let label = this.annotations.get(node);
    if (!label) {
      label = this.scene!.add.text(centerX, top, value, {
        fontFamily: 'SourceHanSans, Microsoft YaHei, sans-serif',
        fontSize: `${fontSize}px`, align: 'center', lineSpacing: 4,
        color: '#fff1cf', stroke: '#211811', strokeThickness: 4,
      }).setOrigin(0.5, 0);
      node.container.add(label);
      this.annotations.set(node, label);
    } else if (label.text !== value) label.setText(value);
  }

  async show(packageName: string, componentName: string): Promise<FguiNode> {
    await this.prepare();
    return this.mount('preview', this.registry!.component(componentName, packageName), packageName);
  }

  async showTree(window: string, tree: UiTreeNode): Promise<FguiNode> {
    await this.prepare();
    const packageName = this.registry!.packageById(tree.packageId).package.name;
    const source = toFguiChild(tree);
    if (this.lazyAssets) await this.loadDependencies(this.registry!.dependencies(source, packageName), this.atlasProgress);
    if (this.disposed) throw new Error('FGUI 已关闭');
    return this.mount(window, source, packageName);
  }

  async prepareWindows(windows: ReadonlyArray<readonly [packageName: string, componentName: string]>): Promise<void> {
    await this.prepare();
    const atlases = new Set<string>();
    let text = '';
    for (const [packageName, componentName] of windows) {
      const registry = this.registry!;
      const group = registry.dependencies(registry.component(componentName, packageName), packageName);
      for (const atlas of group.atlases) atlases.add(atlas);
      text += group.text;
    }
    await this.loadDependencies({ atlases, text });
  }

  prepareOps(ops: readonly UiOp[]): Promise<void> | undefined {
    if (!this.lazyAssets) return;
    const registry = this.registry!;
    const atlases = new Set<string>();
    let text = '';
    for (const op of ops) {
      if (op.op === 'set' && op.key === 'text') text += String(op.value);
      else if (op.op === 'set' && op.key === 'url' && op.value) {
        const { item } = registry.itemByUrl(String(op.value));
        if (item.sprite) atlases.add(item.sprite.atlasFile);
      } else if (op.op === 'child-add' || op.op === 'list-add' || op.op === 'list-items') {
        for (const item of op.op === 'list-items' ? op.items : [op.item]) {
          const group = registry.dependencies(toFguiChild(item), registry.packageById(item.packageId).package.name);
          for (const atlas of group.atlases) atlases.add(atlas);
          text += group.text;
        }
      }
    }
    return this.loadDependencies({ atlases, text });
  }

  private loadDependencies({ atlases, text }: FguiDependencies,
    progress?: (fraction: number) => void): Promise<void> | undefined {
    const tasks: Promise<void>[] = [];
    for (const file of atlases) {
      if (this.scene!.textures.exists(`fgui:${file}`)) continue;
      let load = this.atlasLoads.get(file);
      if (!load) {
        const image = new Image();
        image.src = this.registry!.atlasUrl(file);
        load = image.decode().then(() => {
          if (!this.disposed) this.scene!.textures.addImage(`fgui:${file}`, image);
        }).catch((error: unknown) => {
          throw new Error(`FGUI 图集加载失败：${file}`, { cause: error });
        }).finally(() => this.atlasLoads.delete(file));
        this.atlasLoads.set(file, load);
      }
      tasks.push(load);
    }
    const characters = [...new Set(text)].filter(char => !this.loadedCharacters.has(char));
    if (characters.length) {
      tasks.push(document.fonts.load('16px SourceHanSans', characters.join('')).then(() => {
        for (const char of characters) this.loadedCharacters.add(char);
      }));
    }
    if (!tasks.length) return;
    let loaded = 0;
    const pending = progress ? tasks.map(task => task.then(() => progress(++loaded / tasks.length))) : tasks;
    return Promise.all(pending).then(() => undefined);
  }

  private async prepare(): Promise<void> {
    if (this.disposed) throw new Error('FGUI 已关闭');
    this.registry ??= await PackageRegistry.load();
    await document.fonts.ready;
    if (this.disposed) throw new Error('FGUI 已关闭');
    await this.ensureGame();
    if (this.disposed) throw new Error('FGUI 已关闭');
  }

  private mount(view: string, source: FguiChild, packageName: string): FguiNode {
    this.releaseView(view);
    this.activeView = view;
    this.nodes = new Map<string, FguiNode>();
    this.root = this.instantiate(source, packageName, '');
    this.root.container.setDepth(this.windowLayers.get(view) ?? 0);
    this.windowViews.set(view, { root: this.root, nodes: this.nodes });
    this.scene!.add.existing(this.root.container);
    return this.root;
  }

  private releaseView(view: string): void {
    const current = this.windowViews.get(view);
    if (!current) return;
    this.unregister(current.root, current.nodes);
    current.root.container.destroy(true);
    this.windowViews.delete(view);
    if (view === 'MiniGameBattleUIWindow') {
      for (const pool of this.damageNumbers.values()) for (const node of pool) node.container.destroy(true);
      this.damageNumbers.clear();
    }
  }

  private unregister(node: FguiNode, nodes = this.nodes): void {
    for (const child of node.children.values()) this.unregister(child, nodes);
    for (const item of node.list?.items ?? []) this.unregister(item, nodes);
    for (const playback of this.transitions.get(node)?.values() ?? []) playback.stop();
    this.transitions.delete(node);
    const clip = node.list?.clip;
    if (clip && 'mask' in clip) {
      clip.mask.geometryMask.destroy();
      node.list!.container.clearMask();
      clip.mask.destroy();
    }
    nodes.delete(node.path);
    if (typeof node.source.id === 'number') this.componentIds.delete(node.source.id);
  }

  close(window: string): void {
    this.releaseView(window);
    this.activeView = this.topWindow ?? '';
    const last = this.windowViews.get(this.activeView);
    this.root = last?.root ?? null;
    this.nodes = last?.nodes ?? new Map<string, FguiNode>();
  }

  componentPath(id: number): string {
    const record = this.componentIds.get(id);
    if (!record) throw new Error(`未知原窗口组件 ID：${id}`);
    const view = this.windowViews.get(record.view);
    if (!view) throw new Error(`组件所属窗口已关闭：${record.view}`);
    this.root = view.root;
    this.nodes = view.nodes;
    this.activeView = record.view;
    return record.node.path;
  }

  addChild(parentId: number, item: UiTreeNode): FguiNode {
    const parent = this.find(this.componentPath(parentId));
    const pkg = this.registry!.packageById(item.packageId);
    const name = parent.children.has(item.name) ? `${item.name}:${item.id}` : item.name;
    const source = toFguiChild(item);
    const path = this.childPath(parent, name);
    const reused = this.activeView === 'MiniGameBattleUIWindow' && DAMAGE_NUMBERS.has(item.name)
      ? this.damageNumbers.get(`${item.packageId}:${item.componentId}`)?.pop() : undefined;
    const node = reused ?? this.instantiate(source, pkg.package.name, path, parent);
    if (reused) this.rebindDamageNumber(reused, source, path, parent);
    parent.children.set(name, node);
    parent.container.add(node.container);
    this.updateGears(node);
    return node;
  }

  removeChild(id: number): void {
    const node = this.find(this.componentPath(id));
    const parent = node.parent;
    if (!parent) throw new Error(`FGUI 根窗口需要通过 close 关闭：${id}`);
    for (const [key, child] of parent.children) {
      if (child === node) parent.children.delete(key);
    }
    this.unregister(node);
    if (this.activeView === 'MiniGameBattleUIWindow' && DAMAGE_NUMBERS.has(node.source.name)) {
      const key = `${node.source.packageId}:${node.source.src}`;
      const pool = this.damageNumbers.get(key) ?? [];
      if (pool.length < DAMAGE_NUMBER_POOL_LIMIT) {
        parent.container.remove(node.container);
        node.container.removeFromDisplayList();
        node.container.setVisible(false);
        node.parent = undefined;
        pool.push(node);
        this.damageNumbers.set(key, pool);
        return;
      }
    }
    node.container.destroy(true);
  }

  private rebindDamageNumber(node: FguiNode, source: FguiChild, path: string, parent: FguiNode): void {
    // These three authored popup types have fixed component trees and no input handlers.
    // The Worker still issues fresh IDs and owns transitions for each hit.
    node.parent = parent;
    node.path = path;
    node.source = source;
    node.explicitVisible = source.visible ?? true;
    this.nodes.set(path, node);
    if (typeof source.id === 'number') this.componentIds.set(source.id, { view: this.activeView, node });
    node.container.setAlpha(source.alpha ?? 1).setAngle(source.rotation ?? 0)
      .setScale(...(source.scale ?? [1, 1])).setVisible(node.explicitVisible);
    this.positionNode(node, source.x ?? 0, source.y ?? 0);
    node.bitmapText?.draw(source.text ?? '');
    for (const child of source.children ?? []) {
      this.rebindDamageNumber(node.children.get(child.name)!, child, this.childPath(node, child.name), node);
    }
  }

  private childPath(parent: FguiNode, name: string): string {
    return parent.path ? `${parent.path}/${name}` : name;
  }

  playTransition(id: number, name: string, callbacks: FguiTransitionCallbacks = {}): void {
    const node = this.find(this.componentPath(id));
    const names = this.transitions.get(node) ?? new Map<string, FguiTransitionPlayback<FguiNode>>();
    names.get(name)?.stop();
    this.transitions.set(node, names);
    const playback = new FguiTransitionPlayback(node, this.transitionDefinition(node, name), {
      child: (owner, track) => track.targetName ? owner.children.get(track.targetName) : undefined,
      definition: (owner, transition) => this.transitionDefinition(owner, transition),
      position: (owner) => [owner.x, owner.y],
      apply: (owner, target, type, value, base) => this.applyTransition(owner, target, type, value, base),
      tween: (owner, target, track, base) => this.transitionTween(owner, target, track, base),
    }, callbacks);
    names.set(name, playback);
    this.transitionBeganAt.set(playback, performance.now());
    if (!this.paused && !document.hidden && playback.advance(0)) this.removePlayback(node, name, playback);
  }

  stopTransition(id: number, name: string): void {
    const node = this.find(this.componentPath(id));
    const playback = this.transitions.get(node)?.get(name);
    if (!playback) return;
    playback.stop();
    this.removePlayback(node, name, playback);
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    this.resetSceneDelta();
  }

  setTransitionTimeScale(scale: number): void {
    if (!Number.isFinite(scale) || scale < 0) throw new Error(`FGUI 转场时间倍率无效：${scale}`);
    this.transitionTimeScale = scale;
  }

  private removePlayback(node: FguiNode, name: string, playback: FguiTransitionPlayback<FguiNode>): void {
    const names = this.transitions.get(node);
    if (names?.get(name) !== playback) return;
    names.delete(name);
    if (!names.size) this.transitions.delete(node);
  }

  private stepTransitions(): void {
    const now = performance.now();
    const previous = this.sceneTransitionTime;
    this.sceneTransitionTime = now;
    if (this.ignoreSceneDelta || previous === undefined) {
      this.ignoreSceneDelta = false;
      return;
    }
    this.updateTransitions(now - previous, now);
  }

  private updateTransitions(delta: number, frameEnd?: number): void {
    if (this.paused || document.hidden) return;
    const current = [...this.transitions].map(([owner, names]) => [owner, [...names]] as const);
    for (const [owner, names] of current) {
      for (const [name, playback] of names) {
        if (this.transitions.get(owner)?.get(name) !== playback) continue;
        // A worker can start a transition between renders during an expensive frame.
        const maxDelta = frameEnd === undefined ? delta : frameEnd - this.transitionBeganAt.get(playback)!;
        const seconds = Math.max(0, Math.min(delta, maxDelta)) / 1000;
        if (playback.advance(seconds * (playback.scaled ? this.transitionTimeScale : 1))) this.removePlayback(owner, name, playback);
      }
    }
  }

  private transitionDefinition(node: FguiNode, name: string) {
    const transition = node.definition?.transitions?.find((candidate) => candidate.name === name);
    if (!transition) throw new Error(`FGUI 转场不存在：${node.path || node.source.name}/${name}`);
    return transition;
  }

  private transitionTween(
    owner: FguiNode, target: FguiNode, track: FguiTransitionTrack, base: readonly [number, number],
  ): (progress: number) => void {
    const tween = track.tween!;
    const relative = owner === target ? base : [0, 0] as const;
    const { startValue, endValue, easeType } = tween;
    const initial = track.type === 'XY' ? [target.x - relative[0], target.y - relative[1]] : [target.width, target.height];
    const start = this.transitionNumbers(owner, track.type, startValue, initial, target === owner);
    const end = this.transitionNumbers(owner, track.type, endValue, start, target === owner);
    const name = easeType.replace(/(InOut|In|Out)$/, '.ease$1');
    const ease = Phaser.Tweens.Builders.GetEaseFunction(name) as (progress: number) => number;
    return (progress) => {
      const fraction = ease(progress);
      this.applyTransition(owner, target, track.type, {
        f1: start[0] + (end[0] - start[0]) * fraction,
        f2: start[1] + (end[1] - start[1]) * fraction,
      }, base);
    };
  }

  private transitionNumbers(
    owner: FguiNode, type: string, value: FguiTransitionValue, missing: readonly number[], self: boolean,
  ): [number, number] {
    const positional = type === 'XY' && value.percent && !self;
    return [
      value.f1 === undefined || value.b1 === false ? missing[0]! : value.f1 * (positional ? owner.width : 1),
      value.f2 === undefined || value.b2 === false ? missing[1]! : value.f2 * (positional ? owner.height : 1),
    ];
  }

  private applyTransition(
    owner: FguiNode, target: FguiNode, type: string, value: FguiTransitionValue, base: readonly [number, number],
  ): void {
    if (!target.container.scene) return;
    if (type === 'XY') {
      const relative = owner === target ? base : [0, 0] as const;
      const [x, y] = this.transitionNumbers(owner, type, value, [target.x - relative[0], target.y - relative[1]], owner === target);
      this.positionNode(target, x + relative[0], y + relative[1]);
    } else if (type === 'Size') {
      const [width, height] = this.transitionNumbers(owner, type, value, [target.width, target.height], owner === target);
      this.sizeNode(target, width, height);
    } else if (type === 'Alpha') {
      target.container.setAlpha(value.f1!);
    } else if (type === 'Scale') {
      target.container.setScale(value.f1!, value.f2!);
      this.positionNode(target, target.x, target.y);
    } else if (type === 'Rotation') {
      target.container.setAngle(value.f1!);
      this.positionNode(target, target.x, target.y);
    } else if (type === 'Visible') {
      target.explicitVisible = value.visible === true;
      this.updateGears(target);
    } else {
      throw new Error(`未支持的 FGUI 转场属性：${type}`);
    }
  }

  private async ensureGame(): Promise<void> {
    if (this.ready) {
      await this.ready;
      return;
    }
    let resolve!: (scene: Phaser.Scene) => void;
    let reject!: (error: Error) => void;
    this.ready = new Promise<Phaser.Scene>((done, fail) => { resolve = done; reject = fail; });
    this.parent.replaceChildren();
    const registry = this.registry!;
    const runtime = this;
    class ViewScene extends Phaser.Scene {
      private readonly failures: string[] = [];

      preload(): void {
        if (runtime.lazyAssets) return;
        if (runtime.atlasProgress) this.load.on('progress', runtime.atlasProgress);
        for (const atlas of registry.atlasEntries()) this.load.image(atlas.key, atlas.url);
        this.load.on('loaderror', (file: Phaser.Loader.File) => this.failures.push(file.key));
      }

      create(): void {
        if (this.failures.length) {
          reject(new Error(`FGUI 图集加载失败：${this.failures.join(', ')}`));
          return;
        }
        runtime.scene = this;
        this.input.on(Phaser.Input.Events.POINTER_MOVE, (pointer: Phaser.Input.Pointer) => runtime.movePress(pointer));
        for (const event of [Phaser.Input.Events.POINTER_UP, Phaser.Input.Events.POINTER_UP_OUTSIDE]) {
          this.input.on(event, (pointer: Phaser.Input.Pointer) => runtime.presses.delete(pointer.id));
        }
        resolve(this);
      }

      override update(): void {
        runtime.stepTransitions();
      }
    }
    this.game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: this.parent,
      width: 1334,
      height: 750,
      backgroundColor: '#000000',
      transparent: this.transparent,
      scene: ViewScene,
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      render: { pixelArt: true, antialias: false },
      audio: { noAudio: true },
      callbacks: { postBoot: installPhaserViewport },
      banner: false,
    });
    document.addEventListener('visibilitychange', this.resetSceneDelta);
    await this.ready;
  }

  private instantiate(source: FguiChild, packageName: string, path: string, parent?: FguiNode): FguiNode {
    const registry = this.registry!;
    const pkg = source.packageId ? registry.packageById(source.packageId) : registry.package(packageName);
    const linked = source.src ? pkg.components[source.src] : undefined;
    const definition = source.children ? { ...linked, ...source } as FguiComponent : linked;
    const width = source.width ?? linked?.width ?? (source.src ? pkg.items[source.src]?.width : 0) ?? 0;
    const height = source.height ?? linked?.height ?? (source.src ? pkg.items[source.src]?.height : 0) ?? 0;
    const container = this.scene!.add.container(0, 0).setSize(width, height);
    const node: FguiNode = {
      path,
      source,
      definition,
      parent,
      container,
      x: source.x ?? 0,
      y: source.y ?? 0,
      width,
      height,
      children: new Map(),
      controllers: new Map(),
      explicitVisible: source.visible ?? true,
    };
    this.nodes.set(path, node);
    if (typeof source.id === 'number') this.componentIds.set(source.id, { view: this.activeView, node });
    container.setAlpha(source.alpha ?? 1);
    container.setAngle(source.rotation ?? 0);
    container.setScale(...(source.scale ?? [1, 1]));
    this.positionNode(node, node.x, node.y);
    container.setVisible(node.explicitVisible);
    const type = source.objectType ?? definition?.objectType;
    if (type === 'Image') node.content = this.createImage(source, pkg, width, height);
    else if (type === 'RichText' || type === 'TextField' || type === 'Text') {
      if (source.textFormat?.font.startsWith('ui://')) this.createBitmapText(node);
      else {
        const text = this.createText(source, width, height);
        node.content = text;
        if (source.ubbEnabled && source.text?.includes('[')) this.updateText(node, text, source.text);
      }
    }
    else if (type === 'Graph') node.content = this.createGraph(source, width, height);
    else if (type === 'Loader') this.setLoaderUrl(node, source.url ?? null);
    else if (type === 'List') this.createList(node);
    if (node.content) container.add(node.content);
    for (const [index, child] of (definition?.children ?? []).entries()) {
      const name = child.name && !node.children.has(child.name) ? child.name : String(index);
      const childNode = this.instantiate(child, pkg.package.name, this.childPath(node, name), node);
      container.add(childNode.container);
      node.children.set(name, childNode);
    }
    if ((source.clickHandlerCount ?? (type === 'Button' ? 1 : 0)) > 0) {
      this.makeClickable(node);
      this.updateInput(node);
    }
    for (const controller of definition?.controllers ?? []) node.controllers.set(controller.name, controller.selected ?? 0);
    this.configureClip(node);
    this.updateGears(node);
    return node;
  }

  private imageFrame(sprite: FguiSprite, itemId: string): Phaser.Textures.Frame {
    const textures = this.scene!.textures;
    const atlas = textures.get(`fgui:${sprite.atlasFile}`);
    const [originalWidth, originalHeight] = sprite.originalSize;
    const [offsetX, offsetY] = sprite.offset ?? [0, 0];

    if (sprite.rotated) {
      const key = `fgui:upright:${sprite.atlasFile}:${itemId}`;
      if (textures.exists(key)) return textures.getFrame(key);
      const canvas = document.createElement('canvas');
      canvas.width = originalWidth;
      canvas.height = originalHeight;
      const atlasImage = atlas.getSourceImage();
      if (!(atlasImage instanceof HTMLImageElement)) throw new Error(`图集不是已加载的图片：${sprite.atlasFile}`);
      const context = canvas.getContext('2d');
      if (!context) throw new Error(`无法创建图集裁切画布：${itemId}`);
      // FGUI stores these slices counterclockwise. Restore source pixels and trim padding
      // before Phaser applies layout, sizing, or the nine-slice grid.
      context.translate(offsetX + sprite.height, offsetY);
      context.rotate(Math.PI / 2);
      context.drawImage(atlasImage, sprite.x, sprite.y, sprite.width, sprite.height,
        0, 0, sprite.width, sprite.height);
      const texture = textures.addCanvas(key, canvas);
      if (!texture) throw new Error(`无法创建直立图集帧：${itemId}`);
      return texture.get();
    }

    if (atlas.has(itemId)) return atlas.get(itemId);
    const frame = atlas.add(itemId, 0, sprite.x, sprite.y, sprite.width, sprite.height);
    if (!frame) throw new Error(`无法创建图集帧：${itemId}`);
    return frame.setTrim(originalWidth, originalHeight, offsetX, offsetY, sprite.width, sprite.height);
  }

  private createCanvasNineSlice(
    frame: Phaser.Textures.Frame,
    width: number,
    height: number,
    left: number,
    right: number,
    top: number,
    bottom: number,
  ): Phaser.GameObjects.Image {
    const source = frame.source.image;
    if (!(source instanceof HTMLImageElement || source instanceof HTMLCanvasElement)) {
      throw new Error(`九宫格纹理没有可绘制图像：${frame.name}`);
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(width));
    canvas.height = Math.max(1, Math.ceil(height));
    const context = canvas.getContext('2d');
    if (!context) throw new Error(`无法创建九宫格画布：${frame.name}`);
    context.scale(canvas.width / (width || 1), canvas.height / (height || 1));
    context.imageSmoothingEnabled = !frame.source.scaleMode;
    const columns = nineSliceAxis(frame.realWidth, left, right, frame.x, frame.width, width);
    const rows = nineSliceAxis(frame.realHeight, top, bottom, frame.y, frame.height, height);
    for (const row of rows) {
      for (const column of columns) {
        context.drawImage(source,
          frame.cutX + column.sourceStart, frame.cutY + row.sourceStart, column.sourceSize, row.sourceSize,
          column.targetStart, row.targetStart, column.targetSize, row.targetSize);
      }
    }

    const textures = this.scene!.textures;
    const key = `fgui:nine-slice:${this.nextCanvasSlice++}`;
    const texture = textures.create(key, canvas);
    if (!texture) throw new Error(`无法创建九宫格纹理：${frame.name}`);
    texture.add('__BASE', 0, 0, 0, canvas.width, canvas.height);
    const image = this.scene!.add.image(0, 0, key).setDisplaySize(width, height).setOrigin(0, 0);
    // Canvas paints the original grid once at layout time. Only live objects own these textures.
    image.once(Phaser.GameObjects.Events.DESTROY, () => textures.remove(key));
    return image;
  }

  private createImage(source: FguiChild, pkg: FguiPackage, width: number, height: number) {
    if (!source.src) throw new Error(`图片缺少资源：${source.name}`);
    const item = pkg.items[source.src];
    if (!item?.sprite) throw new Error(`图片资源不存在：${pkg.package.name}/${source.src}`);
    const frame = this.imageFrame(item.sprite, item.id);
    if (item.scale9Grid) {
      const [left = 0, top = 0, centerWidth = 0, centerHeight = 0] = item.scale9Grid;
      const right = frame.realWidth - left - centerWidth;
      const bottom = frame.realHeight - top - centerHeight;
      const sliceHeight = top || bottom ? height : frame.realHeight;
      // Phaser only provides a WebGL renderer for NineSlice.
      if (this.scene!.sys.renderer.type === Phaser.CANVAS || width < left + right || sliceHeight < top + bottom) {
        return this.createCanvasNineSlice(frame, width, sliceHeight, left, right, top, bottom);
      }
      return this.scene!.add.nineslice(0, 0, frame.texture.key, frame.name, width, height, left, right, top, bottom).setOrigin(0, 0);
    }
    if (item.scaleByTile) {
      return this.scene!.add.tileSprite(0, 0, width, height, frame.texture.key, frame.name).setOrigin(0, 0);
    }
    return this.scene!.add.image(0, 0, frame.texture.key, frame.name).setDisplaySize(width, height).setOrigin(0, 0);
  }

  private createText(source: FguiChild, width: number, height: number): Phaser.GameObjects.Text {
    const format = source.textFormat;
    if (!format) throw new Error(`文本缺少原始样式：${source.name}`);
    if (format.font !== 'SOURCEHANSANSSC-NORMAL-2') throw new Error(`原字体尚未准备：${format.font}`);
    const autoHeight = source.autoSize === 'Height';
    const text = this.scene!.add.text(0, 0, source.text ?? '', {
      fontFamily: 'SourceHanSans, Microsoft YaHei, sans-serif',
      fontSize: `${format.fontSize}px`,
      color: format.color,
      fontStyle: format.bold ? 'bold' : 'normal',
      align: format.align.toLowerCase(),
      lineSpacing: format.lineSpacing,
      stroke: format.outlineColor ?? '#00000000',
      strokeThickness: format.outline ?? 0,
      ...(autoHeight ? {
        padding: { x: 2, y: 2 },
        wordWrap: source.singleLine ? {} : { width: Math.max(1, width - 4), callback: wrapFguiText },
      } : {}),
    });
    text.setOrigin(0, 0);
    if (source.autoSize !== 'Both' && source.autoSize !== true) {
      text.setFixedSize(width, autoHeight ? 0 : height);
      if (!autoHeight && !source.singleLine) text.setWordWrapWidth(width);
    }
    return text;
  }

  private createBitmapText(node: FguiNode): void {
    const format = node.source.textFormat!;
    const { pkg, item } = this.registry!.itemByUrl(format.font);
    const font = item.bitmapFont;
    if (!font) throw new Error(`原位图字体尚未准备：${format.font}`);
    const container = this.scene!.add.container(0, 0);
    node.content = container;
    let current: string | undefined;
    node.bitmapText = { draw: (value) => {
      if (value === current) return;
      current = value;
      this.drawBitmapText(node, container, pkg, font, value);
    } };
    node.bitmapText.draw(node.source.text ?? '');
  }

  private drawBitmapText(
    node: FguiNode, container: Phaser.GameObjects.Container, pkg: FguiPackage, font: FguiBitmapFont, value: string,
  ): void {
    const format = node.source.textFormat!;
    const scale = font.resizable ? format.fontSize / font.size : 1;
    const lineHeight = font.lineHeight * scale;
    const lines = value.split('\n').map((line) => [...line].flatMap((char) => {
      const glyph = font.glyphs[char];
      return glyph ? [glyph] : [];
    }));
    const height = lines.length * lineHeight + (lines.length - 1) * format.lineSpacing;
    const tint = Number.parseInt(format.color.slice(1, 7), 16);
    let top = format.verticalAlign === 'Middle' ? (node.height - height) / 2
      : format.verticalAlign === 'Bottom' ? node.height - height - 2 : 2;
    let index = 0;
    for (const line of lines) {
      const width = line.reduce((total, glyph) => total + glyph.advance * scale, 0) + Math.max(0, line.length - 1) * format.letterSpacing;
      let left = format.align === 'Center' ? (node.width - width) / 2 : format.align === 'Right' ? node.width - width - 2 : 2;
      for (const glyph of line) {
        const image = pkg.items[glyph.image]!;
        const width = image.width * scale, height = image.height * scale;
        const previous = container.list[index];
        let sprite;
        if (previous instanceof Phaser.GameObjects.Image && image.sprite && !image.scale9Grid && !image.scaleByTile) {
          const frame = this.imageFrame(image.sprite, image.id);
          sprite = previous.setTexture(frame.texture.key, frame.name).setDisplaySize(width, height);
        } else {
          if (previous) container.remove(previous, true);
          sprite = this.createImage({ ...node.source, src: glyph.image }, pkg, width, height);
          container.addAt(sprite, index);
        }
        sprite.setVisible(true);
        sprite.setPosition(left + glyph.x * scale, top + glyph.y * scale);
        if (font.tintable) sprite.setTint(tint);
        index++;
        left += glyph.advance * scale + format.letterSpacing;
      }
      top += lineHeight + format.lineSpacing;
    }
    for (; index < container.list.length; index++) {
      const glyph = container.list[index] as Phaser.GameObjects.Image;
      glyph.setVisible(false);
    }
  }

  private createGraph(source: FguiChild, width: number, height: number): Phaser.GameObjects.Rectangle {
    if (source.graphType !== 'Rect') throw new Error(`未支持的 FGUI 图形：${source.graphType}`);
    const color = source.fillColor ?? '#00000000';
    const rgb = Number.parseInt(color.slice(1, 7), 16);
    const alpha = Number.parseInt(color.slice(7, 9), 16) / 255;
    const rectangle = this.scene!.add.rectangle(0, 0, width, height, rgb, alpha).setOrigin(0, 0);
    if ((source.lineSize ?? 0) > 0) rectangle.setStrokeStyle(source.lineSize, Number.parseInt((source.lineColor ?? '#000000ff').slice(1, 7), 16));
    return rectangle;
  }

  private configureClip(node: FguiNode): void {
    const name = node.definition?.maskName;
    if (!name || node.definition?.reversedMask) return;
    const mask = node.children.get(name);
    if (mask?.source.graphType !== 'Rect') return;
    const siblings = [...node.children.values()].filter((child) => child !== mask);
    if (!siblings.length || siblings.some((child) => child.source.objectType !== 'Loader' && !(child.content instanceof Phaser.GameObjects.Image))) return;
    // An image-only component can apply its FairyGUI rectangle mask as a native texture crop.
    // This also works with the Canvas renderer and keeps the animated graph out of the display.
    node.clip = mask;
    mask.maskOnly = true;
    this.refreshClip(node);
  }

  private refreshClip(node: FguiNode): void {
    const mask = node.clip;
    if (!mask) return;
    for (const sibling of node.children.values()) {
      const image = sibling.content;
      if (sibling === mask || !(image instanceof Phaser.GameObjects.Image)) continue;
      const x = sibling.container.x + image.x * sibling.container.scaleX;
      const y = sibling.container.y + image.y * sibling.container.scaleY;
      const scaleX = sibling.container.scaleX * image.scaleX;
      const scaleY = sibling.container.scaleY * image.scaleY;
      const left = Math.max(0, (mask.container.x - x) / scaleX);
      const top = Math.max(0, (mask.container.y - y) / scaleY);
      const right = Math.min(image.width, (mask.container.x + mask.width * mask.container.scaleX - x) / scaleX);
      const bottom = Math.min(image.height, (mask.container.y + mask.height * mask.container.scaleY - y) / scaleY);
      image.setVisible(right > left && bottom > top);
      if (image.visible) image.setCrop(left, top, right - left, bottom - top);
    }
  }

  private createList(node: FguiNode): void {
    const container = this.scene!.add.container(0, 0);
    node.list = { container, items: [], scrollX: 0, scrollY: 0 };
    const clipped = node.source.overflow === 'Hidden' || node.source.overflow === 'Scroll';
    if (clipped && this.scene!.sys.renderer.type === Phaser.WEBGL) {
      // A fixed-size Phaser filter framebuffer clips at the viewport before it composites the
      // scrolling content. Its origin stays fixed while the inner container moves.
      const viewport = this.scene!.add.container(0, 0).setSize(node.width, node.height).enableFilters();
      viewport.filtersForceComposite = true;
      viewport.focusFiltersOverride(0, 0, node.width, node.height);
      viewport.add(container);
      node.container.add(viewport);
      node.list.clip = { viewport };
    } else {
      node.container.add(container);
      if (clipped) {
        const graphics = this.scene!.make.graphics({ x: 0, y: 0 }, false);
        const mask = new Phaser.Display.Masks.GeometryMask(this.scene!, graphics);
        node.list.clip = { mask };
        container.setMask(mask);
        this.updateListMask(node);
      }
    }
    if (node.source.overflow !== 'Scroll') return;
    node.acceptsWheel = true;
    this.enableInput(node);
  }

  private updateListMask(node: FguiNode): void {
    const clip = node.list?.clip;
    if (!clip) return;
    if ('viewport' in clip) {
      if (clip.viewport.width !== node.width || clip.viewport.height !== node.height) {
        clip.viewport.setSize(node.width, node.height).focusFiltersOverride(0, 0, node.width, node.height);
      }
      return;
    }
    const point = node.container.getWorldTransformMatrix().transformPoint(0, 0);
    clip.mask.geometryMask.clear().fillRect(point.x, point.y, node.width, node.height);
  }

  private scrollList(node: FguiNode, dx: number, dy: number): void {
    const list = node.list;
    if (!list) return;
    const layout = layoutList(node.source, list.items);
    this.positionList(node, layout, list.scrollX + dx, list.scrollY + dy);
  }

  private positionList(node: FguiNode, layout: ReturnType<typeof layoutList>, x: number, y: number): void {
    const list = node.list!;
    list.scrollX = Math.min(0, Math.max(x, Math.min(0, node.width - layout.contentWidth)));
    list.scrollY = Math.min(0, Math.max(y, Math.min(0, node.height - layout.contentHeight)));
    list.container.setPosition(list.scrollX, list.scrollY);
  }

  private makeClickable(node: FguiNode): void {
    if (node.hasAction) return;
    node.hasAction = true;
    this.enableInput(node);
    if (node.container.input) node.container.input.cursor = 'pointer';
  }

  private enableInput(node: FguiNode): void {
    if (node.container.input) return;
    // Phaser normalizes hit coordinates to the Container's computed center. FGUI lays out children
    // from the top-left, so subtract Phaser's display origin before testing the component bounds.
    node.container.setInteractive({}, (_area: unknown, x: number, y: number) => {
      const localX = x - node.container.displayOriginX;
      const localY = y - node.container.displayOriginY;
      return this.containsPoint(node, localX, localY) && this.canInteract(node) &&
        this.insideListClips(node, localX, localY) && this.insideStageSign(node, localX, localY);
    });
    node.container.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.primaryDown) this.beginPress(node, pointer);
    });
    node.container.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      const press = this.presses.get(pointer.id);
      if (!press || press.dragged || pointer.wasCanceled || !this.canInteract(node)) return;
      const target = this.clickTarget(node);
      if (!target || target !== press.action) return;
      const action: FguiAction = { path: target.path, sourceId: String(target.source.id), objectType: target.source.objectType };
      if (typeof target.source.id === 'number') action.componentId = target.source.id;
      this.onAction(action);
    });
    node.container.on('wheel', (_: unknown, dx: number, dy: number) => {
      if (!this.canInteract(node)) return;
      for (let target: FguiNode | undefined = node; target; target = target.parent) {
        if (!target.acceptsWheel) continue;
        if (target.source.scroll?.scrollType === 'Horizontal') this.scrollList(target, -(dx + dy), 0);
        else this.scrollList(target, 0, -dy);
        break;
      }
    });
  }

  private clickTarget(node: FguiNode): FguiNode | undefined {
    for (let target: FguiNode | undefined = node; target; target = target.parent) {
      if (target.hasAction && target.source.clickHandlerCount !== 0) return target;
    }
  }

  private beginPress(node: FguiNode, pointer: Phaser.Input.Pointer): void {
    const action = this.clickTarget(node);
    let scroll: ScrollPress | undefined;
    for (let target: FguiNode | undefined = node; target; target = target.parent) {
      const list = target.list;
      if (!list || !target.acceptsWheel || ((target.source.scroll?.flags ?? 0) & 32)) continue;
      const layout = layoutList(target.source, list.items);
      const horizontal = target.source.scroll?.scrollType === 'Horizontal';
      if (horizontal ? layout.contentWidth <= target.width : layout.contentHeight <= target.height) continue;
      const origin = target.container.getWorldTransformMatrix().applyInverse(pointer.x, pointer.y);
      scroll = { node: target, originX: origin.x, originY: origin.y, scrollX: list.scrollX, scrollY: list.scrollY, horizontal };
      break;
    }
    this.presses.set(pointer.id, { action, scroll, dragged: false });
  }

  private movePress(pointer: Phaser.Input.Pointer): void {
    const press = this.presses.get(pointer.id);
    const scroll = press?.scroll;
    if (!press || !scroll || !pointer.primaryDown || !this.canInteract(scroll.node)) return;
    const point = scroll.node.container.getWorldTransformMatrix().applyInverse(pointer.x, pointer.y);
    const dx = scroll.horizontal ? point.x - scroll.originX : 0;
    const dy = scroll.horizontal ? 0 : point.y - scroll.originY;
    if (!press.dragged && Math.abs(dx || dy) < (pointer.wasTouch ? 20 : 8)) return;
    press.dragged = true;
    this.positionList(scroll.node, layoutList(scroll.node.source, scroll.node.list!.items), scroll.scrollX + dx, scroll.scrollY + dy);
  }

  private insideStageSign(node: FguiNode, x: number, y: number): boolean {
    const design = node.source.src && this.registry!.components[node.source.src]?.name;
    if (design !== 'MiniGameChoice_Tips1Btn' && design !== 'MiniGameChoice_Tips2Btn' && design !== 'MiniGameChoice_Tips3Btn') return true;
    const art = design === 'MiniGameChoice_Tips3Btn' ? ['n8'] : ['n3', 'n4'];
    return art.some((name) => {
      const child = node.children.get(name);
      const image = child?.content;
      if (!child?.container.visible || !(image instanceof Phaser.GameObjects.Image)) return false;
      const localX = Math.floor((x - child.x - image.x) / image.scaleX);
      const localY = Math.floor((y - child.y - image.y) / image.scaleY);
      // The source sign silhouettes include a two-pixel vertical line. Require a solid
      // stroke wider than that so the route and its separate endpoint cannot select a stage.
      return [-2, 0, 2].every((offset) =>
        (image.texture.manager.getPixelAlpha(localX + offset, localY, image.texture.key, image.frame.name) ?? 0) >= 128);
    });
  }

  private canInteract(node: FguiNode): boolean {
    // Phaser also listens for touch events on the window, beyond the inert canvas subtree.
    if (this.parent.inert) return false;
    for (let candidate: FguiNode | undefined = node; candidate; candidate = candidate.parent) {
      if (!candidate.container.visible || candidate.container.alpha === 0 || candidate.source.touchable === false) return false;
      if (!candidate.parent) return this.windowViews.get(this.topWindow ?? '')?.root === candidate;
    }
    return false;
  }

  private containsPoint(node: FguiNode, x: number, y: number): boolean {
    return x >= 0 && x < node.width && y >= 0 && y < node.height;
  }

  private insideListClips(node: FguiNode, x: number, y: number): boolean {
    let world: Phaser.Types.Math.Vector2Like | undefined;
    for (let candidate = node.parent; candidate; candidate = candidate.parent) {
      if (!candidate.list?.clip) continue;
      world ??= node.container.getWorldTransformMatrix().transformPoint(x, y);
      const local = candidate.container.getWorldTransformMatrix().applyInverse(world.x, world.y);
      if (!this.containsPoint(candidate, local.x, local.y)) return false;
    }
    return true;
  }

  setClickable(path: string, count: number): void {
    const node = this.find(path);
    node.source.clickHandlerCount = count;
    if (count > 0) this.makeClickable(node);
    this.updateInput(node);
  }

  clickHandlerCount(id: number): number {
    return this.componentIds.get(id)?.node.source.clickHandlerCount ?? 0;
  }

  private updateInput(node: FguiNode): void {
    if (!node.container.input) return;
    if ((node.source.clickHandlerCount === 0 && !node.acceptsWheel) || node.source.touchable === false) node.container.disableInteractive();
    else node.container.setInteractive();
  }

  private updateGears(node: FguiNode): void {
    const visible = (node.source.gears ?? []).every((gear) => {
      const record = gear as { type: string; controllerName: string; pages: string[] };
      if (record.type !== 'Display') return true;
      const controller = node.parent?.definition?.controllers?.find((entry) => entry.name === record.controllerName);
      const page = controller?.pages[node.parent?.controllers.get(record.controllerName) ?? 0];
      return !!page && record.pages.includes(page.id);
    });
    node.container.setVisible(node.explicitVisible && visible && !node.maskOnly);
    for (const child of node.children.values()) this.updateGears(child);
  }

  find(path: string): FguiNode {
    const node = this.nodes.get(path);
    if (!node) throw new Error(`FGUI 组件不存在：${path}`);
    return node;
  }

  setText(path: string, value: string | number): void {
    const target = this.find(path);
    const node = target.content instanceof Phaser.GameObjects.Text || target.bitmapText ? target : this.find(`${path}/WordTxt`);
    if (node.bitmapText) {
      node.bitmapText.draw(String(value));
      return;
    }
    const text = node.content;
    if (!(text instanceof Phaser.GameObjects.Text)) throw new Error(`组件不是文本：${path}`);
    this.updateText(node, text, String(value));
  }

  private updateText(node: FguiNode, text: Phaser.GameObjects.Text, value: string): void {
    if (node.ubbSource === value) return;
    const wasUbb = node.ubbSource !== undefined;
    const ubb = node.source.ubbEnabled ? parseUbbColors(value) : null;
    const displayed = ubb?.text ?? value;
    if (wasUbb && !ubb?.spans.length && text.text === displayed) text.updateText();
    else text.setText(displayed);
    if (ubb) {
      paintUbbColors(text, ubb, node.source.textFormat!.verticalAlign);
      node.ubbSource = value;
    } else {
      delete node.ubbSource;
    }
    if (node.source.autoSize === 'Height') this.sizeNode(node, node.width, text.height);
    if (node.source.autoSize === 'Both' && (node.source.pivotAsAnchor || ubb || wasUbb || node.parent?.definition?.relations?.length)) {
      this.sizeNode(node, text.width, text.height);
    }
  }

  setVisible(path: string, visible: boolean): void {
    const node = this.find(path);
    node.explicitVisible = visible;
    this.updateGears(node);
  }

  setTouchable(path: string, value: boolean): void {
    const node = this.find(path);
    node.source.touchable = value;
    this.updateInput(node);
  }

  setPosition(path: string, x: number, y: number): void {
    this.positionNode(this.find(path), x, y);
  }

  setSize(path: string, width: number, height: number): void {
    this.sizeNode(this.find(path), width, height);
  }

  setRotation(path: string, degrees: number): void {
    const node = this.find(path);
    node.container.setAngle(degrees);
    this.positionNode(node, node.x, node.y);
  }

  setScale(path: string, x: number, y: number): void {
    const node = this.find(path);
    node.container.setScale(x, y);
    this.positionNode(node, node.x, node.y);
  }

  private positionNode(node: FguiNode, x: number, y: number): void {
    node.x = x;
    node.y = y;
    const [px, py] = node.source.pivot ?? [0, 0];
    const pivotX = px * node.width;
    const pivotY = py * node.height;
    const { rotation, scaleX, scaleY } = node.container;
    const scaledX = pivotX * scaleX;
    const scaledY = pivotY * scaleY;
    const anchorShift = node.source.pivotAsAnchor ? 0 : 1;
    node.container.setPosition(
      x + anchorShift * pivotX - (scaledX * Math.cos(rotation) - scaledY * Math.sin(rotation)),
      y + anchorShift * pivotY - (scaledX * Math.sin(rotation) + scaledY * Math.cos(rotation)),
    );
    if (node.parent?.clip) this.refreshClip(node.parent);
  }

  private sizeNode(node: FguiNode, width: number, height: number): void {
    width = Math.max(0, width);
    height = Math.max(0, height);
    const [px, py] = node.source.pivotAsAnchor ? [0, 0] : (node.source.pivot ?? [0, 0]);
    const dw = width - node.width;
    const dh = height - node.height;
    const dx = -px * dw;
    const dy = -py * dh;
    const x = node.x + dx;
    const y = node.y + dy;
    node.width = width;
    node.height = height;
    node.container.setSize(width, height);
    if (node.content instanceof Phaser.GameObjects.Rectangle) node.content.setSize(width, height);
    this.positionNode(node, x, y);
    if (node.list) this.updateListMask(node);
    this.updateEdgeRelations(node, dx, dy, dw, dh);
    if (node.parent?.list?.items.includes(node)) this.relayoutList(node.parent);
  }

  private updateEdgeRelations(target: FguiNode, dx: number, dy: number, dw: number, dh: number): void {
    const parent = target.parent;
    if (!parent || !(dx || dy || dw || dh)) return;
    const [px, py] = target.source.pivotAsAnchor ? target.source.pivot ?? [0, 0] : [0, 0];
    const right = dx + (1 - px) * dw;
    const bottom = dy + (1 - py) * dh;
    // These edges drive the original skill descriptions, separators and centered footer.
    for (const sibling of parent.children.values()) {
      const edges = sibling.source.relations?.find((relation) => relation.targetName === target.source.name)?.relations;
      if (!edges) continue;
      const nextX = edges.some((edge) => !edge.usePercent && edge.type === 'Left_Right') ? right : 0;
      const nextY = edges.some((edge) => !edge.usePercent && edge.type === 'Top_Bottom') ? bottom : 0;
      if (!(nextX || nextY)) continue;
      this.positionNode(sibling, sibling.x + nextX, sibling.y + nextY);
      this.updateEdgeRelations(sibling, nextX, nextY, 0, 0);
    }
    const parentEdges = parent.definition?.relations?.find((relation) => relation.targetName === target.source.name)?.relations;
    const parentWidth = parentEdges?.some((edge) => !edge.usePercent && edge.type === 'RightExt_Right') ? right : 0;
    const parentHeight = parentEdges?.some((edge) => !edge.usePercent && edge.type === 'BottomExt_Bottom') ? bottom : 0;
    if (parentWidth || parentHeight) this.sizeNode(parent, parent.width + parentWidth, parent.height + parentHeight);
  }

  setScroll(path: string, x: number): void {
    const node = this.find(path);
    if (!node.list) throw new Error(`不是滚动列表：${path}`);
    const layout = layoutList(node.source, node.list.items);
    this.positionList(node, layout, x, node.list.scrollY);
    this.updateListMask(node);
  }

  setController(path: string, name: string, index: number): void {
    const node = this.find(path);
    const controller = node.definition?.controllers?.find((candidate) => candidate.name === name);
    if (!controller) throw new Error(`控制器不存在：${path}/${name}`);
    if (!controller.pages[index]) throw new Error(`控制器页不存在：${path}/${name}/${index}`);
    node.controllers.set(name, index);
    this.updateGears(node);
  }

  setUrl(path: string, url: string | null): void {
    this.setLoaderUrl(this.find(path), url);
  }

  private setLoaderUrl(node: FguiNode, url: string | null): void {
    if (!url) return;
    const { pkg, item } = this.registry!.itemByUrl(url);
    const old = node.content;
    const layout = layoutLoader(node.source, item.width, item.height);
    const image = this.createImage({ ...node.source, src: item.id }, pkg, layout.width, layout.height);
    image.setPosition(layout.x, layout.y);
    node.content = image;
    if (old) {
      const index = node.container.getIndex(old);
      node.container.remove(old, true);
      node.container.addAt(image, index);
    } else {
      node.container.add(image);
    }
    if (node.parent?.clip) this.refreshClip(node.parent);
  }

  addListItem(path: string, source: string | FguiChild): FguiNode {
    const listNode = this.find(path);
    if (!listNode.list) throw new Error(`不是列表：${path}`);
    const child = typeof source === 'string' ? this.registry!.componentByUrl(source) : source;
    const packageName = typeof source === 'string'
      ? this.registry!.packageById(source.slice(5, 13)).package.name
      : source.packageId ? this.registry!.packageById(source.packageId).package.name : listNode.source.packageId!;
    const item = this.instantiate(child, packageName, this.childPath(listNode, `item${listNode.list.items.length}`), listNode);
    listNode.list.container.add(item.container);
    listNode.list.items.push(item);
    this.relayoutList(listNode);
    return item;
  }

  clearList(path: string): void {
    const node = this.find(path);
    if (!node.list) return;
    this.trimList(path, 0);
  }

  trimList(path: string, count: number): void {
    const node = this.find(path);
    if (!node.list) throw new Error(`不是列表：${path}`);
    if (!Number.isInteger(count) || count < 0) throw new Error(`FGUI 列表数量无效：${count}`);
    for (const item of node.list.items.splice(count)) {
      this.unregister(item);
      item.container.destroy(true);
    }
    this.relayoutList(node);
  }

  private relayoutList(node: FguiNode): void {
    const list = node.list!;
    const layout = layoutList(node.source, list.items);
    layout.items.forEach((position, index) => this.positionNode(list.items[index]!, position.x, position.y));
    // A visible nested list can extend its template's bottom edge and thus the enclosing scroll content.
    const bottomEdge = node.parent?.definition?.relations?.find((relation) => relation.targetName === node.source.name);
    if (node.source.overflow === 'Visible' && bottomEdge?.relations.some((edge) => !edge.usePercent && edge.type === 'BottomExt_Bottom')) {
      const height = Math.max(node.source.height ?? 0, layout.contentHeight);
      if (height !== node.height) this.sizeNode(node, node.width, height);
    }
    this.positionList(node, layout, list.scrollX, list.scrollY);
    this.updateListMask(node);
  }

  setProgress(path: string, value: number): void {
    const node = this.find(path);
    const bar = node.children.get('bar');
    if (!bar) throw new Error(`进度条缺少 bar：${path}`);
    const min = node.source.min ?? 0;
    const max = node.source.max ?? 100;
    const ratio = Math.max(0, Math.min(1, (value - min) / (max - min)));
    const reverse = (node.source.extension?.['reverse'] as boolean | undefined) ?? false;
    bar.container.setScale(ratio, 1);
    bar.container.x = reverse ? bar.width * (1 - ratio) : 0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    document.removeEventListener('visibilitychange', this.resetSceneDelta);
    for (const view of this.windowViews.keys()) this.releaseView(view);
    this.nodes.clear();
    this.componentIds.clear();
    this.presses.clear();
    this.game?.destroy(true);
    this.game = null;
    this.scene = null;
    this.ready = null;
  }
}

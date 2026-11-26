import {
  spriteLocalQuad,
  type OrthographicProjection,
  type Point2,
  type Point3,
  type ScreenPoint,
  type Size,
  type SpriteQuad,
} from './orthographic';

type Quaternion = Point3 & { w: number };

export interface PrefabPose {
  position?: Point3;
  rotation?: Quaternion;
  scale?: Point3;
}

interface PrefabTransform {
  pathId: string;
  gameObject: string;
  parent: string;
  siblingIndex: number;
  localPosition: Point3;
  localRotation: Quaternion;
  localScale: Point3;
}

interface PrefabSpriteRenderer {
  pathId: string;
  gameObject: string;
  sprite: string;
  enabled: boolean;
  flipX: boolean;
  flipY: boolean;
  sortingLayer: number;
  sortingLayerId: number;
  sortingOrder: number;
  spriteSortPoint?: number;
  drawMode?: number;
  color?: { a: number };
}

interface SpriteFrame extends Size {
  file: string;
}

interface PrefabSprite {
  pathId: string;
  texture: string;
  rect: Size;
  pivot: Point2;
  pixelsToUnits: number;
  textureRect: Size;
  textureRectOffset: Point2;
  frame: SpriteFrame;
}

interface SpriteKey {
  /** Seconds relative to the beginning of the clip. */
  time: number;
  sprite: string;
}

interface SpriteClip {
  name: string;
  duration: number;
  loopTime: boolean;
  curves: readonly {
    kind: string;
    target: { gameObject: string; component: string };
    keys: readonly SpriteKey[];
  }[];
}

export interface PrefabDocument {
  prefab: { rootTransform: string };
  objects: {
    gameObjects: readonly { pathId: string; active: boolean }[];
    transforms: readonly PrefabTransform[];
    spriteRenderers: readonly PrefabSpriteRenderer[];
    sprites: readonly PrefabSprite[];
    textures?: readonly { pathId: string; filterMode?: number }[];
  };
  animations: { clips: readonly SpriteClip[] };
}

export type SpriteFilterMode = 'point' | 'bilinear';

export interface PrefabPlayerOptions {
  filterForTexture?: (textureId: string) => SpriteFilterMode | undefined;
  sortingLayerValue?: (sortingLayerId: number) => number | undefined;
}

export interface PrefabSampleOptions {
  /** A transform placed outside the authored prefab hierarchy. */
  pose?: PrefabPose;
  /** The caller owns the playback clock and forwards seconds elapsed since clip entry. */
  animation?: { clipName: string; elapsedSeconds: number };
  sortingOrderOffset?: number;
}

export interface PrefabSpriteCommand {
  frame: SpriteFrame;
  quad: SpriteQuad<ScreenPoint>;
  sortingLayer: number;
  sortingOrder: number;
  sortDepth: number;
  filterMode: SpriteFilterMode;
  alpha: number;
}

interface AffineTransform {
  origin: Point3;
  xAxis: Point3;
  yAxis: Point3;
  zAxis: Point3;
}

const zero = { x: 0, y: 0, z: 0 };
const unitScale = { x: 1, y: 1, z: 1 };
const identityRotation = { ...zero, w: 1 };

function affine({
  position = zero,
  rotation = identityRotation,
  scale = unitScale,
}: PrefabPose = {}): AffineTransform {
  const length = Math.hypot(rotation.x, rotation.y, rotation.z, rotation.w);
  if (!Number.isFinite(length) || length === 0) {
    throw new RangeError('Prefab rotations must be finite nonzero quaternions.');
  }
  const x = rotation.x / length;
  const y = rotation.y / length;
  const z = rotation.z / length;
  const w = rotation.w / length;
  return {
    origin: position,
    xAxis: {
      x: scale.x * (1 - 2 * (y * y + z * z)),
      y: scale.x * 2 * (x * y + z * w),
      z: scale.x * 2 * (x * z - y * w),
    },
    yAxis: {
      x: scale.y * 2 * (x * y - z * w),
      y: scale.y * (1 - 2 * (x * x + z * z)),
      z: scale.y * 2 * (y * z + x * w),
    },
    zAxis: {
      x: scale.z * 2 * (x * z + y * w),
      y: scale.z * 2 * (y * z - x * w),
      z: scale.z * (1 - 2 * (x * x + y * y)),
    },
  };
}

function transformVector({ xAxis, yAxis, zAxis }: AffineTransform, { x, y, z }: Point3): Point3 {
  return {
    x: xAxis.x * x + yAxis.x * y + zAxis.x * z,
    y: xAxis.y * x + yAxis.y * y + zAxis.y * z,
    z: xAxis.z * x + yAxis.z * y + zAxis.z * z,
  };
}

function transformPoint(transform: AffineTransform, point: Point3): Point3 {
  const local = transformVector(transform, point);
  return {
    x: transform.origin.x + local.x,
    y: transform.origin.y + local.y,
    z: transform.origin.z + local.z,
  };
}

function compose(parent: AffineTransform, child: AffineTransform): AffineTransform {
  return {
    origin: transformPoint(parent, child.origin),
    xAxis: transformVector(parent, child.xAxis),
    yAxis: transformVector(parent, child.yAxis),
    zAxis: transformVector(parent, child.zAxis),
  };
}

function collectTransforms(document: PrefabDocument): Map<string, AffineTransform> {
  const { gameObjects, transforms } = document.objects;
  const active = new Set(gameObjects.filter((object) => object.active).map((object) => object.pathId));
  const children = new Map<string, PrefabTransform[]>();
  for (const transform of transforms) {
    const siblings = children.get(transform.parent);
    if (siblings) siblings.push(transform);
    else children.set(transform.parent, [transform]);
  }

  const result = new Map<string, AffineTransform>();
  function visit(transform: PrefabTransform, parent: AffineTransform) {
    if (!active.has(transform.gameObject) || result.has(transform.gameObject)) return;
    const world = compose(parent, affine({
      position: transform.localPosition,
      rotation: transform.localRotation,
      scale: transform.localScale,
    }));
    result.set(transform.gameObject, world);
    for (const child of (children.get(transform.pathId) ?? []).sort((a, b) => a.siblingIndex - b.siblingIndex)) {
      visit(child, world);
    }
  }

  const root = transforms.find((transform) => transform.pathId === document.prefab.rootTransform);
  if (!root) throw new RangeError('Prefab is missing its root transform.');
  visit(root, affine());
  return result;
}

function prepareClips(clips: readonly SpriteClip[]) {
  return new Map(clips.map((clip) => [clip.name, {
    duration: clip.duration,
    loop: clip.loopTime,
    targets: new Map(clip.curves
      .filter((curve) => curve.kind === 'pptrSprite' && curve.target.component === 'SpriteRenderer')
      .map((curve) => [curve.target.gameObject, [...curve.keys].sort((a, b) => a.time - b.time)])),
  }]));
}

function sampleSprite(keys: readonly SpriteKey[], time: number, defaultSprite: string): string {
  let spriteId = defaultSprite;
  for (const key of keys) {
    if (key.time > time) break;
    spriteId = key.sprite;
  }
  return spriteId;
}

/** Compiles rectangular SpriteRenderers, their authored transforms and resolved clip curves. */
export function compilePrefabPlayer(document: PrefabDocument, {
  filterForTexture,
  sortingLayerValue,
}: PrefabPlayerOptions = {}) {
  const transforms = collectTransforms(document);
  const sprites = new Map(document.objects.sprites.map((sprite) => [sprite.pathId, sprite]));
  const filters = new Map(document.objects.textures?.map((texture) => [texture.pathId, texture.filterMode]));
  const clips = prepareClips(document.animations.clips);
  const renderers = document.objects.spriteRenderers.filter(
    (renderer) => renderer.enabled && transforms.has(renderer.gameObject) && (renderer.drawMode ?? 0) === 0,
  );

  return {
    sample(project: OrthographicProjection, {
      pose,
      animation,
      sortingOrderOffset = 0,
    }: PrefabSampleOptions = {}): PrefabSpriteCommand[] {
      const placement = pose && affine(pose);
      const clip = animation && clips.get(animation.clipName);
      const elapsed = animation && Number.isFinite(animation.elapsedSeconds)
        ? Math.max(0, animation.elapsedSeconds)
        : 0;
      const time = clip
        ? (clip.loop && clip.duration > 0 ? elapsed % clip.duration : Math.min(elapsed, clip.duration))
        : 0;
      const commands = [];
      for (const renderer of renderers) {
        const transform = transforms.get(renderer.gameObject);
        if (!transform) continue;
        const keys = clip?.targets.get(renderer.gameObject) ?? [];
        const sprite = sprites.get(sampleSprite(keys, time, renderer.sprite));
        if (!sprite?.frame.file || sprite.frame.width <= 0 || sprite.frame.height <= 0) continue;

        const model = placement ? compose(placement, transform) : transform;
        const local = spriteLocalQuad({
          rect: sprite.rect,
          pivot: sprite.pivot,
          pixelsPerUnit: sprite.pixelsToUnits,
          trim: { ...sprite.textureRect, offset: sprite.textureRectOffset },
        }, renderer);
        const projectCorner = ({ x, y }: Point2) => project(transformPoint(model, { x, y, z: 0 }));
        const quad = {
          topLeft: projectCorner(local.topLeft),
          topRight: projectCorner(local.topRight),
          bottomRight: projectCorner(local.bottomRight),
          bottomLeft: projectCorner(local.bottomLeft),
        };
        const sortDepth = renderer.spriteSortPoint === 1
          ? project(model.origin).depth
          : (quad.topLeft.depth + quad.bottomRight.depth) / 2;
        commands.push({
          frame: sprite.frame,
          quad,
          sortDepth,
          sortingLayer: sortingLayerValue?.(renderer.sortingLayerId) ?? renderer.sortingLayer,
          sortingOrder: sortingOrderOffset + renderer.sortingOrder,
          filterMode: filterForTexture?.(sprite.texture) ?? (filters.get(sprite.texture) === 0 ? 'point' : 'bilinear'),
          alpha: renderer.color?.a ?? 1,
        } satisfies PrefabSpriteCommand);
      }
      return commands;
    },
  };
}

type SpriteContext = Pick<CanvasRenderingContext2D,
  'save' | 'restore' | 'transform' | 'drawImage' | 'globalAlpha' | 'imageSmoothingEnabled' | 'imageSmoothingQuality'>;

/** Draws one or more sampled prefabs without clearing or replacing the caller's canvas transform. */
export function drawPrefabSprites(
  context: SpriteContext,
  commands: readonly PrefabSpriteCommand[],
  resolveFrame: (file: string) => CanvasImageSource | undefined,
): number {
  const sorted = [...commands].sort((a, b) => a.sortingLayer - b.sortingLayer
    || a.sortingOrder - b.sortingOrder || b.sortDepth - a.sortDepth);
  let drawn = 0;
  for (const command of sorted) {
    const { file, width, height } = command.frame;
    const image = resolveFrame(file);
    if (!image) continue;
    const { topLeft, topRight, bottomLeft } = command.quad;
    context.save();
    try {
      context.imageSmoothingEnabled = command.filterMode === 'bilinear';
      context.imageSmoothingQuality = 'low';
      context.globalAlpha *= command.alpha;
      context.transform(
        (topRight.x - topLeft.x) / width, (topRight.y - topLeft.y) / width,
        (bottomLeft.x - topLeft.x) / height, (bottomLeft.y - topLeft.y) / height,
        topLeft.x, topLeft.y,
      );
      context.drawImage(image, 0, 0, width, height);
      drawn++;
    } finally {
      context.restore();
    }
  }
  return drawn;
}

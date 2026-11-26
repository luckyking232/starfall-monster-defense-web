import { describe, expect, it, vi } from 'vitest';
import { createOrthographicProjection } from '../../src/presentation/orthographic';
import {
  compilePrefabPlayer,
  drawPrefabSprites,
  type PrefabDocument,
} from '../../src/presentation/prefab-player';

const identity = { x: 0, y: 0, z: 0, w: 1 };
const project = createOrthographicProjection({
  position: { x: 0, y: 0, z: -5 },
  rotation: identity,
  orthographicSize: 5,
}, { width: 200, height: 100 });

function prefab(): PrefabDocument {
  return {
    prefab: { rootTransform: '100' },
    objects: {
      gameObjects: [
        { pathId: '10', active: true },
        { pathId: '20', active: true },
      ],
      transforms: [
        {
          pathId: '200', gameObject: '20', parent: '100', siblingIndex: 0,
          localPosition: { x: 0, y: 0, z: 0 },
          localRotation: identity,
          localScale: { x: 1, y: 1, z: 1 },
        },
        {
          pathId: '100', gameObject: '10', parent: '0', siblingIndex: 0,
          localPosition: { x: 0, y: 0, z: 0 },
          localRotation: identity,
          localScale: { x: 1, y: 1, z: 1 },
        },
      ],
      spriteRenderers: [
        {
          pathId: '300', gameObject: '20', enabled: true, sprite: '400',
          flipX: false, flipY: false, sortingLayer: 1, sortingLayerId: 102, sortingOrder: 4,
        },
      ],
      sprites: [
        {
          pathId: '400', texture: '500', pixelsToUnits: 10,
          rect: { width: 20, height: 10 }, pivot: { x: 0.5, y: 0.5 },
          textureRect: { width: 20, height: 10 }, textureRectOffset: { x: 0, y: 0 },
          frame: { file: 'frames/first.png', width: 20, height: 10 },
        },
        {
          pathId: '401', texture: '501', pixelsToUnits: 10,
          rect: { width: 20, height: 10 }, pivot: { x: 0.25, y: 0.5 },
          textureRect: { width: 6, height: 4 }, textureRectOffset: { x: 2, y: 3 },
          frame: { file: 'frames/second.png', width: 6, height: 4 },
        },
      ],
      textures: [
        { pathId: '500', filterMode: 0 },
        { pathId: '501', filterMode: 1 },
      ],
    },
    animations: {
      clips: [{
        name: 'sample', duration: 1, loopTime: true,
        curves: [{
          target: { gameObject: '20', component: 'SpriteRenderer' }, kind: 'pptrSprite',
          keys: [{ time: 0.25, sprite: '401' }, { time: 0.75, sprite: '0' }],
        }],
      }],
    },
  };
}

describe('compilePrefabPlayer', () => {
  it('composes the hierarchy despite unordered transforms and applies an external pose', () => {
    const data = prefab();
    Object.assign(data.objects.transforms[1]!, {
      localPosition: { x: 1, y: 1, z: 0 },
      localRotation: { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 },
      localScale: { x: 2, y: 3, z: 1 },
    });
    Object.assign(data.objects.transforms[0]!, { localPosition: { x: 2, y: 1, z: 1 } });
    const player = compilePrefabPlayer(data);
    const [command] = player.sample(project, { pose: { position: { x: 1, y: -1, z: 1 } } });

    expect(command?.frame.file).toBe('frames/first.png');
    expect(command?.quad.topLeft.x).toBeCloseTo(75);
    expect(command?.quad.topLeft.y).toBeCloseTo(30);
    expect(command?.quad.topRight.x).toBeCloseTo(75);
    expect(command?.quad.topRight.y).toBeCloseTo(-10);
    expect(command?.quad.bottomLeft.x).toBeCloseTo(105);
    expect(command?.sortDepth).toBeCloseTo(7);
  });

  it('holds the default before the first key, steps at the key, and wraps looping clips', () => {
    const player = compilePrefabPlayer(prefab());
    const frame = (elapsedSeconds: number) => player.sample(project, {
      animation: { clipName: 'sample', elapsedSeconds },
    })[0]?.frame.file;

    expect(frame(0.249)).toBe('frames/first.png');
    expect(frame(0.25)).toBe('frames/second.png');
    expect(frame(0.74)).toBe('frames/second.png');
    expect(frame(0.75)).toBeUndefined();
    expect(frame(1.1)).toBe('frames/first.png');
    expect(frame(1.5)).toBe('frames/second.png');
  });

  it('keeps the last frame of a non-looping clip and uses defaults for unknown clips', () => {
    const data = prefab();
    Object.assign(data.animations.clips[0]!, { loopTime: false });
    Object.assign(data.animations.clips[0]!.curves[0]!.keys[1]!, { sprite: '401' });
    const player = compilePrefabPlayer(data);

    expect(player.sample(project, { animation: { clipName: 'sample', elapsedSeconds: 10 } })[0]?.frame.file)
      .toBe('frames/second.png');
    expect(player.sample(project, { animation: { clipName: 'missing', elapsedSeconds: 10 } })[0]?.frame.file)
      .toBe('frames/first.png');
  });

  it('uses the current sprite geometry and flips it around its original pivot', () => {
    const data = prefab();
    Object.assign(data.objects.spriteRenderers[0]!, { flipX: true, flipY: true });
    const [command] = compilePrefabPlayer(data).sample(project, {
      animation: { clipName: 'sample', elapsedSeconds: 0.5 },
    });

    expect(command?.quad.topLeft.x).toBeCloseTo(103);
    expect(command?.quad.topLeft.y).toBeCloseTo(52);
    expect(command?.quad.bottomRight.x).toBeCloseTo(97);
    expect(command?.quad.bottomRight.y).toBeCloseTo(48);
  });

  it('skips disabled renderers and descendants of inactive nodes', () => {
    const data = prefab();
    Object.assign(data.objects.gameObjects[0]!, { active: false });
    expect(compilePrefabPlayer(data).sample(project)).toEqual([]);
    Object.assign(data.objects.gameObjects[0]!, { active: true });
    Object.assign(data.objects.spriteRenderers[0]!, { enabled: false });
    expect(compilePrefabPlayer(data).sample(project)).toEqual([]);
  });

  it('allows a texture filter and a sorting layer value to be supplied independently', () => {
    const [command] = compilePrefabPlayer(prefab(), {
      filterForTexture: (id) => id === '500' ? 'bilinear' : undefined,
      sortingLayerValue: (id) => id === 102 ? 99 : 0,
    }).sample(project, { sortingOrderOffset: -5 });

    expect(command).toMatchObject({ filterMode: 'bilinear', sortingLayer: 99, sortingOrder: -1 });
  });
});

describe('drawPrefabSprites', () => {
  it('sorts across instances and draws by affine transform with each frame filter', () => {
    const player = compilePrefabPlayer(prefab());
    const [front] = player.sample(project, { sortingOrderOffset: 1 });
    const [back] = player.sample(project, {
      animation: { clipName: 'sample', elapsedSeconds: 0.5 },
    });
    const [far] = player.sample(project, { pose: { position: { x: 0, y: 0, z: 2 } } });
    const [lowerLayer] = compilePrefabPlayer(prefab(), { sortingLayerValue: () => 0 })
      .sample(project, { sortingOrderOffset: 100 });
    const calls: string[] = [];
    const bitmap = {} as HTMLImageElement;
    const canvas = {
      save: vi.fn(),
      restore: vi.fn(),
      transform: vi.fn(),
      drawImage: vi.fn(),
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high' as const,
      globalAlpha: 1,
    };
    canvas.drawImage.mockImplementation(() => calls.push(canvas.imageSmoothingEnabled ? 'bilinear' : 'point'));
    const resolveFrame = vi.fn(() => bitmap);

    expect(drawPrefabSprites(canvas, [front!, back!, far!, lowerLayer!], resolveFrame)).toBe(4);
    expect(calls).toEqual(['point', 'point', 'bilinear', 'point']);
    expect(resolveFrame.mock.calls).toEqual([
      ['frames/first.png'], ['frames/first.png'], ['frames/second.png'], ['frames/first.png'],
    ]);
    expect(canvas.transform).toHaveBeenLastCalledWith(1, 0, 0, 1, 90, 45);
    expect(canvas.drawImage).toHaveBeenLastCalledWith(bitmap, 0, 0, 20, 10);
    expect(canvas.restore).toHaveBeenCalledTimes(4);
  });
});

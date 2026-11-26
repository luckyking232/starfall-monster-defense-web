import { describe, expect, it } from 'vitest';
import {
  createOrthographicProjection,
  projectSpriteQuad,
  spriteLocalQuad,
} from '../../src/presentation/orthographic';

const camera = {
  position: { x: 0, y: 0, z: -7 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  orthographicSize: 4,
};

const sprite = {
  rect: { width: 80, height: 60 },
  pivot: { x: 0.25, y: 0.5 },
  trim: { offset: { x: 8, y: 12 }, width: 30, height: 24 },
  pixelsPerUnit: 12,
};

describe('createOrthographicProjection', () => {
  it('uses camera-relative coordinates and a top-left screen origin', () => {
    const project = createOrthographicProjection({
      ...camera,
      position: { x: 10, y: -4, z: -7 },
    }, { width: 600, height: 400 });

    expect(project({ x: 10, y: -4, z: 0 })).toEqual({ x: 300, y: 200, depth: 7 });
    expect(project({ x: 14, y: -1, z: 5 })).toEqual({ x: 500, y: 50, depth: 12 });
  });

  it('keeps vertical world coverage when the viewport narrows', () => {
    const project = createOrthographicProjection(camera, { width: 200, height: 400 });

    expect(project({ x: -2, y: 4, z: 0 })).toEqual({ x: 0, y: 0, depth: 7 });
    expect(project({ x: 3, y: -4, z: 0 })).toEqual({ x: 250, y: 400, depth: 7 });
  });

  it('projects onto the inverse camera rotation, including tilt out of the XY plane', () => {
    const project = createOrthographicProjection({
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 },
      orthographicSize: 4,
    }, { width: 600, height: 400 });
    const projected = project({ x: 2, y: -3, z: 1 });

    expect(projected.x).toBeCloseTo(400);
    expect(projected.y).toBeCloseTo(150);
    expect(projected.depth).toBeCloseTo(3);
  });

  it('rejects a degenerate projection', () => {
    expect(() => createOrthographicProjection(camera, { width: 200, height: 0 })).toThrow(RangeError);
    expect(() => createOrthographicProjection({
      ...camera,
      rotation: { x: 0, y: 0, z: 0, w: 0 },
    }, { width: 200, height: 400 })).toThrow(RangeError);
  });
});

describe('spriteLocalQuad', () => {
  it('places the trimmed rectangle relative to the pivot of the original rect', () => {
    expect(spriteLocalQuad(sprite)).toEqual({
      topLeft: { x: -1, y: 0.5 },
      topRight: { x: 1.5, y: 0.5 },
      bottomRight: { x: 1.5, y: -1.5 },
      bottomLeft: { x: -1, y: -1.5 },
    });
  });

  it('preserves source-corner identity while flipping on both axes around the pivot', () => {
    expect(spriteLocalQuad(sprite, { flipX: true, flipY: true })).toEqual({
      topLeft: { x: 1, y: -0.5 },
      topRight: { x: -1.5, y: -0.5 },
      bottomRight: { x: -1.5, y: 1.5 },
      bottomLeft: { x: 1, y: 1.5 },
    });
  });

  it('uses the full rect for an untrimmed image', () => {
    expect(spriteLocalQuad({
      rect: { width: 18, height: 24 },
      pivot: { x: 0.5, y: 0.5 },
      pixelsPerUnit: 6,
    })).toEqual({
      topLeft: { x: -1.5, y: 2 },
      topRight: { x: 1.5, y: 2 },
      bottomRight: { x: 1.5, y: -2 },
      bottomLeft: { x: -1.5, y: -2 },
    });
  });

  it('rejects nonpositive pixels per unit', () => {
    expect(() => spriteLocalQuad({ ...sprite, pixelsPerUnit: 0 })).toThrow(RangeError);
  });
});

describe('projectSpriteQuad', () => {
  it('projects a flipped trimmed sprite at its world-space pivot', () => {
    const project = createOrthographicProjection(camera, { width: 200, height: 400 });

    expect(projectSpriteQuad(project, { x: 1, y: -1, z: 2 }, sprite, { flipX: true })).toEqual({
      topLeft: { x: 200, y: 225, depth: 9 },
      topRight: { x: 75, y: 225, depth: 9 },
      bottomRight: { x: 75, y: 325, depth: 9 },
      bottomLeft: { x: 200, y: 325, depth: 9 },
    });
  });
});

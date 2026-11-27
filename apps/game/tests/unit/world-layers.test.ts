import { expect, test } from 'vitest';
import { visitWorldLayers } from '../../src/presentation/world-layers';

test('retains Unity layer, order, depth and stable ties across the two renderers', () => {
  const sprite = (name: string, sortingLayer: number, sortingOrder: number, sortDepth = 0) => ({
    name, sortingLayer, sortingOrder, sortDepth,
  });
  const sprites = [sprite('front', 1, -10), sprite('near', 0, 10), sprite('behind', -1, 20),
    sprite('far', 0, 10, 1), sprite('near-tie', 0, 10), sprite('last', 0, 30)];
  const effects = [{ order: 1, name: 'low' }, { order: 10, name: 'first' }, { order: 10, name: 'second' },
    { order: 12, name: 'high' }];
  const drawn: string[] = [];
  visitWorldLayers(sprites, effects,
    (start, end) => drawn.push(`sprites: ${sprites.slice(start, end).map(x => x.name).join(', ')}`),
    (start, end) => drawn.push(`effects: ${effects.slice(start, end).map(x => x.name).join(', ')}`));
  expect(drawn).toEqual(['sprites: behind', 'effects: low', 'sprites: far, near, near-tie',
    'effects: first, second', 'effects: high', 'sprites: last, front']);
});

test('draws all sprites when no effects were sampled', () => {
  const drawn: number[][] = [];
  visitWorldLayers([{ sortingLayer: 0, sortingOrder: 0, sortDepth: 0 }], [],
    (start, end) => drawn.push([start, end]), () => { throw new Error('Unexpected effect draw'); });
  expect(drawn).toEqual([[0, 1]]);
});

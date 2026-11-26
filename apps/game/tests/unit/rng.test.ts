import { describe, expect, it } from 'vitest';
import { createProductionRng } from '../../src/engine/rng';

describe('createProductionRng', () => {
  it('uses independent system random values in the original input ranges', () => {
    const original = crypto.getRandomValues.bind(crypto);
    const draws: number[] = [];
    try {
      crypto.getRandomValues = <T extends ArrayBufferView | null>(array: T): T => {
        if (array instanceof Uint32Array) {
          array.forEach((_, index) => { array[index] = index; });
          draws.push(array.length);
        }
        return array;
      };
      const input = createProductionRng(78000001);
      expect(input.tape).toEqual(Array.from({ length: 50 }, (_, index) => index + 1));
      expect(input.globalRngSeeds).toEqual([50, 78000001]);
      expect(draws).toEqual([52]);
    } finally {
      crypto.getRandomValues = original;
    }
  });

  it('keeps the Lua global seed within its signed 31-bit input contract', () => {
    const original = crypto.getRandomValues.bind(crypto);
    try {
      crypto.getRandomValues = <T extends ArrayBufferView | null>(array: T): T => {
        if (array instanceof Uint32Array) array.fill(0xffffffff);
        return array;
      };
      const input = createProductionRng(78000001);
      expect(input.globalRngSeeds).toEqual([0x7fffffff, 78000001]);
      expect(input.tape.every((value) => value >= 1 && value <= 10000)).toBe(true);
    } finally {
      crypto.getRandomValues = original;
    }
  });
});

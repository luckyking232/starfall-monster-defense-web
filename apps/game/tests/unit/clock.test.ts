import { describe, expect, it } from 'vitest';
import { createFixedClock } from '../../src/engine/clock';

describe('createFixedClock', () => {
  it('advances 30 fixed steps per second and preserves fractions', () => {
    const clock = createFixedClock();
    expect(clock.advance(500, 1)).toBe(7);
    expect(clock.advance(500, 1)).toBe(8);
    expect(clock.advance(16, 1)).toBe(0);
    expect(clock.advance(17, 1)).toBe(0);
    expect(clock.advance(1, 1)).toBe(1);
  });

  it('applies speed without changing the fixed simulation rate', () => {
    const clock = createFixedClock();
    expect(clock.advance(500, 2)).toBe(15);
    clock.reset();
    expect(clock.advance(500, 1)).toBe(7);
  });

  it('caps long deltas and rejects invalid values', () => {
    const clock = createFixedClock();
    expect(clock.advance(5000, 1)).toBe(7);
    expect(() => clock.advance(-1, 1)).toThrow(RangeError);
    expect(() => clock.advance(Number.NaN, 1)).toThrow(RangeError);
  });
});

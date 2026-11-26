export interface FixedClock {
  reset(): void;
  advance(deltaMs: number, speed: 1 | 2): number;
  readonly remainderMs: number;
}

export function createFixedClock(maxDeltaMs = 250): FixedClock {
  let remainder = 0;
  return {
    reset() {
      remainder = 0;
    },
    advance(deltaMs: number, speed: 1 | 2): number {
      if (!Number.isFinite(deltaMs) || deltaMs < 0) throw new RangeError('Invalid clock delta');
      deltaMs = Math.min(deltaMs, maxDeltaMs);
      remainder += deltaMs * (30 * speed) / 1000;
      const steps = Math.floor(remainder + 1e-8);
      remainder -= steps;
      return steps;
    },
    get remainderMs() {
      return remainder;
    },
  };
}

import { describe, expect, it } from 'vitest';
import { particleSamples, type ParticleEmitter } from '../../src/presentation/particle-sampling';

const emitter: ParticleEmitter = {
  delay: 0,
  speed: 1,
  life: [2, 2],
  size: [1, 1],
  rate: 0,
  limit: 1,
  duration: 5,
  loop: false,
  world: false,
  ring: 1,
  ringRange: [0, 1],
  bursts: [[0, 1, 1, 0, 1]],
  startSpeed: 1,
  gravity: 0,
  rotation: [0, 0, 0],
};
const color = [1, 1, 1, 1];

describe('particle angular velocity', () => {
  it('rotates a retained particle without restarting emission or position', () => {
    const source = { ...emitter, spin: 2 };
    const first = particleSamples(source, color, 2, 1, 0)[0]!;
    const later = particleSamples(source, color, 4, 1, 0)[0]!;
    expect(first.rotation[2]).toBeCloseTo(4);
    expect(later.rotation[2]).toBeCloseTo(8);
    expect(later.position).toEqual(first.position);
    expect(later.emittedAt).toBe(0);
  });

  it('accumulates the serialized angular-velocity curve before holding its final velocity', () => {
    const source: ParticleEmitter = {
      ...emitter,
      spinXY: [[{ scale: 2, keys: [[0, 0, 1, 1], [1, 1, 1, 1]] }], -1],
    };
    expect(particleSamples(source, color, 1, 1, 0)[0]?.rotation).toEqual([0.5, -1, 0]);
    expect(particleSamples(source, color, 2.5, 1, 0)[0]?.rotation).toEqual([3, -2.5, 0]);
  });

  it('accumulates repeated velocity intervals and preserves expiry for non-retained particles', () => {
    const source: ParticleEmitter = {
      ...emitter,
      ring: 2,
      ringRange: [0.25, 0.75],
      spin: [{ scale: 2, keys: [[0, 0, 1, 1], [1, 1, 1, 1]] }],
    };
    expect(particleSamples(source, color, 3.5, 1, 0)[0]?.rotation[2]).toBeCloseTo(3.375);
    expect(particleSamples({ ...source, ring: 0 }, color, 3.5, 1, 0)).toEqual([]);
  });
});

import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { createOriginalUiHost } from '../../runtime/ui/host.ts';
import { replayRules } from '../../scripts/lib/rule-replay.mjs';
import { firstRuleDifference } from '../../scripts/lib/rule-trace-diff.ts';

const publicDir = path.resolve(import.meta.dirname, '../../public');
const options = { createHost: createOriginalUiHost, publicDir };

test('ordinary stage replay observes all fixed callbacks of a batched host tick and seeded RNG', async () => {
  const reference = await replayRules({ ...options, stage: 18, lastFrame: 12, seed: 70441022 });
  const candidate = await replayRules({ ...options, stage: 18, lastFrame: 12, seed: 70441022 });
  expect(reference.seedCalls).toBe(1);
  expect(reference.records.filter(record => record.kind === 'fixed').map(record => record.frame))
    .toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  expect(reference.records.flatMap(record => record.events ?? [])).toContainEqual(
    expect.objectContaining({ type: 'seed', value: 70441022 }),
  );
  expect(candidate.records).toEqual(reference.records);
}, 30000);

test('the built-in stress seed takes precedence over the ordinary replay seed', async () => {
  const { records, seedCalls, summary } = await replayRules({ ...options, stage: 'stress', lastFrame: 1, seed: 17 });
  expect(seedCalls).toBe(0);
  expect(records.flatMap(record => record.events ?? [])).toContainEqual(
    expect.objectContaining({ type: 'seed', value: 70441022 }),
  );
  expect(summary['loadout']).toEqual({ heroes: 5, unlockedSkills: 15, upgrades: 135 });
}, 30000);

test('an ordinary player without a seed override still uses the original browser entropy', async () => {
  const entropy = vi.spyOn(crypto, 'getRandomValues').mockImplementation(array => {
    (array as Uint32Array)[0] = 0x80000035;
    return array;
  });
  try {
    const { records, seedCalls } = await replayRules({ ...options, stage: 18, lastFrame: 1 });
    expect(seedCalls).toBe(0);
    expect(entropy).toHaveBeenCalledOnce();
    expect(records.flatMap(record => record.events ?? [])).toContainEqual(
      expect.objectContaining({ type: 'seed', value: 0x35 }),
    );
  } finally {
    entropy.mockRestore();
  }
}, 30000);

test('an extra original RNG draw produces a first difference at the injected rule frame', async () => {
  const replay = { ...options, stage: 18 as const, lastFrame: 12, seed: 70441022 };
  const reference = await replayRules(replay);
  const altered = await replayRules({ ...replay, extraRandomFrame: 8 });
  expect(firstRuleDifference(reference.records, altered.records)).toMatchObject({
    frame: 8, object: 'battle-rng', field: 'events[0]', reference: null,
    candidate: { type: 'random', index: expect.any(Number), value: expect.any(Number) },
  });
}, 30000);

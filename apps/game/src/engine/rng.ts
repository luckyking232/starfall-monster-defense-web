import type { RngInput } from './protocol';

export function createProductionRng(stageId: number): RngInput {
  const values = crypto.getRandomValues(new Uint32Array(52));
  return {
    tape: Array.from(values.subarray(0, 50), (value) => value % 10000 + 1),
    globalRngSeeds: [values[50]! & 0x7fffffff, stageId],
  };
}

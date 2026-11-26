import { describe, expect, it } from 'vitest';
import { isStageUnlocked, STAGES } from '../../src/content/stages';

describe('stage catalog', () => {
  it('contains the original 21-stage chain and three maps', () => {
    expect(STAGES).toHaveLength(21);
    expect(STAGES[0]).toMatchObject({ id: 78000001, pre: 0, map: 'map1', unlockDay: 0 });
    expect(STAGES[1]?.map).toBe('map2');
    expect(STAGES[2]?.map).toBe('map3');
    expect(STAGES[20]).toMatchObject({ id: 78000021, pre: 78000020, unlockDay: 10, endless: true });
    expect(new Set(STAGES.map((stage) => stage.map))).toEqual(new Set(['map1', 'map2', 'map3']));
  });

  it('requires both the previous clear and the original unlock day', () => {
    const now = 1752365557 + 11 * 86400;
    expect(isStageUnlocked(STAGES[0]!, [], now)).toBe(true);
    expect(isStageUnlocked(STAGES[1]!, [], now)).toBe(false);
    expect(isStageUnlocked(STAGES[1]!, [78000001], now)).toBe(true);
    expect(isStageUnlocked(STAGES[2]!, [78000001, 78000002], now)).toBe(true);
    expect(isStageUnlocked(STAGES[2]!, [78000001, 78000002], now - 11 * 86400)).toBe(false);
  });
});

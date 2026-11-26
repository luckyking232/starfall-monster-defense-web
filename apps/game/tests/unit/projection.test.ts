import { describe, expect, it } from 'vitest';
import { projectBattlePosition } from '../../src/presentation/projection';

describe('projectBattlePosition', () => {
  it('maps the original 75-pixel world with the 60-degree camera at 1334x750', () => {
    expect(projectBattlePosition({ x: 0, y: 0, z: 0 })).toEqual({ x: 667, y: 375 });
    expect(projectBattlePosition({ x: -540, y: 115, z: 0 })).toEqual({ x: 127, y: 317.5 });
    expect(projectBattlePosition({ x: -420, y: 75, z: 0 })).toEqual({ x: 247, y: 337.5 });
  });

  it('moves greater plane y upwards and uses height rather than plane y for z', () => {
    const lower = projectBattlePosition({ x: 0, y: -40, z: 0 });
    const upper = projectBattlePosition({ x: 0, y: 40, z: 0 });
    const raised = projectBattlePosition({ x: 0, y: 0, z: 40 });
    expect(upper.y).toBeLessThan(lower.y);
    expect(raised.y).toBeCloseTo(375 - 40 * Math.cos(Math.PI / 3));
  });

  it('preserves the original proportions when the viewport is scaled', () => {
    expect(projectBattlePosition({ x: 100, y: 100, z: 0 }, 2668, 1500)).toEqual({ x: 1534, y: 650 });
  });
});

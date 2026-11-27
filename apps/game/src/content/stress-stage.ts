import { RULES_FPS } from '../engine/protocol';
import { STAGES } from './stages';

export const STRESS_STAGE = {
  id: STAGES.find(stage => stage.endless)!.id,
  seed: 70441022,
  initialSpeed: 2,
  tierFrames: 8 * RULES_FPS,
  initialMonsters: 100,
  maxMonsters: 300,
  spawnPerFrame: 4,
} as const;

export function stressMonsterTarget(fixedFrame: number): number {
  return Math.min(STRESS_STAGE.maxMonsters,
    STRESS_STAGE.initialMonsters * (1 + Math.floor(fixedFrame / STRESS_STAGE.tierFrames)));
}

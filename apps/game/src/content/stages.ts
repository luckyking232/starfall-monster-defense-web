export type BattleMap = 'map1' | 'map2' | 'map3';

export interface StageDefinition {
  id: number;
  pre: number;
  next: number;
  unlockDay: number;
  monsterGroup: number;
  map: BattleMap;
  backgroundPath: string;
  endless?: boolean;
}

export const ACTIVITY_START_STAMP = 1752365557;
const DAY_SECONDS = 86400;

function stage(
  index: number,
  pre: number,
  unlockDay: number,
  map: BattleMap,
  endless = false,
): StageDefinition {
  const id = 78000000 + index;
  return {
    id,
    pre,
    next: index === 21 ? 0 : id + 1,
    unlockDay,
    monsterGroup: index,
    map,
    backgroundPath: `Assets/Art/Models/MiniGame022/prefab/MiniGame022_${map}.prefab`,
    ...(endless ? { endless: true } : {}),
  };
}

export const STAGES: readonly StageDefinition[] = [
  stage(1, 0, 0, 'map1'),
  stage(2, 78000001, 0, 'map2'),
  stage(3, 78000002, 1, 'map3'),
  stage(4, 78000003, 1, 'map3'),
  stage(5, 78000004, 2, 'map3'),
  stage(6, 78000005, 2, 'map3'),
  stage(7, 78000006, 3, 'map3'),
  stage(8, 78000007, 3, 'map3'),
  stage(9, 78000008, 4, 'map3'),
  stage(10, 78000009, 4, 'map3'),
  stage(11, 78000010, 5, 'map3'),
  stage(12, 78000011, 5, 'map3'),
  stage(13, 78000012, 6, 'map3'),
  stage(14, 78000013, 6, 'map3'),
  stage(15, 78000014, 7, 'map3'),
  stage(16, 78000015, 7, 'map3'),
  stage(17, 78000016, 8, 'map3'),
  stage(18, 78000017, 8, 'map3'),
  stage(19, 78000018, 9, 'map3'),
  stage(20, 78000019, 9, 'map3'),
  stage(21, 78000020, 10, 'map3', true),
];

export function getStage(stageId: number): StageDefinition {
  const stage = STAGES.find((candidate) => candidate.id === stageId);
  if (!stage) throw new RangeError(`Unknown stage: ${stageId}`);
  return stage;
}

export function isStageUnlocked(
  stage: StageDefinition,
  clearedStageIds: readonly number[],
  nowSeconds: number,
): boolean {
  const timeReached = nowSeconds >= ACTIVITY_START_STAMP + stage.unlockDay * DAY_SECONDS;
  return timeReached && (stage.pre === 0 || clearedStageIds.includes(stage.pre));
}

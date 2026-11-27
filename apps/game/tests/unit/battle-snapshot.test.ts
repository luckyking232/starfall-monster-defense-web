import { expect, test } from 'vitest';
import { decodeBattleSnapshot } from '../../runtime/ui/battle-snapshot';

test('expands compact Lua snapshot records back to the existing Worker world event', () => {
  const sprite = ['assets/character.prefab', 2, 3, 4, -1, 1, 1, 'attack', 0.25, 5, false, 0.3, 7];
  const bullet = ['assets/bullet.prefab', 5, 6, 0, 1, 1, 1, false, 0, 5, [0, 1, 0], 0.1, 8];
  const wire = [1100, 78000018, 8, 139, 5, 410, 53, 60, 2, false,
    [[1, 78000101, 14, 15, 0, 0, 'Attack', true, sprite], [2, 78000222, 100, 100, 0, 1, 'Move', false, false]],
    false, [bullet], []];
  const state = decodeBattleSnapshot(JSON.stringify(wire));
  expect(state).toEqual({ fixedFrame: 1100, stageId: 78000018, curMonsterWave: 8, killEnemyCount: 139,
    curLevel: 5, curExp: 410, selfHp: 53, selfMaxHp: 60, speedIndex: 2, paused: false,
    elapsedMs: 0, terminal: null, choice: null,
    units: [{ uid: 1, cardId: 78000101, x: 14, y: 15, z: 0, camp: 0, stateName: 'Attack', flipped: true,
      model: { path:'assets/character.prefab', position:{x:2,y:3,z:4}, scale:{x:-1,y:1,z:1}, clip:'attack',
        time:0.25, order:5, age:0.3, instance:7 } },
    { uid: 2, cardId: 78000222, x: 100, y: 100, z: 0, camp: 1, stateName: 'Move', flipped: false }],
    bullets: [{ path:'assets/bullet.prefab', position:{x:5,y:6,z:0}, scale:{x:1,y:1,z:1}, right:{x:0,y:1,z:0},
      time:0, order:5, age:0.1, instance:8 }], effects: [] });
  expect(decodeBattleSnapshot('null')).toBeNull();
});

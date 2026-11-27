import { expect, it } from 'vitest';
import { buildStageAssets } from '../../scripts/build-stage-assets';
import { STAGES } from '../../src/content/stages';

it('derives maps, wave enemies, boss summons and character effects from original stage tables', async () => {
  const stages = await buildStageAssets();
  expect(Object.keys(stages).map(Number)).toEqual(STAGES.map(stage => stage.id));
  const names = (stage: number) => stages[stage]!.map(path => path.split('/').at(-1));
  const first = names(78000001);
  expect(first).toEqual(expect.arrayContaining([
    'minigame022_map1.prefab', 'minigamespine_zhalan_pixel.prefab', 'minigamespine_20302_pixel.prefab',
    'minigame022_10000134_skill2_summon.prefab', 'minigame022_20010_skill1_bullet.prefab',
    'minigame022_monster_appear.prefab',
  ]));
  for (const unrelated of ['minigame022_map2.prefab', 'minigame022_map3.prefab', 'minigamespine_20108_pixel.prefab',
    'minigame022_10000198_skill3_heal.prefab']) expect(first).not.toContain(unrelated);
  expect(names(78000005)).toEqual(expect.arrayContaining([
    'minigamespine_20411_pixel.prefab', 'minigamespine_20306_pixel.prefab',
    'minigame022_20411_skill1_bullet.prefab',
  ]));
  expect(names(78000018)).toEqual(expect.arrayContaining([
    'minigame022_map3.prefab', 'minigamespine_20108_pixel.prefab', 'minigame022_20108_skill1_bullet.prefab',
    'minigame022_10000104_skill3_summon.prefab', 'minigame022_10000101_skill3_summon.prefab',
    'minigame022_10000198_skill3_heal.prefab',
  ]));
});

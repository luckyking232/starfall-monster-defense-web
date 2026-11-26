import { describe, expect, it } from 'vitest';
import { unitFrameKeys } from '../../src/presentation/frames';

describe('unitFrameKeys', () => {
  it('accepts the single-frame wall sprite without a numeric suffix', () => {
    expect(unitFrameKeys(
      'Assets/Art/Models/MiniGame022/prefab/minigamespine_zhalan_pixel.prefab',
      ['units/minigamespine_zhalan_pixel.png'],
    )).toEqual(['units/minigamespine_zhalan_pixel.png']);
  });

  it('maps the original 20302 prefab name to its actual exported frame names', () => {
    expect(unitFrameKeys(
      'Assets/Art/Models/MiniGame022/prefab/minigamespine_20302_pixel.prefab',
      ['units/battlespine_20302_pixel_1.png', 'units/battlespine_20302_pixel_0.png'],
    )).toEqual(['units/battlespine_20302_pixel_0.png', 'units/battlespine_20302_pixel_1.png']);
  });

  it('resolves the same prefab/export prefix difference for 20010', () => {
    expect(unitFrameKeys(
      'Assets/Art/Models/MiniGame022/prefab/minigamespine_20010_pixel.prefab',
      ['units/battlespine_20010_pixel_0.png', 'units/battlespine_20010_pixel_1.png'],
    )).toEqual(['units/battlespine_20010_pixel_0.png', 'units/battlespine_20010_pixel_1.png']);
  });
});

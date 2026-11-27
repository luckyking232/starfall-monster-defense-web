import {expect,it} from 'vitest';
import {rotateFrame} from '../../src/platform/viewport';
it('manual portrait rotation is explicit and normal landscape always stays upright', () => {
  expect(rotateFrame(true,false)).toBe(false);
  expect(rotateFrame(true,true)).toBe(true);
  expect(rotateFrame(false,true)).toBe(false);
});

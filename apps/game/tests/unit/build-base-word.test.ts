import { expect, it } from 'vitest';
import { buildBaseWord } from '../../scripts/build-base-word';

const source = 'BaseWord_cn = {\n  [1] = {id = 1, name = "得分：%s%%"},\n  [2] = {id = 2, sub_name = "其余"}\n}\n';

it('keeps known rows verbatim, including placeholder escapes and original missing keys', () => {
  expect(buildBaseWord(source, ["local a = T( 1 , '50'); local b = T(99)"])).toEqual({
    payload: 'BaseWord_cn = {\n  [1] = {id = 1, name = "得分：%s%%"},\n}\n',
    mode: 'literal-closure', rows: 1, missing: [99],
  });
});

it('keeps the full table whenever Lua uses a computed key, alias, or direct table access', () => {
  for (const pattern of ['return T(obj.id)', 'local translate = T', 'return BaseWord_cn[1]', '_G["T"](id)']) {
    expect(buildBaseWord(source, [pattern])).toEqual({ payload: source, mode: 'full', rows: 2, missing: [] });
  }
});

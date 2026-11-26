import { expect, test } from 'vitest';
import { readPreferences, savePreferences } from '../../src/platform/preferences';

test('旧默认音量调整为20，其他旧音量与新版自选40保留', () => {
  const items = new Map<string,string>();
  const storage = { getItem:(key:string) => items.get(key) ?? null, setItem:(key:string,value:string) => { items.set(key,value); } };
  const legacy = {music:55, effects:40, fps:true};
  storage.setItem('starfall.monster-defense.settings/1',JSON.stringify(legacy));
  expect(readPreferences(storage)).toEqual({...legacy,effects:20});
  storage.setItem('starfall.monster-defense.settings/1',JSON.stringify({...legacy,effects:26}));
  expect(readPreferences(storage).effects).toBe(26);
  savePreferences(storage,legacy);
  expect(readPreferences(storage)).toEqual(legacy);
});

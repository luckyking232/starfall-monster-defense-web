import { expect, test } from 'vitest';
import { readPreferences, savePreferences } from '../../src/platform/preferences';

test('首次默认最大推荐增益，旧设置按实际声音增益迁移', () => {
  const items = new Map<string,string>();
  const storage = { getItem:(key:string) => items.get(key) ?? null, setItem:(key:string,value:string) => { items.set(key,value); } };
  const legacy = {music:55, effects:40, fps:true};
  expect(readPreferences(storage)).toEqual({music:100,effects:100,fps:false,economy:false});
  storage.setItem('starfall.monster-defense.settings/1',JSON.stringify(legacy));
  expect(readPreferences(storage)).toEqual({...legacy,effects:100,economy:false});
  storage.setItem('starfall.monster-defense.settings/2',JSON.stringify({...legacy,effects:6}));
  expect(readPreferences(storage)).toEqual({...legacy,effects:60,economy:false});
  storage.setItem('starfall.monster-defense.settings/2',JSON.stringify({...legacy,music:0,effects:0}));
  expect(readPreferences(storage)).toEqual({...legacy,music:0,effects:0,economy:false});
  savePreferences(storage,{...legacy,economy:true});
  expect(readPreferences(storage)).toEqual({...legacy,economy:true});
});

import { expect, it } from 'vitest';
import { ProgressStore, SLOT_INDEX_KEY } from '../../src/platform/progress';
import { scopedStorage, localEventKey } from '../../src/platform/channel';
import { exportSaves, importSaves } from '../../src/platform/save-transfer';

function memory(): Storage {
  const data = new Map<string,string>();
  return { get length() { return data.size; }, key: i => [...data.keys()][i] ?? null,
    getItem: key => data.get(key) ?? null, setItem: (key,value) => { data.set(key,value); },
    removeItem: key => { data.delete(key); }, clear: () => data.clear() };
}
it('keeps the old site readable and isolates test progress and storage events', () => {
  const original = memory(), prod = new ProgressStore(original);
  prod.commitClear(78000001);
  const testStorage = scopedStorage(original,true), test = new ProgressStore(testStorage);
  expect(test.load().clearedStageIds).toEqual([]);
  test.unlockAll();
  expect(prod.load().allUnlocked).toBe(false);
  expect(testStorage.length).toBe(1);
  expect(localEventKey(original.key(0),true)).toBeUndefined();
  expect(localEventKey(original.key(1),true)).toBe(testStorage.key(0));
  expect(localEventKey(null,true)).toBeNull();
});
it('restores multiple slots and the active choice into fresh slots alongside existing saves', () => {
  const old = memory(), oldStore = new ProgressStore(old);
  oldStore.commitClear(78000001);
  const id = oldStore.createSlot('云岚');
  oldStore.commitClear(78000002,id,'assisted');
  oldStore.unlockAll(id);
  oldStore.commitEndless({version:1,runId:'first',source:'natural',kills:573,wave:4,settledAt:1,endedBy:'exit'},id);
  const next = memory(), store = new ProgressStore(next);
  store.renameSlot('default','已有存档');
  importSaves(next,exportSaves(oldStore));
  const index = store.listSlots();
  expect(index.slots.map(s => s.name)).toEqual(['已有存档','默认存档','云岚']);
  expect(index.activeSlotId).toBe(index.slots[2]!.id);
  expect(store.load(index.slots[1]!.id).clearedStageIds).toEqual([78000001]);
  expect(store.load()).toMatchObject({assistedStageIds:[78000002],allUnlocked:true});
  expect(store.loadEndless().natural?.kills).toBe(573);
  expect(store.load('default').clearedStageIds).toEqual([]);
});
it('never publishes a partial import after quota failure or malformed input', () => {
  const source = new ProgressStore(memory()); source.commitClear(78000001);
  const storage = memory(), json = exportSaves(source);
  expect(() => importSaves(storage,json.replace('78000001','78000021'))).toThrow();
  const write = storage.setItem;
  storage.setItem = (k,v) => { if (k === SLOT_INDEX_KEY) throw Error('quota'); write(k,v); };
  expect(() => importSaves(storage,json)).toThrow();
  expect(storage.length).toBe(0);
});
it('preserves a tab that creates a slot while new import markers are being prepared', () => {
  const source = new ProgressStore(memory());
  source.commitClear(78000001);
  const destination = memory();
  const write = destination.setItem;
  let other = '';
  destination.setItem = (key,value) => {
    write(key,value);
    if (key.endsWith('/clear/78000001')) other = new ProgressStore(destination).createSlot('另一个标签页');
  };
  importSaves(destination,exportSaves(source));
  expect(new ProgressStore(destination).listSlots().slots.map(slot => slot.id)).toContain(other);
});

import { describe, expect, it } from 'vitest';
import { ProgressStore, type EndlessRecord } from '../../src/platform/progress';
import { MemoryStorage } from '../support/memory-storage';

describe('ProgressStore', () => {
  it('starts empty and commits a natural clear exactly once', () => {
    const storage = new MemoryStorage();
    const store = new ProgressStore(storage);
    expect(store.load().clearedStageIds).toEqual([]);
    store.commitClear(78000001);
    store.commitClear(78000001);
    expect(store.load().clearedStageIds).toEqual([78000001]);
    expect(storage.values.size).toBe(1);
  });

  it('isolates a malformed stage record instead of erasing valid progress', () => {
    const storage = new MemoryStorage();
    const store = new ProgressStore(storage);
    store.commitClear(78000001);
    storage.setItem('starfall.monster-defense.progress/1/78000002', '{broken');
    expect(store.load()).toMatchObject({ clearedStageIds: [78000001], unreadable: true });
  });

  it('leaves invalid legacy bytes alone and can save the stage through the new store', () => {
    const storage = new MemoryStorage();
    storage.setItem('starfall.monster-defense.progress/1/78000001', 'null');
    const store = new ProgressStore(storage);
    store.commitClear(78000001);
    expect(new ProgressStore(storage).load()).toMatchObject({ clearedStageIds: [78000001], unreadable: true });
    expect(storage.getItem('starfall.monster-defense.progress/1/78000001')).toBe('null');
  });

  it('falls back to session-only behavior when storage is blocked', () => {
    const store = new ProgressStore(null);
    expect(store.load().persistent).toBe(false);
    expect(() => store.commitClear(78000001)).not.toThrow();
    expect(store.load().persistent).toBe(false);
  });

  it('imports legacy clears into the default slot and keeps named slots independent', () => {
    const storage = new MemoryStorage();
    const schema = 'starfall.monster-defense.progress/1';
    storage.setItem(`${schema}/78000001`, JSON.stringify({ schema, stageId: 78000001, settlement: 'confirmed_natural_win' }));
    const store = new ProgressStore(storage);
    const defaultId = store.listSlots().activeSlotId;
    expect(store.load().clearedStageIds).toEqual([78000001]);

    const slotId = store.createSlot('  进阶  ');
    expect(store.listSlots()).toMatchObject({ activeSlotId: slotId, slots: [{ id: defaultId }, { id: slotId, name: '进阶' }] });
    expect(store.load().clearedStageIds).toEqual([]);
    store.unlockAll();
    store.commitClear(78000009);
    store.renameSlot(slotId, '练习');
    const reopened = new ProgressStore(storage);
    expect(reopened.listSlots().slots).toContainEqual({ id: slotId, name: '练习' });
    expect(reopened.load()).toMatchObject({ clearedStageIds: [78000009], allUnlocked: true });

    reopened.switchSlot(defaultId);
    expect(reopened.load()).toMatchObject({ clearedStageIds: [78000001], allUnlocked: false });
    reopened.deleteSlot(defaultId);
    expect(reopened.listSlots().activeSlotId).toBe(slotId);
    reopened.deleteSlot(slotId);
    const replacement = reopened.listSlots();
    expect(replacement.slots).toHaveLength(1);
    expect(replacement.activeSlotId).not.toBe(slotId);
    expect(reopened.load()).toMatchObject({clearedStageIds:[], allUnlocked:false});
    const newSlot = reopened.createSlot('另外一个档');
    expect(reopened.listSlots().activeSlotId).toBe(newSlot);
    expect(reopened.load()).toMatchObject({ clearedStageIds: [], allUnlocked: false });
  });

  it('recognizes a confirmed clear from the previous playable build at the same mount', () => {
    const storage = new MemoryStorage();
    const mount = 'https://game.test/play/';
    const release = '134377281279792758-r6-local-clearance-1';
    const schema = 'starfall.offline-cleared-stage/1';
    const marker = JSON.stringify({ schema, release, game: 70441022, activity: 70060517,
      stageId: 78000001, settlement: 'confirmed_natural_win' });
    storage.setItem(`starfall-monster-defense:${release}:${mount}:78000001`, marker);
    expect(new ProgressStore(storage, mount).load().clearedStageIds).toEqual([78000001]);
    expect(new ProgressStore(storage, 'https://game.test/another-game/').load().clearedStageIds).toEqual([]);
  });

  it('keeps independent clears from two clients and binds an in-flight clear to its starting slot', () => {
    const storage = new MemoryStorage();
    const first = new ProgressStore(storage);
    const second = new ProgressStore(storage);
    const firstSlot = first.listSlots().activeSlotId;
    const secondSlot = second.createSlot('另一档');
    first.commitClear(78000001, firstSlot);
    second.commitClear(78000002, firstSlot);
    expect(first.load(firstSlot).clearedStageIds).toEqual([78000001, 78000002]);
    expect(second.load(secondSlot).clearedStageIds).toEqual([]);
    first.unlockAll(firstSlot);
    expect(first.load(firstSlot).allUnlocked).toBe(true);
    expect(second.load(secondSlot).allUnlocked).toBe(false);
    second.deleteSlot(firstSlot);
    expect(() => first.unlockAll(firstSlot)).toThrow();
    expect(first.commitClear(78000003, firstSlot).persistent).toBe(false);
    expect(second.load().clearedStageIds).toEqual([]);
  });

  it('reports a write denial even while reads work, and can retry a clear', () => {
    const storage = new MemoryStorage();
    const setItem = storage.setItem.bind(storage);
    storage.setItem = () => { throw new Error('quota'); };
    const store = new ProgressStore(storage);
    expect(store.commitClear(78000001)).toMatchObject({ clearedStageIds: [78000001], persistent: false });
    expect(new ProgressStore(storage).load().clearedStageIds).toEqual([]);
    expect(() => store.createSlot('新档')).toThrow();
    storage.setItem = setItem;
    expect(store.commitClear(78000001).persistent).toBe(true);
    expect(new ProgressStore(storage).load().clearedStageIds).toEqual([78000001]);
  });

  it('keeps level-assisted victories in the same slot without calling them natural clears', () => {
    const storage = new MemoryStorage();
    const store = new ProgressStore(storage);
    store.commitClear(78000001);
    store.commitClear(78000002, undefined, 'assisted');
    let reopened = new ProgressStore(storage);
    expect(reopened.load()).toMatchObject({ clearedStageIds: [78000001], assistedStageIds: [78000002] });
    reopened.commitClear(78000002);
    store.commitClear(78000002, undefined, 'assisted');
    reopened = new ProgressStore(storage);
    expect(reopened.load()).toMatchObject({ clearedStageIds: [78000001, 78000002], assistedStageIds: [] });
  });

  function score(overrides: Partial<EndlessRecord> = {}): EndlessRecord {
    return { version: 1, runId: 'run-1', source: 'natural', kills: 15, wave: 2,
      endedBy: 'natural', settledAt: 1000, ...overrides };
  }

  it('retains the strongest score in each category and ignores repeat and tied submissions', () => {
    const storage = new MemoryStorage();
    const store = new ProgressStore(storage);
    expect(store.loadEndless()).toMatchObject({ natural: null, practice: null });
    store.unlockAll();
    expect(store.commitEndless(score()).newRecord).toBe(true);
    expect(store.commitEndless(score({ kills: 99 })).newRecord).toBe(false);
    expect(store.commitEndless(score({ runId: 'run-2', kills: 14, wave: 20 })).newRecord).toBe(false);
    expect(store.commitEndless(score({ runId: 'run-3', wave: 3 })).newRecord).toBe(true);
    expect(store.commitEndless(score({ runId: 'run-4', wave: 3, endedBy: 'exit' })).newRecord).toBe(false);
    store.commitEndless(score({ runId: 'run-5', source: 'practice', kills: 200, endedBy: 'exit' }));
    expect(new ProgressStore(storage).loadEndless()).toMatchObject({
      natural: { runId: 'run-3', kills: 15, wave: 3, endedBy: 'natural' },
      practice: { runId: 'run-5', kills: 200, endedBy: 'exit' },
      persistent: true,
    });
    expect([...storage.values.keys()].filter(key => key.includes('/endless/'))).toHaveLength(2);
  });

  it('keeps the better result when another tab commits after the first tab compares scores', () => {
    const storage = new MemoryStorage();
    const first = new ProgressStore(storage);
    const second = new ProgressStore(storage);
    const setItem = storage.setItem.bind(storage);
    storage.setItem = (key, value) => {
      storage.setItem = setItem;
      second.commitEndless(score({ runId: 'fast-tab', kills: 30 }));
      setItem(key, value);
    };
    first.commitEndless(score({ runId: 'slow-tab', kills: 20 }));
    expect(first.loadEndless().natural?.kills).toBe(30);
  });

  it('retries a denied record and never restores a slot deleted by another tab', () => {
    const storage = new MemoryStorage();
    const first = new ProgressStore(storage);
    const second = new ProgressStore(storage);
    const startingSlot = first.listSlots().activeSlotId;
    const nextSlot = second.createSlot('空槽');
    const setItem = storage.setItem.bind(storage);
    storage.setItem = () => { throw new Error('quota'); };
    expect(first.commitEndless(score(), startingSlot)).toMatchObject({ persistent: false, newRecord: true });
    expect(new ProgressStore(storage).loadEndless(startingSlot).natural).toBeNull();
    storage.setItem = setItem;
    expect(first.commitEndless(score(), startingSlot)).toMatchObject({ persistent: true, newRecord: false });
    expect(second.loadEndless(startingSlot).natural?.kills).toBe(15);
    expect(second.loadEndless(nextSlot).natural).toBeNull();
    second.deleteSlot(startingSlot);
    first.commitEndless(score({ runId: 'stale-run', kills: 100 }), startingSlot);
    expect(first.loadEndless(startingSlot)).toMatchObject({ natural: null, persistent: false });
    expect([...storage.values.keys()].filter(key => key.includes('/endless/'))).toHaveLength(0);
  });
});

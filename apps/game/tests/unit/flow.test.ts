import { describe, expect, it } from 'vitest';
import { GameFlow } from '../../src/app/flow';
import { MemoryStorage } from '../support/memory-storage';
import { ProgressStore } from '../../src/platform/progress';

function createFlow() {
  return new GameFlow(new ProgressStore(new MemoryStorage()));
}

describe('GameFlow', () => {
  it('always opens on the start screen and enters the chooser only after Start', () => {
    const flow = createFlow();
    expect(flow.snapshot.phase).toBe('loading');
    flow.finishLoading();
    expect(flow.snapshot.phase).toBe('home');
    flow.startGame();
    expect(flow.snapshot.phase).toBe('chooser');
  });

  it('rejects locked stages and never treats a previous unfinished run as resumable', () => {
    const flow = createFlow();
    flow.finishLoading();
    flow.startGame();
    expect(() => flow.selectStage(78000002)).toThrow('Stage is locked');
    flow.selectStage(78000001);
    expect(flow.snapshot).toMatchObject({ phase: 'stage-loading', stageId: 78000001 });
    flow.battleReady();
    expect(flow.snapshot).toMatchObject({ phase: 'battle', stageId: 78000001 });
    flow.leaveToChooser();
    expect(flow.snapshot).toMatchObject({ phase: 'chooser', stageId: null });
  });

  it('restores completed progress without restoring a battle', () => {
    const storage = new MemoryStorage();
    const progress = new ProgressStore(storage);
    progress.commitClear(78000001);
    const flow = new GameFlow(progress);
    flow.finishLoading();
    flow.startGame();
    expect(flow.snapshot.phase).toBe('chooser');
    expect(flow.snapshot.clearedStageIds).toEqual([78000001]);
    expect(flow.snapshot.unlockedStageIds).toContain(78000002);
  });
});

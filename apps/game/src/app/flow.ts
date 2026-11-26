import { isStageUnlocked, STAGES } from '../content/stages';
import type { ProgressStore } from '../platform/progress';

export type FlowPhase = 'loading' | 'home' | 'chooser' | 'stage-loading' | 'battle';

export interface FlowSnapshot {
  phase: FlowPhase;
  stageId: number | null;
  clearedStageIds: number[];
  unlockedStageIds: number[];
  progressUnreadable: boolean;
  progressPersistent: boolean;
}

export class GameFlow {
  private phase: FlowPhase = 'loading';
  private stageId: number | null = null;

  constructor(private readonly progress: ProgressStore) {}

  get snapshot(): FlowSnapshot {
    const progress = this.progress.load();
    const now = Math.floor(Date.now() / 1000);
    return {
      phase: this.phase,
      stageId: this.stageId,
      clearedStageIds: progress.clearedStageIds,
      unlockedStageIds: STAGES.filter((stage) => isStageUnlocked(stage, progress.clearedStageIds, now)).map((stage) => stage.id),
      progressUnreadable: progress.unreadable,
      progressPersistent: progress.persistent,
    };
  }

  finishLoading(): void {
    if (this.phase !== 'loading') throw new Error('Loading has already finished');
    this.phase = 'home';
  }

  startGame(): void {
    if (this.phase !== 'home') throw new Error('Start is only available on the home screen');
    this.phase = 'chooser';
  }

  selectStage(stageId: number): void {
    if (this.phase !== 'chooser') throw new Error('A stage can only be selected from the chooser');
    if (!this.snapshot.unlockedStageIds.includes(stageId)) throw new Error('Stage is locked');
    this.stageId = stageId;
    this.phase = 'stage-loading';
  }

  battleReady(): void {
    if (this.phase !== 'stage-loading') throw new Error('Battle can only start from the loading screen');
    this.phase = 'battle';
  }

  leaveToChooser(): void {
    this.stageId = null;
    this.phase = 'chooser';
  }
}

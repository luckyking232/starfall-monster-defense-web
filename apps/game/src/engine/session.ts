import { createFixedClock } from './clock';
import type { RuleReply, RngInput } from './protocol';

export interface RuleDriver {
  start(stageId: number, rng: RngInput): Promise<RuleReply>;
  stepFixed(count: number): Promise<RuleReply>;
  advanceUnscaled(ms: number): Promise<RuleReply>;
  speed(index: 1 | 2): Promise<RuleReply>;
  pause(): Promise<RuleReply>;
  resume(): Promise<RuleReply>;
  select(windowId: number, generation: number, skillId: number, confirm: boolean): Promise<RuleReply>;
  close(): Promise<void>;
}

export type BattlePhase = 'loading' | 'running' | 'choice' | 'paused' | 'settled' | 'closed' | 'error';

export interface BattleSnapshot {
  phase: BattlePhase;
  reply: RuleReply | null;
  backgrounded: boolean;
  resumeRequired: boolean;
  selecting: boolean;
  error: Error | null;
}

export class BattleSession {
  private readonly clock = createFixedClock();
  private readonly operations: Promise<void> = Promise.resolve();
  private queue = this.operations;
  private advancing: Promise<void> | null = null;
  private pendingMs = 0;
  private phase: BattlePhase = 'loading';
  private reply: RuleReply | null = null;
  private started = false;
  private closed = false;
  private backgrounded = false;
  private resumeRequired = false;
  private pauseRequested = false;
  private selecting = false;
  private error: Error | null = null;

  constructor(
    private readonly client: RuleDriver,
    private readonly stageId: number,
    private readonly rng: () => RngInput,
  ) {}

  get snapshot(): BattleSnapshot {
    return {
      phase: this.phase,
      reply: this.reply,
      backgrounded: this.backgrounded,
      resumeRequired: this.resumeRequired,
      selecting: this.selecting,
      error: this.error,
    };
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private accept(reply: RuleReply): void {
    if (this.closed) return;
    this.reply = reply;
    if (reply.state.terminal) this.phase = 'settled';
    else if (reply.state.choice) {
      this.pauseRequested = false;
      this.phase = 'choice';
    }
    else if (this.pauseRequested) this.phase = 'paused';
    else this.phase = 'running';
  }

  private fail(error: unknown): void {
    this.error = error instanceof Error ? error : new Error(String(error));
    this.phase = 'error';
    this.pendingMs = 0;
    this.clock.reset();
  }

  async start(): Promise<void> {
    if (this.started || this.closed) throw new Error('对局已经启动');
    this.started = true;
    try {
      await this.enqueue(async () => {
        this.accept(await this.client.start(this.stageId, this.rng()));
      });
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  async advance(deltaMs: number): Promise<void> {
    if (this.closed || this.backgrounded || this.phase === 'error') return;
    if (this.phase === 'choice') {
      if (this.selecting || this.resumeRequired) return;
      const ms = Math.min(Math.max(0, Math.floor(deltaMs)), 1000);
      if (!ms) return;
      try {
        await this.enqueue(async () => {
          if (this.phase === 'choice' && !this.backgrounded && !this.resumeRequired && !this.selecting) {
            this.accept(await this.client.advanceUnscaled(ms));
          }
        });
      } catch (error) {
        this.fail(error);
      }
      return;
    }
    if (this.phase !== 'running') return;
    this.pendingMs += Math.min(Math.max(0, deltaMs), 250);
    this.advancing ??= Promise.resolve().then(() => this.drain());
    await this.advancing;
  }

  private async drain(): Promise<void> {
    try {
      while (this.phase === 'running' && !this.backgrounded && !this.closed) {
        const speed = this.reply?.state.speedIndex === 2 ? 2 : 1;
        const steps = this.clock.advance(this.pendingMs, speed);
        this.pendingMs = 0;
        if (!steps) break;
        await this.enqueue(async () => {
          if (this.phase === 'running' && !this.backgrounded && !this.closed) {
            this.accept(await this.client.stepFixed(steps));
          }
        });
      }
    } catch (error) {
      this.fail(error);
    } finally {
      this.advancing = null;
    }
  }

  async idle(): Promise<void> {
    await this.queue;
    await this.advancing;
  }

  async speed(index: 1 | 2): Promise<void> {
    if (this.phase !== 'running' || this.backgrounded) throw new Error('当前不能调整速度');
    try {
      await this.enqueue(async () => {
        if (this.phase === 'running' && !this.backgrounded) this.accept(await this.client.speed(index));
      });
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  async pause(): Promise<void> {
    if (this.phase !== 'running') return;
    this.pauseRequested = true;
    this.phase = 'paused';
    this.pendingMs = 0;
    this.clock.reset();
    try {
      await this.enqueue(async () => {
        if (this.phase === 'paused' && this.pauseRequested && !this.closed) this.accept(await this.client.pause());
      });
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  async resume(): Promise<void> {
    if (this.backgrounded) return;
    this.resumeRequired = false;
    this.clock.reset();
    if (this.phase === 'choice') return;
    if (this.phase !== 'paused') return;
    this.pauseRequested = false;
    try {
      await this.enqueue(async () => {
        if (this.phase === 'paused' && !this.backgrounded) this.accept(await this.client.resume());
      });
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  async background(): Promise<void> {
    if (this.closed) return;
    this.backgrounded = true;
    this.resumeRequired = true;
    this.pendingMs = 0;
    this.clock.reset();
    if (this.phase === 'running') await this.pause();
    else await this.idle();
  }

  async foreground(): Promise<void> {
    this.backgrounded = false;
    this.pendingMs = 0;
    this.clock.reset();
    await this.idle();
  }

  async select(skillId: number, confirm: boolean): Promise<void> {
    const choice = this.reply?.state.choice;
    if (this.phase !== 'choice' || !choice) throw new Error('当前没有可选技能');
    if (this.selecting) throw new Error('选择正在提交');
    if (this.backgrounded || this.resumeRequired || !choice.touchable) throw new Error('技能暂时不可选择');
    const index = choice.offerIds.indexOf(skillId);
    if (index < 0) throw new Error('技能不在本次候选中');
    if (!choice.visible[index]) throw new Error('技能尚未揭示');
    this.selecting = true;
    try {
      await this.enqueue(async () => {
        this.accept(await this.client.select(choice.windowId, choice.generation, skillId, confirm));
      });
    } catch (error) {
      this.fail(error);
      throw error;
    } finally {
      this.selecting = false;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.phase = 'closed';
    this.pendingMs = 0;
    this.clock.reset();
    await this.idle();
    if (this.started) await this.enqueue(() => this.client.close());
  }
}

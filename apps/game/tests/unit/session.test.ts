import { describe, expect, it } from 'vitest';
import type { RuleReply, RuleState, RngInput } from '../../src/engine/protocol';
import { BattleSession, type RuleDriver } from '../../src/engine/session';

const rng: RngInput = { tape: Array(50).fill(5000), globalRngSeeds: [70441022, 78000001] };

function state(patch: Partial<RuleState> = {}): RuleState {
  return {
    fixedFrame: 0,
    stageId: 78000001,
    curMonsterWave: 0,
    killEnemyCount: 0,
    curLevel: 0,
    curExp: 0,
    selfHp: 5000,
    selfMaxHp: 5000,
    speedIndex: 1,
    elapsedMs: 0,
    paused: false,
    terminal: null,
    choice: null,
    units: [],
    ...patch,
  };
}

function reply(patch: Partial<RuleState> = {}): RuleReply {
  return { state: state(patch), events: [], advancedFixed: 0 };
}

class FakeRules implements RuleDriver {
  current = reply();
  readonly calls: string[] = [];
  onSelect?: (windowId: number, generation: number, skillId: number, confirm: boolean) => Promise<RuleReply>;
  onStep?: (count: number) => Promise<RuleReply>;
  onClock?: (ms: number) => Promise<RuleReply>;

  async start(stageId: number, input: RngInput): Promise<RuleReply> {
    this.calls.push(`start:${stageId}:${input.tape[0]}`);
    return this.current;
  }
  async stepFixed(count: number): Promise<RuleReply> {
    this.calls.push(`step:${count}`);
    if (this.onStep) return this.onStep(count);
    this.current = reply({ fixedFrame: this.current.state.fixedFrame + count });
    return this.current;
  }
  async advanceUnscaled(ms: number): Promise<RuleReply> {
    this.calls.push(`clock:${ms}`);
    if (this.onClock) return this.onClock(ms);
    if (this.current.state.choice) {
      this.current = reply({
        ...this.current.state,
        choice: { ...this.current.state.choice, remainingMs: Math.max(0, this.current.state.choice.remainingMs - ms) },
      });
    }
    return this.current;
  }
  async speed(index: 1 | 2): Promise<RuleReply> {
    this.calls.push(`speed:${index}`);
    this.current = reply({ ...this.current.state, speedIndex: index });
    return this.current;
  }
  async pause(): Promise<RuleReply> {
    this.calls.push('pause');
    this.current = reply({ ...this.current.state, paused: true });
    return this.current;
  }
  async resume(): Promise<RuleReply> {
    this.calls.push('resume');
    this.current = reply({ ...this.current.state, paused: false });
    return this.current;
  }
  async select(windowId: number, generation: number, skillId: number, confirm: boolean): Promise<RuleReply> {
    this.calls.push(`select:${windowId}:${generation}:${skillId}:${confirm}`);
    if (this.onSelect) return this.onSelect(windowId, generation, skillId, confirm);
    this.current = reply({ fixedFrame: this.current.state.fixedFrame });
    return this.current;
  }
  async close(): Promise<void> { this.calls.push('close'); }
}

function choice(): RuleReply {
  return reply({
    fixedFrame: 344,
    paused: true,
    curLevel: 1,
    choice: {
      windowId: 1,
      generation: 1,
      level: 1,
      remainingMs: 30000,
      touchable: true,
      offerIds: [78010111, 78010211, 78000101],
      visible: [true, true, true],
    },
  });
}

describe('BattleSession', () => {
  it('advances the original rules at the selected fixed rate', async () => {
    const client = new FakeRules();
    const session = new BattleSession(client, 78000001, () => rng);
    await session.start();
    await session.speed(2);
    await session.advance(100);
    await session.idle();
    expect(session.snapshot.phase).toBe('running');
    expect(session.snapshot.reply!.state.fixedFrame).toBe(6);
    expect(client.calls).toEqual(['start:78000001:5000', 'speed:2', 'step:6']);
  });

  it('continues scheduling after render frames that contain no fixed step', async () => {
    const client = new FakeRules();
    const session = new BattleSession(client, 78000001, () => rng);
    await session.start();
    await session.advance(16);
    await session.advance(16);
    await session.advance(2);
    await session.idle();
    expect(session.snapshot.reply!.state.fixedFrame).toBe(1);
    expect(client.calls).toContain('step:1');
  });

  it('keeps the same run during a choice and rejects duplicate confirmation', async () => {
    const client = new FakeRules();
    client.current = choice();
    const session = new BattleSession(client, 78000001, () => rng);
    await session.start();
    let release!: () => void;
    client.onSelect = async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      return reply({ fixedFrame: 344 });
    };
    const selected = session.select(78010111, true);
    await expect(session.select(78010211, true)).rejects.toThrow('选择正在提交');
    expect(client.calls.filter((call) => call.startsWith('select'))).toHaveLength(1);
    release();
    await selected;
    expect(session.snapshot.phase).toBe('running');
    expect(client.calls.at(-1)).toBe('select:1:1:78010111:true');
  });

  it('uses original unscaled choice timing only while visible', async () => {
    const client = new FakeRules();
    client.current = choice();
    const session = new BattleSession(client, 78000001, () => rng);
    await session.start();
    await session.advance(1000);
    expect(session.snapshot.reply!.state.choice?.remainingMs).toBe(29000);
    await session.background();
    await session.advance(2000);
    await session.foreground();
    await session.advance(1000);
    expect(session.snapshot.reply!.state.choice?.remainingMs).toBe(29000);
    await session.resume();
    await session.advance(1000);
    expect(session.snapshot.reply!.state.choice?.remainingMs).toBe(28000);
    expect(client.calls).toEqual(['start:78000001:5000', 'clock:1000', 'clock:1000']);
  });

  it('keeps unscaled time running while a timed-out choice closes', async () => {
    const client = new FakeRules();
    const selection = choice().state;
    client.current = reply({ ...selection, choice: { ...selection.choice!, remainingMs: 1 } });
    let elapsedMs = 0;
    client.onClock = async (ms) => {
      elapsedMs += ms;
      if (elapsedMs >= 501) return reply({ fixedFrame: selection.fixedFrame, elapsedMs });
      return reply({
        ...selection,
        elapsedMs,
        choice: { ...selection.choice!, remainingMs: 0, touchable: false },
      });
    };
    const session = new BattleSession(client, 78000001, () => rng);
    await session.start();

    await session.advance(1);
    expect(session.snapshot.reply?.state.choice?.touchable).toBe(false);
    await expect(session.select(78010111, true)).rejects.toThrow('技能暂时不可选择');
    await session.advance(500);

    expect(session.snapshot.phase).toBe('running');
    expect(session.snapshot.reply?.state.fixedFrame).toBe(selection.fixedFrame);
    expect(client.calls).toEqual(['start:78000001:5000', 'clock:1', 'clock:500']);
  });

  it('pauses immediately in the background and requires a manual resume', async () => {
    const client = new FakeRules();
    const session = new BattleSession(client, 78000001, () => rng);
    await session.start();
    await session.background();
    await session.foreground();
    await session.advance(5000);
    await session.idle();
    expect(session.snapshot.phase).toBe('paused');
    expect(session.snapshot.reply!.state.fixedFrame).toBe(0);
    expect(client.calls).toEqual(['start:78000001:5000', 'pause']);
    await session.resume();
    await session.advance(100);
    await session.idle();
    expect(session.snapshot.reply!.state.fixedFrame).toBe(3);
    expect(client.calls.at(-1)).toBe('step:3');
  });

  it('does not advance or select after a terminal result or close', async () => {
    const client = new FakeRules();
    client.current = reply({ fixedFrame: 4181, killEnemyCount: 205, terminal: { win: true, loss: false, curMonsterWave: 2, killEnemyCount: 205 } });
    const session = new BattleSession(client, 78000001, () => rng);
    await session.start();
    await session.advance(100);
    expect(session.snapshot.phase).toBe('settled');
    await expect(session.select(78010111, true)).rejects.toThrow('当前没有可选技能');
    await session.close();
    await session.close();
    expect(client.calls).toEqual(['start:78000001:5000', 'close']);
  });

  it('keeps an upgrade that arrives at the same time as a pause request', async () => {
    const client = new FakeRules();
    let stepStarted!: () => void;
    const started = new Promise<void>((resolve) => { stepStarted = resolve; });
    client.onStep = async () => {
      stepStarted();
      return choice();
    };
    const session = new BattleSession(client, 78000001, () => rng);
    await session.start();
    const advancing = session.advance(100);
    await started;
    const pausing = session.pause();
    await Promise.all([advancing, pausing]);
    expect(session.snapshot.phase).toBe('choice');
    expect(client.calls).not.toContain('pause');
    await session.select(78010111, true);
    expect(session.snapshot.phase).toBe('running');
  });
});

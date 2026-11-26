import type { FguiTransition, FguiTransitionTrack, FguiTransitionValue } from './package';

export interface FguiTransitionCallbacks {
  scaled?: boolean;
  onLabel?: (label: string) => void;
  onComplete?: () => void;
}

interface TransitionEffects<Node> {
  child(owner: Node, track: FguiTransitionTrack): Node | undefined;
  definition(owner: Node, name: string): FguiTransition;
  position(node: Node): readonly [number, number];
  apply(owner: Node, target: Node, type: string, value: FguiTransitionValue, base: readonly [number, number]): void;
  tween(owner: Node, target: Node, track: FguiTransitionTrack, base: readonly [number, number]): (progress: number) => void;
}

interface Cue {
  time: number;
  apply(): void;
}

interface RunningTrack {
  sample(time: number): void;
}

export class FguiTransitionPlayback<Node> {
  private readonly cues: Cue[] = [];
  private readonly active = new Set<RunningTrack>();
  private position = 0;
  private cursor = 0;
  private stopped = false;

  get scaled(): boolean { return this.callbacks.scaled === true; }

  constructor(
    owner: Node,
    definition: FguiTransition,
    private readonly effects: TransitionEffects<Node>,
    private readonly callbacks: FguiTransitionCallbacks,
  ) {
    this.schedule(owner, definition, 0, callbacks.onLabel, []);
    this.cues.sort((left, right) => left.time - right.time);
  }

  advance(seconds: number): boolean {
    if (this.stopped) return true;
    const end = this.position + seconds;
    while (this.cursor < this.cues.length && this.cues[this.cursor]!.time <= end) {
      const cue = this.cues[this.cursor++]!;
      this.sample(cue.time);
      cue.apply();
      if (this.stopped) return true;
    }
    this.sample(end);
    if (this.cursor !== this.cues.length) return false;
    this.stop();
    this.callbacks.onComplete?.();
    return true;
  }

  stop(): void {
    this.stopped = true;
    this.active.clear();
  }

  private sample(time: number): void {
    this.position = time;
    for (const track of this.active) track.sample(time);
  }

  private schedule(
    owner: Node,
    definition: FguiTransition,
    offset: number,
    onLabel: FguiTransitionCallbacks['onLabel'],
    ancestors: readonly FguiTransition[],
  ): number {
    if (ancestors.includes(definition)) throw new Error(`FGUI 转场递归引用：${definition.name}`);
    let base: readonly [number, number] = [0, 0];
    this.cues.push({ time: offset, apply: () => { base = this.effects.position(owner); } });
    let end = offset;
    for (const track of definition.items) {
      const target = track.targetIndex === -1 ? owner : this.effects.child(owner, track);
      if (target === undefined) continue;
      const time = offset + track.time;
      const startLabel = track.label;
      end = Math.max(end, time);
      if (track.type === 'Transition') {
        const { transitionName, playTimes = 1 } = track.value ?? {};
        if (!transitionName || playTimes <= 0) throw new Error(`未支持的 FGUI 嵌套转场：${definition.name}`);
        let nestedEnd = time;
        const nested = this.effects.definition(target, transitionName);
        for (let repeat = 0; repeat < playTimes; repeat++) {
          nestedEnd = this.schedule(target, nested, nestedEnd, undefined, [...ancestors, definition]);
        }
        end = Math.max(end, nestedEnd);
        if (startLabel) this.cues.push({ time, apply: () => onLabel?.(startLabel) });
      } else if (track.tween) {
        const tween = track.tween;
        if (tween.repeat < 0 || tween.path) throw new Error(`未支持的 FGUI 转场轨道：${definition.name}/${track.type}`);
        const total = tween.duration * (tween.repeat + 1);
        const trackEnd = time + total;
        end = Math.max(end, trackEnd);
        let running: RunningTrack;
        this.cues.push({ time, apply: () => {
          const apply = this.effects.tween(owner, target, track, base);
          running = { sample: (at) => {
            const elapsed = at - time;
            const cycle = tween.duration > 0 ? Math.min(tween.repeat, Math.floor(elapsed / tween.duration)) : tween.repeat;
            const progress = tween.duration > 0 ? trackProgress(elapsed, tween.duration, cycle) : 1;
            apply(tween.yoyo && cycle % 2 !== 0 ? 1 - progress : progress);
          } };
          running.sample(time);
          this.active.add(running);
          if (startLabel) onLabel?.(startLabel);
        } });
        this.cues.push({ time: trackEnd, apply: () => {
          this.active.delete(running);
          if (tween.endLabel) onLabel?.(tween.endLabel);
        } });
      } else {
        this.cues.push({ time, apply: () => {
          if (track.value) this.effects.apply(owner, target, track.type, track.value, base);
          if (startLabel) onLabel?.(startLabel);
        } });
      }
    }
    return end;
  }
}

function trackProgress(elapsed: number, duration: number, cycle: number): number {
  return Math.min(1, Math.max(0, (elapsed - cycle * duration) / duration));
}

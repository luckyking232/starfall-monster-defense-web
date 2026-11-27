import type { UiEvent } from '../../runtime/ui/protocol.ts';
import type { NativeModel } from '../../src/presentation/native-world.ts';
import type { RuleRecord } from './rule-trace-diff.ts';

const originalEffects = [
  { name: '安妮斯', normal: '10000118_skill1_bullet', passive: '10000118_skill2_bullet', talent: '10000118_skill3' },
  { name: '蒂娜', normal: '10000134_skill1_bullet', passive: '10000134_skill2_summon', talent: '10000134_skill3_bullet' },
  { name: '尼莉莎', normal: '10000104_skill1_bullet', passive: '10000104_skill2_bullet', talent: '10000104_skill3_summon' },
  { name: '菲尼斯', normal: '10000101_skill1_bullet', passive: '10000101_skill2_buff', talent: '10000101_skill3_summon' },
  { name: '列蒂西雅', normal: '10000198_skill1_bullet', passive: '10000198_skill2', talent: '10000198_skill3_buff' },
];
const watched = new Set(originalEffects.flatMap(({ normal, passive, talent }) =>
  [normal, passive, talent].map(path => `minigame022_${path}.prefab`)));
const assetName = (model: NativeModel): string => model.path.toLowerCase().split('/').at(-1)!;

interface VisualRecord extends RuleRecord {
  models: NativeModel[];
}

export function createPresentationEvidence(captureEffects: boolean) {
  const audio: RuleRecord[] = [];
  const snapshots = new Map<number, VisualRecord>();
  let displayedFrame = 0;
  function observe(event: UiEvent): void {
    if (event.name === 'audio-play') {
      audio.push({ kind: 'audio', frame: event.frame ?? displayedFrame, event });
    }
    if (event.name !== 'world') return;
    const { state } = event;
    displayedFrame = state.fixedFrame;
    if (!captureEffects || state.paused || snapshots.has(displayedFrame)) return;
    const candidates = [...(state.bullets ?? []), ...(state.effects ?? []),
      ...state.units.flatMap(unit => unit.model ? [unit.model] : [])];
    const models = candidates.filter(model => watched.has(assetName(model)))
      .sort((first, second) => (first.instance ?? 0) - (second.instance ?? 0));
    if (models.length) snapshots.set(displayedFrame, { kind: 'visual', frame: displayedFrame, models });
  }
  function effects() {
    return originalEffects.flatMap(({ name, ...paths }) => Object.entries(paths).map(([skill, path]) => {
      const asset = `minigame022_${path}.prefab`;
      const instances = new Set<number>();
      let firstFrame: number | undefined, lastFrame: number | undefined, firstModel: NativeModel | undefined, frames = 0;
      for (const snapshot of snapshots.values()) {
        const matches = snapshot.models.filter(model => assetName(model) === asset);
        if (!matches.length) continue;
        firstFrame ??= snapshot.frame;
        firstModel ??= matches[0];
        lastFrame = snapshot.frame;
        frames++;
        for (const model of matches) if (model.instance !== undefined) instances.add(model.instance);
      }
      return { name, skill, asset, firstFrame, lastFrame, frames, instances: instances.size, firstModel };
    }));
  }
  return {
    observe,
    audio,
    frames: () => [...snapshots.values()],
    effects,
  };
}

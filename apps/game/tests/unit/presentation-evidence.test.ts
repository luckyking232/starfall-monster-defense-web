import { expect, test } from 'vitest';
import { createPresentationEvidence } from '../../scripts/lib/presentation-evidence.ts';
import type { RuleState } from '../../src/engine/protocol.ts';

const originalBullet = {
  path: 'Assets/Resources/Prefabs/MiniGame022_10000134_skill3_bullet.prefab',
  position: { x: 1, y: 4, z: 0 }, scale: { x: 0.6, y: 0.6, z: 0.6 },
  right: { x: 14, y: 0, z: 0 }, age: 0.2, instance: 78,
};

test('records an original effect pose with its stable rule frame and renders sampled models in UID order', () => {
  const observed = createPresentationEvidence(true);
  observed.observe({ name: 'world', state: {
    fixedFrame: 35, paused: false, units: [],
    bullets: [{ ...originalBullet, instance: 99 }, originalBullet], effects: [],
  } as unknown as RuleState });
  expect(observed.frames()).toEqual([{
    kind: 'visual', frame: 35, models: [originalBullet, { ...originalBullet, instance: 99 }],
  }]);
  expect(observed.effects().find(effect => effect.asset.endsWith('10000134_skill3_bullet.prefab'))).toMatchObject({
    name: '蒂娜', skill: 'talent', firstFrame: 35, lastFrame: 35, instances: 2, frames: 1,
  });
});

test('keeps original battle cues in host order with their own rule frame and emitter', () => {
  const observed = createPresentationEvidence(false);
  observed.observe({ name: 'audio-play', id: 3, kind: 'sfx', frame: 17, path: 'wh', emitter: 4 });
  observed.observe({ name: 'audio-play', id: 4, kind: 'sfx', frame: 17, path: 'hit', emitter: 8 });
  expect(observed.audio).toEqual([
    { kind: 'audio', frame: 17, event: { name: 'audio-play', id: 3, kind: 'sfx', frame: 17, path: 'wh', emitter: 4 } },
    { kind: 'audio', frame: 17, event: { name: 'audio-play', id: 4, kind: 'sfx', frame: 17, path: 'hit', emitter: 8 } },
  ]);
});

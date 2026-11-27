import type { RuleState, RuleUnitState } from '../../src/engine/protocol';
import type { NativeModel } from '../../src/presentation/native-world';

type WireModel = [path: string, x: number, y: number, z: number, sx: number, sy: number, sz: number,
  clip: string | false, time: number, order: number, right: [number, number, number] | false, age: number, instance: number];
type WireUnit = [uid: number, cardId: number, x: number, y: number, z: number, camp: number,
  stateName: string | false, flipped: boolean, model: WireModel | false];
type WireSnapshot = [fixedFrame: number, stageId: number, curMonsterWave: number, killEnemyCount: number,
  curLevel: number | false, curExp: number | false, selfHp: number | false, selfMaxHp: number | false,
  speedIndex: number | false, paused: boolean, units: WireUnit[], background: WireModel | false,
  bullets: WireModel[], effects: WireModel[]];

function decodeModel(row: WireModel): NativeModel {
  const [path, x, y, z, sx, sy, sz, clip, time, order, right, age, instance] = row;
  return { path, position: { x, y, z }, scale: { x: sx, y: sy, z: sz }, time, order, age, instance,
    ...(clip === false ? {} : { clip }), ...(right === false ? {} : { right: { x: right[0], y: right[1], z: right[2] } }) };
}

function decodeUnit(row: WireUnit): RuleUnitState {
  const [uid, cardId, x, y, z, camp, stateName, flipped, model] = row;
  return { uid, cardId, x, y, z, camp, flipped,
    ...(stateName === false ? {} : { stateName }), ...(model === false ? {} : { model: decodeModel(model) }) };
}

/** The packed format stays within the Lua Worker. Window consumers receive the same named fields. */
export function decodeBattleSnapshot(raw: string): RuleState | null {
  const snapshot = JSON.parse(raw) as WireSnapshot | null;
  if (snapshot === null) return null;
  const [fixedFrame, stageId, curMonsterWave, killEnemyCount, level, exp, hp, maxHp,
    speed, paused, units, background, bullets, effects] = snapshot;
  const optional = (value: number | false) => value === false ? null : value;
  return { fixedFrame, stageId, curMonsterWave, killEnemyCount, paused, curLevel: optional(level), curExp: optional(exp),
    selfHp: optional(hp), selfMaxHp: optional(maxHp), speedIndex: optional(speed), elapsedMs: 0, terminal: null, choice: null,
    units: units.map(decodeUnit), bullets: bullets.map(decodeModel), effects: effects.map(decodeModel),
    ...(background === false ? {} : { background: decodeModel(background) }) };
}

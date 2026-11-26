export const RULES_PROTOCOL = 'starfall.monster-defense.rules/1';
export const RULES_VERSION = '134395529309427262';
export const RULES_FPS = 30;

export interface RuleUnitState {
  uid: number;
  cardId: number;
  x: number;
  y: number;
  z: number;
  camp: number;
  stateName: string;
  flipped: boolean;
  model?: import('../presentation/native-world').NativeModel;
}

export interface RuleChoiceState {
  windowId: number;
  generation: number;
  level: number;
  remainingMs: number;
  touchable: boolean;
  offerIds: number[];
  visible: boolean[];
}

export interface RuleTerminalState {
  win: boolean;
  loss: boolean;
  curMonsterWave: number;
  killEnemyCount: number;
}

export interface RuleState {
  fixedFrame: number;
  stageId: number;
  curMonsterWave: number;
  killEnemyCount: number;
  curLevel: number | null;
  curExp: number | null;
  selfHp: number | null;
  selfMaxHp: number | null;
  speedIndex: number | null;
  elapsedMs: number;
  paused: boolean;
  terminal: RuleTerminalState | null;
  choice: RuleChoiceState | null;
  units: RuleUnitState[];
  background?: import('../presentation/native-world').NativeModel;
  bullets?: import('../presentation/native-world').NativeModel[];
  effects?: import('../presentation/native-world').NativeModel[];
}

export interface RuleEvent {
  kind: string;
  frame: number;
  args: string[];
}

export interface RuleReply {
  state: RuleState;
  events: RuleEvent[];
  advancedFixed: number;
}

export interface RngInput {
  tape: number[];
  globalRngSeeds: [number, number];
}

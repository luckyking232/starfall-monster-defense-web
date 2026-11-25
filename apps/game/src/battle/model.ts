export type LevelId = string
export type RunId = string

export const MAPS = ["bay", "reef", "open-sea"] as const
export type MapId = typeof MAPS[number]
export type Upgrade = "focus" | "rapid" | "repair"

export const ARENA = { width: 960, height: 500, baseX: 168, baseY: 250 } as const
export const UPGRADES = {
  focus: { name: "聚光镜", description: "每次脉冲多造成 1 点伤害。" },
  rapid: { name: "储能线圈", description: "缩短两次脉冲之间的间隔。" },
  repair: { name: "抢修舱", description: "立即修复 2 点护盾。" },
} satisfies Record<Upgrade, { name: string; description: string }>

export interface WaveDefinition {
  count: number
  gap: number
  travel: number
  hull: number
  impact: number
  upgrade?: boolean
}

export interface LevelDefinition {
  id: LevelId
  name: string
  description: string
  requires?: LevelId
  map: MapId
  mode: "defense" | "patrol"
  cycles: number
  shield: number
  damage: number
  interval: number
  waves: readonly WaveDefinition[]
}

export interface BattleActor {
  id: number
  x: number
  y: number
  hull: number
  maxHull: number
}

export interface UpgradeChoice {
  id: string
  options: readonly Upgrade[]
}

export interface BattleResult {
  id: string
  outcome: "win" | "loss" | "ended"
}

export interface BattleSnapshot {
  runId: RunId
  levelId: LevelId
  tick: number
  phase: "running" | "choosing" | "finished"
  defense: { current: number; max: number }
  wave: { number: number; total: number }
  actors: readonly BattleActor[]
  upgrades: { damage: number; interval: number }
  choice?: UpgradeChoice
  result?: BattleResult
}

export interface BattleEvent {
  runId: RunId
  sequence: number
  kind: "spawn" | "hit" | "remove" | "breach" | "choice" | "finish"
  actor?: BattleActor
}

export interface BattleUpdate {
  snapshot: BattleSnapshot
  events: readonly BattleEvent[]
}

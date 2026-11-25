import { ARENA } from "./model.ts"
import type {
  BattleActor, BattleEvent, BattleResult, BattleUpdate, LevelDefinition,
  LevelId, RunId, Upgrade, UpgradeChoice,
} from "./model.ts"

const LANES = [106, 202, 301, 397]
const OPTIONS: readonly Upgrade[] = ["focus", "rapid", "repair"]
const ARRIVAL_X = 906
const NEXT_WAVE_DELAY = 14
const MINIMUM_INTERVAL = 3

interface Enemy {
  id: number
  lane: number
  travel: number
  age: number
  hull: number
  maxHull: number
  impact: number
}

function actor(enemy: Enemy): BattleActor {
  const journey = Math.min(1, enemy.age / enemy.travel)
  return {
    id: enemy.id,
    x: Math.round(ARRIVAL_X + (ARENA.baseX - ARRIVAL_X) * journey),
    y: Math.round(enemy.lane + (ARENA.baseY - enemy.lane) * journey ** 2),
    hull: enemy.hull,
    maxHull: enemy.maxHull,
  }
}

interface Run {
  id: RunId
  level: LevelDefinition
  seed: number
  tick: number
  wave: number
  shield: number
  damage: number
  interval: number
  sequence: number
  nextShot: number
  nextSpawn: number
  spawned: number
  enemies: Enemy[]
  choice?: UpgradeChoice
  result?: BattleResult
}

export class BattleSession {
  readonly #levels: ReadonlyMap<LevelId, LevelDefinition>
  #run: Run | undefined

  constructor(levels: ReadonlyMap<LevelId, LevelDefinition>) {
    this.#levels = levels
  }

  start(runId: RunId, levelId: LevelId, seed: number) {
    const level = this.#levels.get(levelId)
    if (!level) throw new Error(`未知关卡 ${levelId}`)
    this.#run = {
      id: runId, level, seed: seed >>> 0, tick: 0, wave: 1,
      shield: level.shield, damage: level.damage, interval: level.interval,
      sequence: 0, nextShot: 8, nextSpawn: 8, spawned: 0, enemies: [],
    }
    return this.#update(this.#run, [])
  }

  dispose() {
    this.#run = undefined
  }

  advance(steps: number) {
    const run = this.#activeRun()
    const events: BattleEvent[] = []
    if (!Number.isSafeInteger(steps) || steps < 0) throw new RangeError("Invalid simulation steps")
    for (let index = 0; index < steps && !run.choice && !run.result; index++) {
      this.#step(run, events)
    }
    return this.#update(run, events)
  }

  confirmChoice(choiceId: string, option: Upgrade) {
    const run = this.#activeRun()
    if (run.choice?.id !== choiceId || !run.choice.options.includes(option)) {
      return this.#update(run, [])
    }
    switch (option) {
      case "focus": run.damage++; break
      case "rapid": run.interval = Math.max(MINIMUM_INTERVAL, run.interval - 3); break
      case "repair": run.shield = Math.min(run.level.shield, run.shield + 2); break
    }
    run.choice = undefined
    this.#nextWave(run)
    return this.#update(run, [])
  }

  #activeRun() {
    if (!this.#run) throw new Error("Battle has not started.")
    return this.#run
  }

  #step(run: Run, events: BattleEvent[]) {
    run.tick++
    const wave = run.level.waves[(run.wave - 1) % run.level.waves.length]
    if (run.spawned < wave.count && run.tick >= run.nextSpawn) {
      run.seed = (Math.imul(run.seed, 1664525) + 1013904223) >>> 0
      const enemy: Enemy = {
        id: (run.wave - 1) * 1000 + run.spawned + 1,
        lane: LANES[run.seed >>> 30],
        travel: wave.travel, age: 0, hull: wave.hull, maxHull: wave.hull, impact: wave.impact,
      }
      run.enemies.push(enemy)
      run.spawned++
      run.nextSpawn = run.tick + wave.gap
      this.#emit(events, run, "spawn", enemy)
    }

    for (const enemy of run.enemies) enemy.age++
    const target = run.enemies[0]
    if (target && run.tick >= run.nextShot) {
      target.hull -= run.damage
      run.nextShot = run.tick + run.interval
      this.#emit(events, run, "hit", target)
      if (target.hull <= 0) {
        this.#emit(events, run, "remove", target)
        run.enemies.shift()
      }
    }
    while (run.enemies[0] && run.enemies[0].age >= run.enemies[0].travel) {
      const enemy = run.enemies.shift()!
      run.shield = Math.max(0, run.shield - enemy.impact)
      this.#emit(events, run, "breach", enemy)
    }

    if (run.shield === 0) {
      this.#finish(run, events, "loss")
    } else if (run.spawned === wave.count && run.enemies.length === 0) {
      if (run.wave === this.#totalWaves(run)) {
        this.#finish(run, events, "win")
      } else if (wave.upgrade) {
        run.choice = { id: `${run.id}:choice:${run.wave}`, options: OPTIONS }
        this.#emit(events, run, "choice")
      } else {
        this.#nextWave(run)
      }
    }
  }

  #nextWave(run: Run) {
    run.wave++
    run.spawned = 0
    run.nextSpawn = run.tick + NEXT_WAVE_DELAY
  }

  #totalWaves(run: Run) {
    return run.level.waves.length * run.level.cycles
  }

  #finish(run: Run, events: BattleEvent[], outcome: BattleResult["outcome"]) {
    run.result = { id: `${run.id}:result`, outcome }
    this.#emit(events, run, "finish")
  }

  #emit(events: BattleEvent[], run: Run, kind: BattleEvent["kind"], enemy?: Enemy) {
    events.push({ runId: run.id, sequence: ++run.sequence, kind, actor: enemy && actor(enemy) })
  }

  #update(run: Run, events: readonly BattleEvent[]): BattleUpdate {
    return {
      snapshot: {
        runId: run.id, levelId: run.level.id, tick: run.tick,
        phase: run.result ? "finished" : run.choice ? "choosing" : "running",
        defense: { current: run.shield, max: run.level.shield },
        wave: { number: run.wave, total: this.#totalWaves(run) },
        actors: run.enemies.map(actor),
        upgrades: { damage: run.damage, interval: run.interval },
        choice: run.choice && { id: run.choice.id, options: [...run.choice.options] },
        result: run.result && { ...run.result },
      },
      events,
    }
  }
}

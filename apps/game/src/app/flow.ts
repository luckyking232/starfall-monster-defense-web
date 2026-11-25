import type { BattleSnapshot, LevelId, RunId } from "../battle/model.ts"
import type { ProgressStore } from "../platform/progress.ts"

type Page = "loading" | "start" | "select" | "run"
type Panel = "loading" | "unavailable" | "battle" | "paused" | "exit" | "choice" | "result"
type Stage = { id: LevelId; requires?: LevelId }

interface ActiveRun {
  readonly id: RunId
  readonly levelId: LevelId
  snapshot?: BattleSnapshot
  paused: boolean
  exiting: boolean
  unavailable: boolean
  saveFailed: boolean
  speed: 1 | 2
}

export class GameFlow {
  readonly #levels: ReadonlyMap<LevelId, Stage>
  readonly #progress: ProgressStore
  readonly #sessionClears = new Set<LevelId>()
  #page: Page = "loading"
  #run: ActiveRun | undefined
  #serial = 0
  #hidden = false

  constructor(levels: Iterable<Stage>, progress: ProgressStore) {
    this.#levels = new Map(Array.from(levels, level => [level.id, level]))
    this.#progress = progress
  }

  get page() { return this.#page }
  get run(): Readonly<ActiveRun> | undefined { return this.#run }

  get panel(): Panel | undefined {
    const run = this.#run
    if (!run) return undefined
    if (run.exiting) return "exit"
    if (run.unavailable) return "unavailable"
    if (run.paused) return "paused"
    if (!run.snapshot) return "loading"
    if (run.snapshot.phase === "finished") return "result"
    if (run.snapshot.phase === "choosing") return "choice"
    return "battle"
  }

  get canAdvance() {
    return this.panel === "battle" && !this.#hidden
  }

  ready() {
    if (this.#page === "loading") this.#page = "start"
  }

  start() {
    if (this.#page === "start") this.#page = "select"
  }

  isCleared(id: LevelId) {
    return this.#sessionClears.has(id) || this.#progress.read().has(id)
  }

  isUnlocked(id: LevelId) {
    const level = this.#levels.get(id)
    return !!level && (!level.requires || this.isCleared(level.requires))
  }

  enterLevel(levelId: LevelId) {
    if (this.#page !== "select" || !this.isUnlocked(levelId)) return undefined
    const id = `run-${++this.#serial}`
    this.#page = "run"
    this.#run = {
      id, levelId, paused: this.#hidden, exiting: false, unavailable: false, saveFailed: false, speed: 1,
    }
    return id
  }

  acceptSnapshot(snapshot: BattleSnapshot) {
    const run = this.#run
    if (!run || run.id !== snapshot.runId || run.levelId !== snapshot.levelId ||
        run.unavailable || run.snapshot?.phase === "finished" ||
        (run.snapshot && snapshot.tick < run.snapshot.tick)) return false
    run.snapshot = snapshot
    return true
  }

  markUnavailable(runId: RunId) {
    if (this.#run?.id === runId && !this.#run.snapshot) this.#run.unavailable = true
  }

  returnFromUnavailable() {
    if (this.#run?.unavailable) this.#returnToSelect()
  }

  setHidden(hidden: boolean) {
    this.#hidden = hidden
    if (hidden && this.#run) this.#run.paused = true
  }

  pause() {
    if (this.#run) this.#run.paused = true
  }

  resume() {
    if (!this.#hidden && this.#run) this.#run.paused = false
  }

  toggleSpeed() {
    if (this.#run && this.canAdvance) this.#run.speed = this.#run.speed === 1 ? 2 : 1
  }

  requestExit() {
    if (this.#run) this.#run.exiting = true
  }

  cancelExit() {
    if (this.#run) this.#run.exiting = false
  }

  confirmExit() {
    if (this.#run?.exiting) this.#returnToSelect()
  }

  confirmResult(runId: RunId, resultId: string) {
    const run = this.#run
    const result = run?.snapshot?.result
    if (this.panel !== "result" || run?.id !== runId || result?.id !== resultId) return

    if (result.outcome === "win") {
      const { saved } = this.#progress.commitClear(run.levelId)
      if (!saved) {
        run.saveFailed = true
        return
      }
      this.#sessionClears.add(run.levelId)
    }
    this.#returnToSelect()
  }

  returnWithoutSave(runId: RunId, resultId: string) {
    const run = this.#run
    if (this.panel !== "result" || run?.id !== runId || !run.saveFailed ||
        run.snapshot?.result?.id !== resultId) return

    this.#sessionClears.add(run.levelId)
    this.#returnToSelect()
  }

  #returnToSelect() {
    this.#run = undefined
    this.#page = "select"
  }
}

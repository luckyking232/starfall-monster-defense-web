import assert from "node:assert/strict"
import { test } from "node:test"
import { GameFlow } from "../src/app/flow.ts"
import type { BattleSnapshot } from "../src/battle/model.ts"

const levels = [{ id: "bay" }, { id: "reef", requires: "bay" }]

function fixture(canSave = true, clears = new Set<string>()) {
  let commits = 0
  const flow = new GameFlow(levels, {
    read: () => new Set(clears),
    commitClear: id => {
      commits++
      if (canSave) clears.add(id)
      return { saved: canSave }
    },
  })
  return { flow, commits: () => commits }
}

function startRun(flow: GameFlow) {
  flow.ready()
  flow.start()
  return flow.enterLevel("bay")!
}

function snapshot(runId: string, change: Partial<BattleSnapshot> = {}): BattleSnapshot {
  return {
    runId,
    levelId: "bay",
    tick: 1,
    phase: "running",
    defense: { current: 5, max: 5 },
    wave: { number: 1, total: 2 },
    actors: [],
    upgrades: { damage: 1, interval: 8 },
    ...change,
  }
}

test("每次加载先到开始页，本地通关进度只解锁选关", () => {
  const { flow } = fixture(true, new Set(["bay"]))
  assert.equal(flow.page, "loading")
  flow.ready()
  assert.equal(flow.page, "start")
  assert.equal(flow.enterLevel("reef"), undefined)
  flow.start()
  assert.equal(flow.page, "select")
  assert.ok(flow.isUnlocked("reef"))
})

test("锁关无法进入，后台暂停覆盖选择弹层，继续回到原选择", () => {
  const { flow } = fixture()
  const runId = startRun(flow)
  assert.equal(flow.enterLevel("reef"), undefined)
  flow.acceptSnapshot(snapshot(runId, { phase: "choosing",
    choice: { id: "choice-1", options: ["focus"] } }))
  assert.equal(flow.panel, "choice")
  flow.setHidden(true)
  assert.equal(flow.panel, "paused")
  flow.resume()
  assert.equal(flow.panel, "paused")
  flow.setHidden(false)
  assert.equal(flow.panel, "paused")
  flow.resume()
  assert.equal(flow.panel, "choice")
  assert.equal(flow.run?.id, runId)
  assert.equal(flow.canAdvance, false)
})

test("加载完成时已在后台则先暂停，取消退出回到该局", () => {
  const { flow, commits } = fixture()
  const runId = startRun(flow)
  flow.setHidden(true)
  assert.ok(flow.acceptSnapshot(snapshot(runId)))
  assert.equal(flow.panel, "paused")
  flow.requestExit()
  assert.equal(flow.panel, "exit")
  flow.cancelExit()
  assert.equal(flow.panel, "paused")
  flow.setHidden(false)
  flow.resume()
  assert.equal(flow.canAdvance, true)
  flow.requestExit()
  flow.confirmExit()
  assert.equal(flow.page, "select")
  assert.equal(flow.acceptSnapshot(snapshot(runId)), false)
  assert.equal(commits(), 0)
})

test("同一个胜利结算只提交一次，失败结算不写通关", () => {
  const { flow, commits } = fixture()
  const runId = startRun(flow)
  flow.acceptSnapshot(snapshot(runId, { phase: "finished",
    result: { id: "result-1", outcome: "win" } }))
  assert.equal(commits(), 0)
  flow.confirmResult(runId, "result-1")
  flow.confirmResult(runId, "result-1")
  assert.equal(commits(), 1)
  assert.equal(flow.page, "select")
  assert.ok(flow.isUnlocked("reef"))
  const nextId = flow.enterLevel("bay")!
  assert.notEqual(nextId, runId)
  assert.equal(flow.acceptSnapshot(snapshot(runId)), false)
  flow.acceptSnapshot(snapshot(nextId, { phase: "finished",
    result: { id: "result-2", outcome: "loss" } }))
  flow.confirmResult(nextId, "result-2")
  assert.equal(flow.page, "select")
  assert.equal(commits(), 1)
})

test("保存被拒后可就地重试或保留本次进度返回", () => {
  const { flow, commits } = fixture(false)
  const runId = startRun(flow)
  flow.acceptSnapshot(snapshot(runId, { phase: "finished",
    result: { id: "result-1", outcome: "win" } }))
  flow.confirmResult(runId, "result-1")
  assert.equal(flow.panel, "result")
  assert.ok(flow.run?.saveFailed)
  flow.confirmResult(runId, "result-1")
  assert.equal(commits(), 2)
  flow.returnWithoutSave(runId, "result-1")
  assert.equal(flow.page, "select")
  assert.ok(flow.isUnlocked("reef"))
})

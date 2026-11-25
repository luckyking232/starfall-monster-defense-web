import assert from "node:assert/strict"
import { test } from "node:test"
import { FixedClock } from "../src/battle/clock.ts"
import { BattleSession } from "../src/battle/session.ts"
import type { LevelDefinition } from "../src/battle/model.ts"

const bay: LevelDefinition = {
  id: "bay", name: "试验湾", description: "守住测试港口", map: "bay",
  mode: "defense", cycles: 1, shield: 4, damage: 2, interval: 8,
  waves: [
    { count: 3, gap: 10, travel: 80, hull: 2, impact: 1, upgrade: true },
    { count: 5, gap: 8, travel: 60, hull: 3, impact: 1 },
  ],
}

function open(level = bay) {
  const session = new BattleSession(new Map([[level.id, level]]))
  session.start("run-1", level.id, 42)
  return session
}

test("自动运行到升级，确认一次并胜利结束", () => {
  const session = open()
  const first = session.advance(800)
  assert.equal(first.snapshot.phase, "choosing")
  assert.ok(first.events.some(event => event.kind === "hit"))
  const choiceId = first.snapshot.choice!.id
  assert.deepEqual(session.advance(99).snapshot, first.snapshot)
  assert.equal(session.confirmChoice("old-run:choice:1", "focus").snapshot.phase, "choosing")
  const upgraded = session.confirmChoice(choiceId, "focus")
  assert.equal(upgraded.snapshot.upgrades.damage, 3)
  assert.equal(session.confirmChoice(choiceId, "focus").snapshot.upgrades.damage, 3)
  assert.equal(session.advance(1500).snapshot.result?.outcome, "win")
})

test("相同内容、种子和输入与绘制步进无关", () => {
  const batched = open()
  const single = open()
  const big = batched.advance(100)
  const small = []
  for (let index = 0; index < 100; index++) small.push(...single.advance(1).events)
  assert.deepEqual(single.advance(0).snapshot, big.snapshot)
  assert.deepEqual(small, big.events)
})

test("前哨耗尽时失败，巡防可以跨循环结束", () => {
  const fragile = open({ ...bay, shield: 1, waves: [
    { count: 2, gap: 4, travel: 4, hull: 30, impact: 1 },
  ] })
  assert.equal(fragile.advance(800).snapshot.result?.outcome, "loss")
  const patrol = open({ ...bay, mode: "patrol", cycles: 2, waves: [
    { count: 2, gap: 5, travel: 90, hull: 1, impact: 1 },
  ] })
  const completed = patrol.advance(800).snapshot
  assert.equal(completed.wave.number, 2)
  assert.equal(completed.result?.outcome, "win")
})

test("时钟与速度可控，暂停的时间不补跑", () => {
  const clock = new FixedClock()
  assert.equal(clock.steps(100, true, 1), 0)
  assert.equal(clock.steps(240, true, 1), 2)
  assert.equal(clock.steps(4000, false, 1), 0)
  assert.equal(clock.steps(5000, true, 1), 0)
  assert.equal(clock.steps(5100, true, 2), 4)
})

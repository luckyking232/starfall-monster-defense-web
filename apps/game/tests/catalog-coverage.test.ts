import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { BattleSession } from "../src/battle/session.ts"
import { parseCatalog } from "../src/content/catalog.ts"

const source = readFileSync(new URL("../src/content/levels.json", import.meta.url), "utf-8")
const levels = parseCatalog(JSON.parse(source))

test("目录中每个自制关卡和巡防循环都可完成", () => {
  for (const level of levels.values()) {
    const game = new BattleSession(levels)
    let update = game.start("check", level.id, 811)
    for (let decision = 0; decision < level.waves.length * level.cycles && !update.snapshot.result; decision++) {
      update = game.advance(50_000)
      const choice = update.snapshot.choice
      if (choice) update = game.confirmChoice(choice.id, "focus")
    }
    assert.equal(update.snapshot.result?.outcome, "win", level.name)
    assert.equal(update.snapshot.wave.number, level.waves.length * level.cycles)
  }
})

import assert from "node:assert/strict"
import { test } from "node:test"
import { parseCatalog } from "../src/content/catalog.ts"

const level = {
  id: "bay", name: "灯塔湾", description: "守住港口", map: "bay",
  mode: "defense", cycles: 1, shield: 5, damage: 2, interval: 8,
  waves: [{ count: 3, gap: 5, travel: 60, hull: 2, impact: 1 }],
}

test("目录验证后可使用稳定关卡 ID 及解锁前置", () => {
  const catalog = parseCatalog([level, { ...level, id: "reef", requires: "bay", map: "reef" }])
  assert.deepEqual([...catalog.keys()], ["bay", "reef"])
  assert.equal(catalog.get("reef")?.requires, "bay")
})

test("错误关卡关系与未知场景资源在载入时失败", () => {
  assert.throws(() => parseCatalog([level, level]), /重复/)
  assert.throws(() => parseCatalog([{ ...level, requires: "missing" }]), /前置/)
  assert.throws(() => parseCatalog([{ ...level, requires: "bay" }]), /循环/)
  assert.throws(() => parseCatalog([{ ...level, map: "unbuilt" }]), /场景/)
  assert.throws(() => parseCatalog([{ ...level, mode: "other" }]), /模式/)
})

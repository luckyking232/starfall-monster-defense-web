import assert from "node:assert/strict"
import { test } from "node:test"
import { LocalProgress } from "../src/platform/progress.ts"

function storage() {
  const records = new Map<string, string>()
  return {
    records,
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => { records.set(key, value) },
  }
}

test("两个标签各自通关后同时保留两关记录", () => {
  const disk = storage()
  const first = new LocalProgress(["bay", "reef"], () => disk)
  const second = new LocalProgress(["bay", "reef"], () => disk)
  assert.deepEqual(first.read(), new Set())
  assert.deepEqual(second.read(), new Set())
  assert.equal(first.commitClear("bay").saved, true)
  assert.equal(second.commitClear("reef").saved, true)
  assert.deepEqual(first.read(), new Set(["bay", "reef"]))
})

test("单条记录损坏时保住其余进度，重复胜利不重写", () => {
  const disk = storage()
  let writes = 0
  const progress = new LocalProgress(["bay", "reef"], () => ({
    getItem: disk.getItem,
    setItem(key, value) { writes++; disk.setItem(key, value) },
  }))
  progress.commitClear("bay")
  progress.commitClear("bay")
  assert.equal(writes, 1)
  progress.commitClear("reef")
  const [bayKey] = disk.records.keys()
  disk.records.set(bayKey, "{")
  assert.deepEqual(progress.read(), new Set(["reef"]))
})

test("存储不可用与未知关卡返回保存失败", () => {
  const progress = new LocalProgress(["bay"], () => { throw new Error("denied") })
  assert.deepEqual(progress.read(), new Set())
  assert.equal(progress.commitClear("bay").saved, false)
  assert.equal(progress.commitClear("unknown").saved, false)
})

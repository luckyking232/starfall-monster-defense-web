import { MAPS } from "../battle/model.ts"
import type { LevelDefinition } from "../battle/model.ts"

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function integer(value: unknown, min: number, max: number) {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
}

function levelId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9-]{0,49}$/.test(value)
}

function text(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
}

function checkLevel(value: unknown): LevelDefinition {
  if (!record(value) || !levelId(value.id) || !text(value.name) || !text(value.description)) {
    throw new Error("关卡目录缺少有效的名称、说明或 ID。")
  }
  const id = value.id
  if (!MAPS.some(map => map === value.map)) throw new Error(`关卡 ${id} 的场景未定义。`)
  if (value.requires !== undefined && !levelId(value.requires)) throw new Error(`关卡 ${id} 的前置无效。`)
  if ((value.mode !== "defense" && value.mode !== "patrol") ||
      !integer(value.cycles, value.mode === "patrol" ? 2 : 1, value.mode === "patrol" ? 4 : 1)) {
    throw new Error(`关卡 ${id} 的模式或循环数无效。`)
  }
  if (!integer(value.shield, 1, 25) || !integer(value.damage, 1, 20) ||
      !integer(value.interval, 3, 100)) throw new Error(`关卡 ${id} 的前哨配置无效。`)
  if (!Array.isArray(value.waves) || value.waves.length === 0 || value.waves.length > 15 ||
      value.waves.some(wave => !record(wave) ||
        !integer(wave.count, 1, 120) || !integer(wave.gap, 1, 150) ||
        !integer(wave.travel, 4, 400) || !integer(wave.hull, 1, 50) ||
        !integer(wave.impact, 1, 12) ||
        (wave.upgrade !== undefined && typeof wave.upgrade !== "boolean"))) {
    throw new Error(`关卡 ${id} 的来袭配置无效。`)
  }
  return value as unknown as LevelDefinition
}

export function parseCatalog(data: unknown): ReadonlyMap<string, LevelDefinition> {
  if (!Array.isArray(data) || data.length === 0) throw new Error("没有可玩的关卡。")
  const levels = new Map<string, LevelDefinition>()
  for (const row of data) {
    const level = checkLevel(row)
    if (levels.has(level.id)) throw new Error(`关卡 ID 重复 ${level.id}`)
    levels.set(level.id, level)
  }
  for (const level of levels.values()) {
    const path = new Set([level.id])
    let requires = level.requires
    while (requires) {
      const prerequisite = levels.get(requires)
      if (!prerequisite) throw new Error(`关卡 ${level.id} 的前置缺失。`)
      if (path.has(requires)) throw new Error(`关卡 ${level.id} 的解锁关系存在循环。`)
      path.add(requires)
      requires = prerequisite.requires
    }
  }
  return levels
}

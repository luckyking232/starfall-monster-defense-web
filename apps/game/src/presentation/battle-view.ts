import Phaser from "phaser"
import { ARENA } from "../battle/model.ts"
import type { BattleEvent, BattleSnapshot, MapId } from "../battle/model.ts"

const PALETTES = {
  bay: { water: 0x113840, grid: 0x43746c, land: 0x355a50, dock: 0x558579 },
  reef: { water: 0x172e3c, grid: 0x536a87, land: 0x4e506b, dock: 0x777e9f },
  "open-sea": { water: 0x15334a, grid: 0x3c688c, land: 0x2c546d, dock: 0x527b90 },
}

function paintChart(chart: Phaser.GameObjects.Graphics, map: MapId) {
  const { water, grid, land, dock } = PALETTES[map]
  chart.fillStyle(water).fillRect(0, 0, ARENA.width, ARENA.height)
  chart.lineStyle(1, grid, 0.38)
  for (let x = 0; x <= ARENA.width; x += 38) chart.lineBetween(x, 0, x, ARENA.height)
  for (let y = 0; y <= ARENA.height; y += 38) chart.lineBetween(0, y, ARENA.width, y)
  chart.lineStyle(2, grid, 0.65)
  for (let radius = 76; radius <= 760; radius += 76) {
    chart.strokeCircle(ARENA.baseX, ARENA.baseY, radius)
  }

  chart.fillStyle(land).fillPoints([
    { x: 0, y: 55 }, { x: 94, y: 88 }, { x: 139, y: 154 }, { x: 161, y: 192 },
    { x: 203, y: 221 }, { x: 229, y: 251 }, { x: 190, y: 313 },
    { x: 129, y: 334 }, { x: 89, y: 418 }, { x: 0, y: 453 },
  ], true)
  if (map === "reef") {
    chart.fillStyle(land, 0.7)
    chart.fillTriangle(494, 0, 723, 0, 585, 120)
    chart.fillTriangle(619, 500, 848, 500, 784, 387)
  } else if (map === "open-sea") {
    for (const offset of [470, 615, 780]) {
      chart.lineStyle(2, grid, 0.55).strokeEllipse(offset, 250, 135, 400)
    }
  }

  chart.lineStyle(4, dock).strokeRoundedRect(38, 197, 175, 103, 16)
  chart.fillStyle(0x182f31).fillRoundedRect(53, 211, 148, 75, 12)
  chart.fillStyle(0xc0f7bd).fillCircle(ARENA.baseX, ARENA.baseY, 13)
  chart.lineStyle(2, 0xbfeeb8).strokeCircle(ARENA.baseX, ARENA.baseY, 26)
  chart.lineStyle(1, 0x93d499, 0.4).strokeCircle(ARENA.baseX, ARENA.baseY, 43)
}

interface Effect {
  x: number
  y: number
  kind: "hit" | "remove" | "breach"
  expires: number
}

export function createBattleView(parent: HTMLElement, map: MapId) {
  let dynamics: Phaser.GameObjects.Graphics | undefined
  let resolveReady!: () => void
  const ready = new Promise<void>(resolve => { resolveReady = resolve })
  const effects: Effect[] = []
  let lastSequence = 0
  let destroyed = false

  const game = new Phaser.Game({
    type: Phaser.CANVAS,
    parent,
    width: ARENA.width,
    height: ARENA.height,
    backgroundColor: PALETTES[map].water,
    banner: false,
    audio: { noAudio: true },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: {
      create(this: Phaser.Scene) {
        if (destroyed) return
        paintChart(this.add.graphics(), map)
        dynamics = this.add.graphics()
        resolveReady()
      },
    },
  })

  return {
    ready,
    draw(snapshot: BattleSnapshot, events: readonly BattleEvent[]) {
      const layer = dynamics
      if (destroyed || !layer) return

      for (const event of events) {
        if (event.runId !== snapshot.runId || event.sequence <= lastSequence) continue
        lastSequence = event.sequence
        if (!event.actor || (event.kind !== "hit" && event.kind !== "remove" && event.kind !== "breach")) continue
        effects.push({ x: event.actor.x, y: event.actor.y, kind: event.kind, expires: snapshot.tick + 6 })
      }
      layer.clear()
      for (const target of snapshot.actors) {
        const size = 10 + Math.min(target.maxHull, 10)
        layer.fillStyle(0x132323, 0.65).fillEllipse(target.x + 4, target.y + 6, size * 3, 16)
        layer.fillStyle(0xffc185).fillPoints([
          { x: target.x - size, y: target.y },
          { x: target.x + size * 0.7, y: target.y - size * 0.6 },
          { x: target.x + size, y: target.y },
          { x: target.x + size * 0.7, y: target.y + size * 0.6 },
        ], true)
        layer.fillStyle(0x572f32).fillCircle(target.x + 2, target.y, Math.max(3, size * 0.25))
        layer.fillStyle(0xffc185, 0.8).fillRect(target.x - 10, target.y - size, 20 * target.hull / target.maxHull, 2)
      }

      for (let index = effects.length - 1; index >= 0; index--) {
        const effect = effects[index]
        const life = effect.expires - snapshot.tick
        if (life <= 0) {
          effects.splice(index, 1)
          continue
        }
        const color = effect.kind === "breach" ? 0xff9e7c : 0xc8ffb8
        if (effect.kind === "hit") {
          layer.lineStyle(3, color, life / 7).lineBetween(ARENA.baseX, ARENA.baseY, effect.x, effect.y)
        }
        layer.lineStyle(2, color, life / 7).strokeCircle(effect.x, effect.y, 10 + (6 - life) * 3)
      }
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      game.destroy(true)
      resolveReady()
    },
  }
}

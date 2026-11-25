import type { LevelDefinition, LevelId } from "../battle/model.ts"
import { button } from "./elements.ts"

export function startingScreen(onStart: () => void) {
  const screen = document.createElement("section")
  screen.className = "start-screen"
  screen.innerHTML = `
    <div class="start-art" aria-hidden="true"><div class="beacon"></div></div>
    <div class="start-copy">
      <h1>潮汐前哨</h1>
      <p>守住港口。在来袭间隙升级前哨。</p>
    </div>`
  screen.querySelector(".start-copy")!.append(button("开始", onStart, "primary"))
  return screen
}

export function levelScreen(
  levels: ReadonlyMap<LevelId, LevelDefinition>,
  isUnlocked: (id: LevelId) => boolean,
  isCleared: (id: LevelId) => boolean,
  onLevel: (id: LevelId) => void,
) {
  const screen = document.createElement("section")
  screen.className = "level-screen"
  screen.innerHTML = `
    <header class="screen-heading">
      <h1>选择关卡</h1><p>选定海域后，前哨会自动开战。</p>
    </header>
    <div class="level-list"></div>`
  const list = screen.querySelector(".level-list")!
  for (const level of levels.values()) {
    const card = button("", () => onLevel(level.id), "level-card")
    card.dataset.map = level.map
    const unlocked = isUnlocked(level.id)
    card.disabled = !unlocked
    const art = document.createElement("span")
    art.className = "level-art"
    art.setAttribute("aria-hidden", "true")
    const name = document.createElement("strong")
    name.textContent = level.name
    const description = document.createElement("span")
    description.textContent = level.description
    const status = document.createElement("span")
    status.className = "level-status"
    status.textContent = isCleared(level.id) ? "已通关" : unlocked
      ? level.mode === "patrol" ? "循环巡防" : "防守关卡"
      : `先通关${levels.get(level.requires!)?.name ?? "前一关"}`
    card.append(art, name, description, status)
    list.append(card)
  }
  return screen
}

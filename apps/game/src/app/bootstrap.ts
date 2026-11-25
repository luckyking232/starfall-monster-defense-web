import "../ui/layout.css"
import { GameFlow } from "./flow.ts"
import { BattleSession } from "../battle/session.ts"
import { FixedClock } from "../battle/clock.ts"
import type { BattleEvent, BattleUpdate, LevelId, RunId, Upgrade } from "../battle/model.ts"
import { parseCatalog } from "../content/catalog.ts"
import levelDefinitions from "../content/levels.json"
import { LocalProgress, PROGRESS_NAMESPACE } from "../platform/progress.ts"
import { observeVisibility } from "../platform/visibility.ts"
import { GameAudio } from "../presentation/audio.ts"
import type { createBattleView } from "../presentation/battle-view.ts"
import { button } from "../ui/elements.ts"
import { levelScreen, startingScreen } from "../ui/level-screen.ts"
import { choiceDialog, dialog } from "../ui/overlays.ts"

const root = document.querySelector<HTMLElement>("#game")
if (!root) throw new Error("Missing game root.")
const app = root

const levels = parseCatalog(levelDefinitions)
const progress = new LocalProgress(levels.keys(), () => window.localStorage)
const flow = new GameFlow(levels.values(), progress)
const session = new BattleSession(levels)
const clock = new FixedClock()
const audio = new GameAudio()

let view: ReturnType<typeof createBattleView> | undefined
let battle: ReturnType<typeof battleScreen> | undefined
let frame = 0
let currentOverlay = ""
let draftChoice: { id: string; option: Upgrade } | undefined

function showLevels() {
  if (frame) cancelAnimationFrame(frame)
  frame = 0
  clock.reset()
  view?.destroy()
  view = undefined
  battle = undefined
  currentOverlay = ""
  draftChoice = undefined
  session.dispose()
  app.replaceChildren(levelScreen(
    levels, id => flow.isUnlocked(id), id => flow.isCleared(id), id => { void openLevel(id) },
  ))
}

function battleScreen(levelId: LevelId) {
  const screen = document.createElement("section")
  screen.className = "battle-screen"
  screen.innerHTML = `
    <header class="battle-hud">
      <div class="battle-title"><h1></h1><p class="battle-wave"></p></div>
      <div class="battle-readouts"><div class="defense"></div><div class="damage"></div></div>
      <div class="battle-controls"></div>
    </header>
    <div class="arena" role="img" aria-label="前哨战场"></div>
    <p class="battle-hint">前哨自动拦截，波次间可以升级。</p>
    <div class="overlay" hidden></div>`
  screen.querySelector("h1")!.textContent = levels.get(levelId)!.name
  const speed = button("倍速 1×", () => act(() => flow.toggleSpeed()))
  const pause = button("暂停", () => act(() => flow.pause()))
  const controls = screen.querySelector<HTMLElement>(".battle-controls")!
  controls.append(speed, pause)
  return {
    screen, speed, pause, controls,
    arena: screen.querySelector<HTMLElement>(".arena")!,
    overlay: screen.querySelector<HTMLElement>(".overlay")!,
    wave: screen.querySelector<HTMLElement>(".battle-wave")!,
    defense: screen.querySelector<HTMLElement>(".defense")!,
    damage: screen.querySelector<HTMLElement>(".damage")!,
  }
}

async function openLevel(levelId: LevelId) {
  const runId = flow.enterLevel(levelId)
  if (!runId) return

  const stage = battleScreen(levelId)
  battle = stage
  app.replaceChildren(stage.screen)
  audio.signal(400)
  sync()
  let deadline: number | undefined
  try {
    const module = await import("../presentation/battle-view.ts")
    if (flow.run?.id !== runId) return
    const created = module.createBattleView(stage.arena, levels.get(levelId)!.map)
    view = created
    await Promise.race([
      created.ready,
      new Promise<never>((_, reject) => {
        deadline = window.setTimeout(() => reject(new Error("战场准备超时")), 12_000)
      }),
    ])
    if (flow.run?.id !== runId) return
    receive(session.start(runId, levelId, Date.now() >>> 0))
  } catch {
    if (flow.run?.id !== runId) return
    view?.destroy()
    view = undefined
    flow.markUnavailable(runId)
    sync()
  } finally {
    if (deadline !== undefined) clearTimeout(deadline)
  }
}

function act(action: () => void) {
  action()
  audio.setPaused(flow.panel === "paused" || flow.panel === "exit" || document.hidden)
  audio.signal(400)
  if (flow.page === "select") showLevels()
  else sync()
}

function signalBattle(events: readonly BattleEvent[]) {
  if (events.some(event => event.kind === "finish")) audio.signal(550, 0.25)
  else if (events.some(event => event.kind === "choice")) audio.signal(610, 0.2)
  else if (events.some(event => event.kind === "breach")) audio.signal(150, 0.16)
  else if (events.some(event => event.kind === "hit")) audio.signal(320, 0.06)
}

function receive(update: BattleUpdate) {
  if (!flow.acceptSnapshot(update.snapshot)) return
  view?.draw(update.snapshot, update.events)
  signalBattle(update.events)
  sync()
}

function tick(now: number) {
  frame = 0
  const steps = clock.steps(now, flow.canAdvance, flow.run?.speed ?? 1)
  if (steps) receive(session.advance(steps))
  else sync()
}

function text(element: HTMLElement, value: string) {
  if (element.textContent !== value) element.textContent = value
}

function sync() {
  const run = flow.run
  const stage = battle
  if (!stage || !run) return

  const snapshot = run.snapshot
  if (snapshot) {
    text(stage.wave, `第 ${snapshot.wave.number} / ${snapshot.wave.total} 波`)
    text(stage.defense, `护盾 ${snapshot.defense.current} / ${snapshot.defense.max}`)
    text(stage.damage, `脉冲伤害 ${snapshot.upgrades.damage}`)
  }
  text(stage.speed, `倍速 ${run.speed}×`)
  stage.speed.disabled = !flow.canAdvance
  stage.pause.disabled = !flow.canAdvance

  const panelKey = `${run.id}/${flow.panel}/${run.saveFailed}`
  if (panelKey !== currentOverlay) {
    currentOverlay = panelKey
    stage.overlay.replaceChildren()
    const panel = renderPanel(run.id)
    stage.overlay.hidden = !panel
    stage.controls.toggleAttribute("inert", !!panel)
    if (panel) stage.controls.setAttribute("aria-hidden", "true")
    else stage.controls.removeAttribute("aria-hidden")
    if (panel) {
      stage.overlay.append(panel)
      panel.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus()
    }
  }

  if (flow.canAdvance) {
    if (!frame) frame = requestAnimationFrame(tick)
  } else {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    clock.reset()
  }
}

function renderPanel(runId: RunId): HTMLElement | undefined {
  const run = flow.run!
  const snapshot = run.snapshot
  const name = levels.get(run.levelId)!.name
  switch (flow.panel) {
    case "loading": {
      const loading = dialog("正在准备战场", "准备好后，前哨会自动开始防守。")
      loading.actions.append(button("退出本局", () => act(() => flow.requestExit())))
      return loading.panel
    }
    case "unavailable": {
      const unavailable = dialog("战场加载失败", "可以重试，或回到选关。")
      unavailable.actions.append(
        button("返回选关", () => act(() => flow.returnFromUnavailable())),
        button("重试", () => {
          act(() => flow.returnFromUnavailable())
          void openLevel(run.levelId)
        }, "primary"),
      )
      return unavailable.panel
    }
    case "paused": {
      const pause = dialog("已暂停", "继续后从当前进度接着防守。")
      pause.actions.append(
        button("继续", () => act(() => flow.resume()), "primary"),
        button("退出本局", () => act(() => flow.requestExit())),
      )
      return pause.panel
    }
    case "exit": {
      const exit = dialog("退出本局？", "本局将结束，返回选关。")
      exit.actions.append(
        button("取消", () => act(() => flow.cancelExit())),
        button("确认退出", () => act(() => flow.confirmExit()), "primary"),
      )
      return exit.panel
    }
    case "choice": {
      const current = draftChoice?.id === snapshot!.choice!.id ? draftChoice?.option : undefined
      return choiceDialog(
        snapshot!, current,
        (id, option) => { draftChoice = { id, option } },
        (id, option) => {
          if (flow.run?.id !== runId || flow.panel !== "choice") return
          draftChoice = undefined
          audio.signal(590)
          receive(session.confirmChoice(id, option))
        },
        () => act(() => flow.pause()),
      )
    }
    case "result": {
      const result = snapshot!.result!
      const win = result.outcome === "win"
      const title = win ? `守住了${name}` : "前哨失守"
      const description = win
        ? `完成 ${snapshot!.wave.total} 波来袭。确认后保存本地进度。`
        : "护盾已经耗尽。返回选关后可以重试。"
      const resultPanel = dialog(title, description)
      if (run.saveFailed) {
        const alert = document.createElement("p")
        alert.className = "save-alert"
        alert.setAttribute("role", "alert")
        alert.textContent = "无法写入本地进度。可以重试，或仅在当前打开的页面保留通关。"
        resultPanel.panel.insertBefore(alert, resultPanel.actions)
        resultPanel.actions.append(
          button("仅本次保留", () => act(() => flow.returnWithoutSave(runId, result.id))),
        )
      }
      resultPanel.actions.append(
        button(run.saveFailed ? "重试保存" : "返回选关", () => act(() => flow.confirmResult(runId, result.id)), "primary"),
      )
      return resultPanel.panel
    }
    default:
      return undefined
  }
}

flow.ready()
app.replaceChildren(startingScreen(() => {
  audio.unlock()
  flow.start()
  showLevels()
}))
observeVisibility(hidden => {
  flow.setHidden(hidden)
  audio.setPaused(hidden || flow.panel === "paused" || flow.panel === "exit")
  sync()
})
window.addEventListener("storage", event => {
  if (flow.page === "select" && (!event.key || event.key.startsWith(PROGRESS_NAMESPACE))) showLevels()
})
window.addEventListener("keydown", event => {
  if (event.key !== "Escape") return
  if (flow.panel === "exit") act(() => flow.cancelExit())
  else if (flow.panel === "paused") act(() => flow.resume())
  else if (flow.panel === "battle" || flow.panel === "choice") act(() => flow.pause())
})

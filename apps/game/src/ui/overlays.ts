import { UPGRADES } from "../battle/model.ts"
import type { BattleSnapshot, Upgrade } from "../battle/model.ts"
import { button } from "./elements.ts"

export function dialog(title: string, description: string) {
  const panel = document.createElement("section")
  panel.className = "dialog-card"
  panel.setAttribute("role", "dialog")
  panel.setAttribute("aria-modal", "true")
  panel.setAttribute("aria-labelledby", "dialog-title")

  const heading = document.createElement("h2")
  heading.id = "dialog-title"
  heading.textContent = title
  const lead = document.createElement("p")
  lead.className = "dialog-lead"
  lead.textContent = description
  const actions = document.createElement("footer")
  actions.className = "dialog-actions"
  panel.append(heading, lead, actions)
  return { panel, actions }
}

export function choiceDialog(
  snapshot: BattleSnapshot,
  initialOption: Upgrade | undefined,
  remember: (id: string, upgrade: Upgrade) => void,
  confirm: (id: string, upgrade: Upgrade) => void,
  pause: () => void,
) {
  const choice = snapshot.choice!
  const { panel, actions } = dialog("选择升级", "前哨已暂停。选好一项，再确认继续防守。")
  const list = document.createElement("div")
  list.className = "upgrade-list"
  let selected = initialOption
  const confirmButton = button("确认升级", () => {
    if (selected) confirm(choice.id, selected)
  }, "primary")
  confirmButton.disabled = !selected
  const cards: HTMLButtonElement[] = []
  for (const upgrade of choice.options) {
    const details = UPGRADES[upgrade]
    const card = button("", () => {
      selected = upgrade
      remember(choice.id, upgrade)
      for (const option of cards) option.setAttribute("aria-pressed", String(option === card))
      confirmButton.disabled = false
    }, "upgrade-card")
    const name = document.createElement("strong")
    name.textContent = details.name
    const description = document.createElement("span")
    description.textContent = upgrade === "repair" && snapshot.defense.current === snapshot.defense.max
      ? "立即修复 2 点护盾。当前护盾已满。"
      : details.description
    card.setAttribute("aria-pressed", String(selected === upgrade))
    card.append(name, description)
    list.append(card)
    cards.push(card)
  }
  panel.insertBefore(list, actions)
  actions.append(button("暂停", pause), confirmButton)
  return panel
}

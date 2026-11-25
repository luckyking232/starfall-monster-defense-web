export function button(label: string, action: () => void, className = "secondary") {
  const element = document.createElement("button")
  element.type = "button"
  element.className = className
  element.textContent = label
  element.addEventListener("click", action)
  return element
}

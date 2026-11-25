export function observeVisibility(onChange: (hidden: boolean) => void) {
  const update = () => onChange(document.hidden)
  document.addEventListener("visibilitychange", update)
  window.addEventListener("pagehide", () => onChange(true))
  window.addEventListener("pageshow", update)
  update()
}

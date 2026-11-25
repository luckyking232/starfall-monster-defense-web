const STEP_MS = 50
const MAX_FRAME_MS = 250

export class FixedClock {
  #previous: number | undefined
  #remaining = 0

  reset() {
    this.#previous = undefined
    this.#remaining = 0
  }

  steps(now: number, active: boolean, speed: 1 | 2) {
    if (!active) {
      this.reset()
      return 0
    }

    const previous = this.#previous
    this.#previous = now
    if (previous === undefined) return 0

    const elapsed = Math.max(0, Math.min(MAX_FRAME_MS, now - previous))
    this.#remaining += elapsed * speed
    const steps = Math.floor(this.#remaining / STEP_MS)
    this.#remaining -= steps * STEP_MS
    return steps
  }
}

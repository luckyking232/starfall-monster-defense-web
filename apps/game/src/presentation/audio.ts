export class GameAudio {
  #context: AudioContext | undefined
  #paused = false

  unlock() {
    if (!window.AudioContext) return
    try {
      this.#context ??= new AudioContext()
      if (!this.#paused) {
        void this.#context.resume().then(() => this.signal(430)).catch(() => undefined)
      }
    } catch {
      // Silent play remains available on hosts that block audio.
    }
  }

  setPaused(paused: boolean) {
    if (this.#paused === paused) return
    this.#paused = paused
    const context = this.#context
    if (context) {
      void (paused ? context.suspend() : context.resume()).catch(() => undefined)
    }
  }

  signal(frequency: number, duration = 0.11) {
    const context = this.#context
    if (!context || this.#paused || context.state !== "running") return

    const when = context.currentTime
    const tone = context.createOscillator()
    const level = context.createGain()
    tone.frequency.value = frequency
    level.gain.setValueAtTime(0.032, when)
    level.gain.exponentialRampToValueAtTime(0.001, when + duration)
    tone.connect(level).connect(context.destination)
    tone.start(when)
    tone.stop(when + duration)
  }
}

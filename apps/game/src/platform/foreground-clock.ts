import { RULES_FPS } from '../engine/protocol';

// At 1x a display batch admits at most two original rule steps (four at 2x).
const MAX_BATCH_MS = 2 * 1000 / RULES_FPS;

interface Span {
  from: number;
  to: number;
  timeScale: number;
}

interface ForegroundBatch {
  milliseconds: number;
  timeScale?: number;
}

// Feed the original 30 Hz simulation small wall-time batches without throwing
// away active foreground time when the browser misses a refresh.
export class ForegroundClock {
  private last: number | null = null;
  private readonly owed: Span[] = [];
  private timeScale = 1;

  reset(now: number): void {
    this.last = now;
    this.owed.length = 0;
  }

  suspend(now: number, simulating = true): void {
    if (this.last !== null && simulating) this.add(this.last, now);
    this.last = null;
  }

  resume(now: number): void {
    this.last = now;
  }

  setTimeScale(now: number, timeScale: number, simulating = true): void {
    if (timeScale <= 0 || timeScale === this.timeScale) return;
    if (this.last !== null && now >= this.last) {
      if (simulating) this.add(this.last, now);
      this.last = now;
    } else {
      // The Worker can report its effective timestamp after a main-thread refresh.
      // Correct the unpaid part of any span that crossed the reported boundary.
      const crossing = this.owed.findIndex(span => span.to > now);
      if (crossing !== -1) {
        const span = this.owed[crossing]!;
        if (span.from < now) {
          this.owed.splice(crossing + 1, 0, { from: now, to: span.to, timeScale });
          span.to = now;
        }
        for (let index = crossing; index < this.owed.length; index++) {
          const span = this.owed[index]!;
          if (span.from >= now) span.timeScale = timeScale;
        }
      }
    }
    this.timeScale = timeScale;
  }

  private add(from: number, to: number): void {
    if (from >= to) return;
    const last = this.owed.at(-1);
    if (last?.to === from && last.timeScale === this.timeScale) last.to = to;
    else this.owed.push({ from, to, timeScale: this.timeScale });
  }

  take(now: number, simulating = true): ForegroundBatch {
    const previous = this.last;
    const elapsedSinceCall = this.last === null ? 0 : Math.max(0, now - this.last);
    this.last = Math.max(this.last ?? now, now);
    // Native pause/choice windows still run UI timers. Their elapsed time must
    // neither consume the outstanding combat time nor accumulate new combat debt.
    if (!simulating) return { milliseconds: Math.min(elapsedSinceCall, 250) };
    if (previous !== null) this.add(previous, this.last);
    const next = this.owed[0];
    if (!next) return { milliseconds: 0 };
    const milliseconds = Math.min(next.to - next.from, MAX_BATCH_MS);
    next.from += milliseconds;
    if (next.from >= next.to) this.owed.shift();
    return next.timeScale === this.timeScale ? { milliseconds } : { milliseconds, timeScale: next.timeScale };
  }
}

import { RULES_FPS } from '../engine/protocol';

// At 1x a display batch admits at most two original rule steps (four at 2x).
const MAX_BATCH_MS = 2 * 1000 / RULES_FPS;

// Feed the original 30 Hz simulation small wall-time batches without throwing
// away active foreground time when the browser misses a refresh.
export class ForegroundClock {
  private last: number | null = null;
  private owed = 0;

  reset(now: number): void {
    this.last = now;
    this.owed = 0;
  }

  suspend(now: number, simulating = true): void {
    if (this.last !== null && simulating) this.owed += Math.max(0, now - this.last);
    this.last = null;
  }

  resume(now: number): void {
    this.last = now;
  }

  take(now: number, simulating = true): number {
    const elapsedSinceCall = this.last === null ? 0 : Math.max(0, now - this.last);
    this.last = Math.max(this.last ?? now, now);
    // Native pause/choice windows still run UI timers. Their elapsed time must
    // neither consume the outstanding combat time nor accumulate new combat debt.
    if (!simulating) return Math.min(elapsedSinceCall, 250);
    this.owed += elapsedSinceCall;
    const elapsed = Math.min(this.owed, MAX_BATCH_MS);
    this.owed -= elapsed;
    return elapsed;
  }
}

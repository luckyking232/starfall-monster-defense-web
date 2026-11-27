export interface StressCounts {
  readonly opponents: number;
  readonly projectiles: number;
  readonly effects: number;
  /** Original HUD damage popups added since the preceding world submission. */
  readonly hurtNumbers: number;
}

export interface StressConfig {
  readonly renderer: string;
  readonly width: number;
  readonly height: number;
  readonly speed: number;
}

export interface StressSecond {
  readonly fps: number;
  readonly frames: number;
  readonly startMs: number;
  readonly durationMs: number;
  readonly counts: StressCounts;
  readonly config: StressConfig;
}

export interface StressSummary {
  readonly activeMs: number;
  readonly intervals: number;
  readonly p95Ms: number | null;
  readonly p99Ms: number | null;
  readonly maxGapMs: number | null;
  readonly maxUnfinishedGapMs: number | null;
  readonly gapsOver100Ms: number;
  readonly stallsOver1s: number;
  readonly latestCounts: StressCounts | null;
  readonly latestConfig: StressConfig | null;
  readonly worstSecond: StressSecond | null;
  readonly latestSecond: StressSecond | null;
  readonly partialSecond: StressSecond | null;
}

const SECOND = 1000;
const LONG_GAP_BUCKETS = 2048;
const LONG_GAP_LOG_STEP = Math.log1p(0.01);

/** Measures wall time between world submissions within uninterrupted visible battle segments. */
export class StressMetrics {
  private readonly bucketCounts = new Uint32Array(SECOND + LONG_GAP_BUCKETS + 1);
  private readonly bucketMaxima = new Float64Array(this.bucketCounts.length);
  private readonly windowCounts = { opponents: 0, projectiles: 0, effects: 0, hurtNumbers: 0 };
  private lastTime: number | undefined;
  private lastCounts: StressCounts | null = null;
  private config: StressConfig | null = null;
  private elapsed = 0;
  private intervals = 0;
  private maxGap = 0;
  private maxUnfinishedGap = 0;
  private gapsOver100 = 0;
  private stalls = 0;
  private windowStart = 0;
  private windowStartTime = 0;
  private windowFrames = 0;
  private latest: StressSecond | null = null;
  private worst: StressSecond | null = null;
  private interruptedPartial: StressSecond | null = null;

  interrupt(at?: number): void {
    if (this.lastTime === undefined) return;
    const end = Math.max(this.lastTime, at ?? this.lastTime);
    const unfinishedGap = end - this.lastTime;
    this.elapsed += unfinishedGap;
    this.maxUnfinishedGap = Math.max(this.maxUnfinishedGap, unfinishedGap);
    const boundary = this.windowStartTime + SECOND;
    if (end >= boundary) this.finishSeconds(1 + Math.floor((end - boundary) / SECOND));
    this.interruptedPartial = this.partial(end);
    this.lastTime = undefined;
  }

  rendered(time: number, counts: StressCounts, config: StressConfig): void {
    const previousConfig = this.config;
    if (previousConfig?.renderer !== config.renderer || previousConfig.width !== config.width ||
        previousConfig.height !== config.height || previousConfig.speed !== config.speed) {
      this.interrupt();
      this.config = { ...config };
    }
    if (this.lastTime === undefined) {
      this.lastTime = time;
      this.lastCounts = counts;
      this.interruptedPartial = null;
      this.windowStart = this.elapsed;
      this.windowStartTime = time;
      this.clearWindow();
      return;
    }
    if (time <= this.lastTime) return;
    const gap = time - this.lastTime;
    this.elapsed += gap;
    this.intervals++;
    this.maxGap = Math.max(this.maxGap, gap);
    if (gap > 100) this.gapsOver100++;
    if (gap > SECOND) this.stalls++;
    // Resolve gaps up to one second to 1 ms and longer gaps to approximately 1%.
    const bucket = gap <= SECOND ? Math.ceil(gap) : SECOND +
      Math.min(LONG_GAP_BUCKETS, Math.ceil(Math.log(gap / SECOND) / LONG_GAP_LOG_STEP));
    this.bucketCounts[bucket] = this.bucketCounts[bucket]! + 1;
    this.bucketMaxima[bucket] = Math.max(this.bucketMaxima[bucket]!, gap);

    const boundary = this.windowStartTime + SECOND;
    if (time > boundary) this.finishSeconds(Math.ceil((time - boundary) / SECOND));
    this.windowFrames++;
    this.windowCounts.opponents = Math.max(this.windowCounts.opponents, counts.opponents);
    this.windowCounts.projectiles = Math.max(this.windowCounts.projectiles, counts.projectiles);
    this.windowCounts.effects = Math.max(this.windowCounts.effects, counts.effects);
    this.windowCounts.hurtNumbers += counts.hurtNumbers;
    if (time >= this.windowStartTime + SECOND) this.finishSecond();
    this.lastTime = time;
    this.lastCounts = counts;
  }

  summary(): StressSummary {
    const p95Rank = Math.ceil(this.intervals * 0.95);
    const p99Rank = Math.ceil(this.intervals * 0.99);
    let p95Ms: number | null = null;
    let p99Ms: number | null = null;
    let seen = 0;
    for (let bucket = 1; p99Rank > 0 && bucket < this.bucketCounts.length; bucket++) {
      seen += this.bucketCounts[bucket]!;
      if (p95Ms === null && seen >= p95Rank) p95Ms = this.bucketMaxima[bucket]!;
      if (seen >= p99Rank) {
        p99Ms = this.bucketMaxima[bucket]!;
        break;
      }
    }
    return {
      activeMs: this.elapsed, intervals: this.intervals, p95Ms, p99Ms,
      maxGapMs: this.intervals ? this.maxGap : null,
      maxUnfinishedGapMs: this.maxUnfinishedGap || null,
      gapsOver100Ms: this.gapsOver100, stallsOver1s: this.stalls,
      latestCounts: this.lastCounts ? { ...this.lastCounts } : null, latestConfig: this.config,
      worstSecond: this.worst, latestSecond: this.latest,
      partialSecond: this.lastTime === undefined ? this.interruptedPartial : this.partial(this.lastTime),
    };
  }

  private clearWindow(): void {
    this.windowFrames = 0;
    this.windowCounts.opponents = this.windowCounts.projectiles = this.windowCounts.effects = this.windowCounts.hurtNumbers = 0;
  }

  private sample(durationMs: number): StressSecond {
    return {
      fps: this.windowFrames * SECOND / durationMs, frames: this.windowFrames,
      startMs: this.windowStart, durationMs, config: this.config!,
      counts: this.windowFrames ? { ...this.windowCounts } : { ...this.lastCounts!, hurtNumbers: 0 },
    };
  }

  private partial(time: number): StressSecond | null {
    const duration = time - this.windowStartTime;
    return duration > 0 ? this.sample(duration) : null;
  }

  private advanceWindow(seconds: number): void {
    this.windowStart += seconds * SECOND;
    this.windowStartTime += seconds * SECOND;
  }

  private finishSecond(): void {
    const sample = this.sample(SECOND);
    this.latest = sample;
    if (!this.worst || sample.fps < this.worst.fps) this.worst = sample;
    this.advanceWindow(1);
    this.clearWindow();
  }

  private finishSeconds(count: number): void {
    this.finishSecond();
    if (count === 1) return;
    this.finishSecond();
    // After the first empty second, only the latest empty second can affect the report.
    if (count > 2) {
      this.advanceWindow(count - 3);
      this.finishSecond();
    }
  }
}

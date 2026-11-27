import { expect, it } from 'vitest';
import { StressMetrics } from '../../src/presentation/stress-metrics';

const config = { renderer: 'WebGL', width: 1334, height: 750, speed: 2 };
const counts = { opponents: 50, projectiles: 10, effects: 5, hurtNumbers: 2 };

it('leaves measurements empty until two frames have been submitted', () => {
  const metrics = new StressMetrics();
  expect(metrics.summary()).toMatchObject({
    activeMs: 0, intervals: 0, p95Ms: null, p99Ms: null, maxGapMs: null,
    worstSecond: null, partialSecond: null, latestConfig: null,
  });
  metrics.rendered(8000, counts, config);
  expect(metrics.summary()).toMatchObject({
    activeMs: 0, intervals: 0, worstSecond: null, partialSecond: null, latestConfig: config,
  });
});

it('does not report a partial second when the only timestamp has fractional milliseconds', () => {
  const metrics = new StressMetrics();
  metrics.rendered(0.3, counts, config);
  expect(metrics.summary().partialSecond).toBeNull();
});

it('counts actual completions in each fixed second and saves the associated load', () => {
  const metrics = new StressMetrics();
  for (let time = 0; time <= 1000; time += 20) metrics.rendered(time, counts, config);
  metrics.rendered(1250, { opponents: 51, projectiles: 20, effects: 7, hurtNumbers: 3 }, config);
  metrics.rendered(1500, { opponents: 59, projectiles: 19, effects: 8, hurtNumbers: 0 }, config);
  metrics.rendered(1750, { opponents: 56, projectiles: 17, effects: 7, hurtNumbers: 4 }, config);
  metrics.rendered(2000, { opponents: 58, projectiles: 17, effects: 9, hurtNumbers: 5 }, config);
  expect(metrics.summary()).toMatchObject({
    activeMs: 2000, intervals: 54, p95Ms: 250, p99Ms: 250, maxGapMs: 250,
    gapsOver100Ms: 4, stallsOver1s: 0, partialSecond: null,
    worstSecond: {
      fps: 4, frames: 4, startMs: 1000, durationMs: 1000,
      counts: { opponents: 59, projectiles: 20, effects: 9, hurtNumbers: 12 }, config,
    },
  });
});

it('keeps earlier intervals and excludes time across interruptions', () => {
  const metrics = new StressMetrics();
  for (const time of [10, 110, 1110]) metrics.rendered(time, counts, config);
  metrics.interrupt();
  metrics.interrupt();
  metrics.rendered(15000, counts, config);
  metrics.rendered(15020, counts, config);
  expect(metrics.summary()).toMatchObject({
    activeMs: 1120, intervals: 3, maxGapMs: 1000, gapsOver100Ms: 1, stallsOver1s: 0,
    worstSecond: { fps: 1, startMs: 0 },
    partialSecond: { fps: 50, startMs: 1100, durationMs: 20, frames: 1, counts },
  });
});

it('counts a foreground stall over one second and records an empty second', () => {
  const metrics = new StressMetrics();
  metrics.rendered(50, counts, config);
  metrics.rendered(3100, { ...counts, opponents: 20, hurtNumbers: 6 }, config);
  const result = metrics.summary();
  expect(result).toMatchObject({
    activeMs: 3050, intervals: 1, p95Ms: 3050, p99Ms: 3050, maxGapMs: 3050,
    gapsOver100Ms: 1, stallsOver1s: 1,
    worstSecond: { fps: 0, durationMs: 1000, startMs: 0, counts: { ...counts, hurtNumbers: 0 } },
    latestSecond: { fps: 0, durationMs: 1000, startMs: 2000 },
    partialSecond: { fps: 20, durationMs: 50, frames: 1, startMs: 3000, counts: { opponents: 20, hurtNumbers: 6 } },
  });
});

it('counts foreground time before interruption even when a stalled paint never completes', () => {
  const metrics = new StressMetrics();
  metrics.rendered(0, counts, config);
  metrics.rendered(16, counts, config);
  metrics.interrupt(3300);
  expect(metrics.summary()).toMatchObject({
    activeMs: 3300, intervals: 1, p95Ms: 16, p99Ms: 16, maxGapMs: 16,
    maxUnfinishedGapMs: 3284, gapsOver100Ms: 0, stallsOver1s: 0,
    worstSecond: { fps: 0, frames: 0, startMs: 1000, counts: { ...counts, hurtNumbers: 0 } },
    latestSecond: { fps: 0, startMs: 2000 },
    partialSecond: { fps: 0, frames: 0, startMs: 3000, durationMs: 300 },
  });
  metrics.interrupt(5000);
  metrics.rendered(9000, counts, config);
  metrics.rendered(9033, counts, config);
  expect(metrics.summary()).toMatchObject({
    activeMs: 3333, intervals: 2, maxGapMs: 33, maxUnfinishedGapMs: 3284,
    worstSecond: { fps: 0, startMs: 1000 },
    partialSecond: { startMs: 3300, durationMs: 33, frames: 1 },
  });
});

it('completes an empty second when interruption falls exactly on its boundary', () => {
  const metrics = new StressMetrics();
  metrics.rendered(0.3, counts, config);
  metrics.interrupt(1000.3);
  expect(metrics.summary()).toMatchObject({
    activeMs: 1000, intervals: 0, p95Ms: null, p99Ms: null, maxGapMs: null,
    maxUnfinishedGapMs: 1000, partialSecond: null,
    worstSecond: { fps: 0, frames: 0, startMs: 0, durationMs: 1000 },
  });
});

it('includes a short final sample in frame intervals and preserves its actual duration', () => {
  const metrics = new StressMetrics();
  for (const time of [0, 50, 100, 310]) metrics.rendered(time, counts, config);
  const result = metrics.summary();
  metrics.interrupt();
  expect(metrics.summary()).toEqual(result);
  expect(result).toMatchObject({
    activeMs: 310, intervals: 3, p95Ms: 210, worstSecond: null,
    partialSecond: { frames: 3, startMs: 0, durationMs: 310 },
  });
  expect(result.partialSecond?.fps).toBeCloseTo(3 * 1000 / 310);
});

it('keeps the configuration that produced the worst full second', () => {
  const metrics = new StressMetrics();
  for (const time of [0, 500, 1000]) metrics.rendered(time, counts, config);
  const changed = { renderer: 'Canvas', width: 667, height: 375, speed: 1 };
  for (let time = 2200; time <= 3200; time += 40) metrics.rendered(time, counts, changed);
  expect(metrics.summary()).toMatchObject({
    activeMs: 2000, intervals: 27, maxGapMs: 500, stallsOver1s: 0,
    latestConfig: changed, latestSecond: { fps: 25, startMs: 1000, config: changed },
    worstSecond: { fps: 2, startMs: 0, config },
  });
});

it('keeps early slow frames in session percentiles after thousands of further samples', () => {
  const metrics = new StressMetrics();
  metrics.rendered(0, counts, config);
  let time = 0;
  for (let index = 0; index < 110; index++) metrics.rendered(time += 121, counts, config);
  for (let index = 0; index < 9890; index++) metrics.rendered(time += 16.7, counts, config);
  const result = metrics.summary();
  expect(result).toMatchObject({ intervals: 10000, p99Ms: 121, gapsOver100Ms: 110 });
  expect(result.p95Ms).toBeCloseTo(16.7);
});

import {expect,test} from 'vitest';
import {ForegroundClock} from '../../src/platform/foreground-clock';

test('foreground time is conserved across short batches and a hidden interval starts a new segment',()=>{
  const clock=new ForegroundClock();
  clock.reset(100);
  expect(clock.take(116)).toEqual({milliseconds:16});
  const windows=Array.from({length:20},()=>clock.take(916).milliseconds);
  expect(windows.reduce((sum,ms)=>sum+ms,0)).toBeCloseTo(800);
  expect(Math.max(...windows)).toBeLessThanOrEqual(100);
  clock.take(1216);
  clock.reset(91216);
  expect(clock.take(91236)).toEqual({milliseconds:20});
});

test('closing settings keeps pre-existing foreground debt and excludes time in the modal',()=>{
  const clock=new ForegroundClock();
  clock.reset(100);
  const sent=clock.take(500).milliseconds;
  clock.suspend(510);
  clock.resume(2510);
  const rest=Array.from({length:10},()=>clock.take(2520).milliseconds);
  expect(sent+rest.reduce((a,b)=>a+b,0)).toBeCloseTo(420);
});

test('late speed notifications split unpaid foreground time at the effective timestamp', () => {
  const clock = new ForegroundClock();
  clock.reset(0);
  clock.setTimeScale(0, 2);
  const first = clock.take(400);
  clock.setTimeScale(350, 1);
  const after = Array.from({ length: 20 }, () => clock.take(600));
  const old = after.filter(batch => batch.timeScale === 2).reduce((sum, batch) => sum + batch.milliseconds, 0);
  const current = after.filter(batch => batch.timeScale === undefined).reduce((sum, batch) => sum + batch.milliseconds, 0);
  expect(first.milliseconds + old).toBeCloseTo(350);
  expect(current).toBeCloseTo(250);
  expect(after.findIndex(batch => batch.timeScale === undefined)).toBeGreaterThan(0);
});

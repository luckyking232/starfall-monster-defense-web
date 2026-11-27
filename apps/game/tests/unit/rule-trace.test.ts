import { expect, test } from 'vitest';
import { firstRuleDifference, type RuleRecord } from '../../scripts/lib/rule-trace-diff.ts';

const hit = (target: number) => ({ type: 'hit', object: 'bullet:7', target });
const fixed = (frame: number, details: Record<string, unknown> = {}): RuleRecord => ({
  kind: 'fixed', frame, ...details,
});

test('reports the first reversed hit in event order', () => {
  const reference = [fixed(1), fixed(2, { events: [hit(11), hit(12)] }), fixed(3)];
  const candidate = [fixed(1), fixed(2, { events: [hit(12), hit(11)] }), fixed(3)];
  expect(firstRuleDifference(reference, candidate)).toMatchObject({
    frame: 2, object: 'bullet:7', field: 'events[0].target', reference: 11, candidate: 12,
  });
});

test('reports a missing or extra fixed frame', () => {
  const reference = [fixed(1), fixed(2), fixed(3)];
  expect(firstRuleDifference(reference, [fixed(1), fixed(3)])).toMatchObject({
    frame: 2, field: 'frame', reference: 2, candidate: 3,
  });
  expect(firstRuleDifference(reference, [...reference, fixed(4)])).toMatchObject({
    frame: 4, field: 'record', reference: null, candidate: fixed(4),
  });
});

test('reports the stable identity and field of the first different state object', () => {
  const reference = [fixed(1, { units: [{ uid: 15, x: 300, hp: 49 }] })];
  const candidate = [fixed(1, { units: [{ uid: 15, x: 300, hp: 48 }] })];
  expect(firstRuleDifference(reference, candidate)).toMatchObject({
    frame: 1, object: 'unit:15', field: 'units[0].hp', reference: 49, candidate: 48,
  });
});

test('accepts equivalent state regardless of property insertion order', () => {
  expect(firstRuleDifference(
    [fixed(1, { units: [{ uid: 15, x: 300, hp: 49 }] })],
    [fixed(1, { units: [{ hp: 49, x: 300, uid: 15 }] })],
  )).toBeNull();
});

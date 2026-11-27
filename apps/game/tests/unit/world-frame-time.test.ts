import {expect,it} from 'vitest';
import { WorldFrameTime } from '../../src/presentation/world-frame-time';
it('measures consecutive rendered world frames, and excludes time spent suspended',() => {
  const timing = new WorldFrameTime();
  for (const time of [0,20,40,60,180]) timing.rendered(time);
  expect(timing.summary()).toEqual({fps:22,p95:120,slow:1});
  timing.reset();
  timing.rendered(5000);
  expect(timing.summary()).toBeNull();
  timing.rendered(5033);
  expect(timing.summary()).toEqual({fps:30,p95:33,slow:0});
});

import {expect,it} from 'vitest';
import { StressSession } from '../../src/presentation/stress-session';
import type { RuleState } from '../../src/engine/protocol';

const state = {fixedFrame:1,paused:false,speedIndex:2,units:[{camp:1},{camp:2},{camp:2}],bullets:[{}],effects:[{},{}]} as RuleState;
const config = {renderer:'canvas',width:1334,height:750,speed:2};
it('includes the actual game time advanced between submitted foreground frames in the saved report',()=>{
  const run = new StressSession();
  run.begin();
  run.rendered(100,state,config);
  run.rendered(120,{...state,fixedFrame:31},config);
  run.interrupt(122);
  run.rendered(10000,{...state,fixedFrame:38},config);
  run.rendered(10020,{...state,fixedFrame:53},config);
  run.end(10020);
  expect(run.summary()).toMatchObject({gameSeconds:1.5});
});
it('measures only the requested battle and keeps its report through normal games', () => {
  const run = new StressSession();
  run.rendered(1,state,config);
  expect(run.summary()).toBeNull();
  run.begin();
  run.rendered(100,state,config);
  run.rendered(131,state,config);
  run.interrupt();
  run.rendered(9000,state,config);
  run.rendered(9035,state,config);
  run.end();
  expect(run.summary()).toMatchObject({intervals:2,maxGapMs:35,latestCounts:{opponents:2,projectiles:1,effects:2}});
  run.rendered(15000,state,config);
  run.end();
  expect(run.summary()?.intervals).toBe(2);
  run.begin();
  expect(run.summary()?.intervals).toBe(0);
});

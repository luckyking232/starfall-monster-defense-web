import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chooserGesture} from '../packages/ui/input/chooser-gesture.mjs';

function mock(width = 667) {
  const rect = {left: 23, top: 40, width, height: width * 750 / 1334};
  const state = {owner: {}, phase: 'chooser', pending: false, scroll: 100};
  const calls = [];
  const gesture = chooserGesture({read: () => state, setScroll: x => calls.push(x),
    point: (x,y,r) => ({x:(x-r.left)*1334/r.width, y:(y-r.top)*750/r.height})});
  const e = (dx = 0,dy = 0,extra = {}) => ({isPrimary: true, pointerId: 1, button: 0,
    clientX: rect.left+rect.width/2+dx, clientY: rect.top+rect.height/2+dy, ...extra});
  return {rect,state,calls,gesture,e};
}

test('tap resolves to one canonical center across portrait and landscape widths', () => {
  for (const width of [324,675,936]) {
    const {rect,gesture,e} = mock(width);
    assert.equal(gesture.begin(e(),rect),true);
    const result = gesture.end(e(),rect);
    assert.equal(result.kind,'tap');
    assert.ok(Math.abs(result.x - 667) < 1e-9);
    assert.ok(Math.abs(result.y - 375) < 1e-9);
  }
});

test('only horizontal drag requests scroll; releasing does not select a stage', () => {
  const {rect,gesture,e,calls} = mock();
  gesture.begin(e(),rect);
  assert.equal(gesture.move(e(-36,3),rect),'drag');
  assert.deepEqual(calls,[172]);
  assert.deepEqual(gesture.end(e(-36,3),rect),{kind:'ignored'});
  calls.length=0;
  gesture.begin(e(),rect);
  assert.equal(gesture.move(e(3,31),rect),'scroll-page');
  assert.deepEqual(gesture.end(e(3,31),rect),{kind:'ignored'});
  assert.deepEqual(calls,[]);
});

test('cancellation, session replacement, resizing, pending and other touches cannot leak clicks', () => {
  const {rect,gesture,e,state} = mock();
  gesture.begin(e(),rect);
  assert.equal(gesture.move(e(50,0,{pointerId:2,isPrimary:false}),rect),'none');
  gesture.cancel(1);
  assert.equal(gesture.end(e(),rect).kind,'ignored');
  gesture.begin(e(),rect);
  state.owner = {};
  assert.equal(gesture.end(e(),rect).kind,'ignored');
  gesture.begin(e(),rect);
  assert.equal(gesture.end(e(),{...rect,width:rect.width+10}).kind,'ignored');
  state.pending=true;
  assert.equal(gesture.begin(e(),rect),false);
  state.pending=false;
  assert.equal(gesture.begin(e(0,0,{button:2}),rect),false);
  gesture.begin(e(0,0,{clientX:rect.left-0.5}),rect);
  assert.equal(gesture.end(e(0,0,{clientX:rect.left-0.5}),rect).kind,'ignored');
});

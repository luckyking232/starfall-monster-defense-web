/** Synthetic transport test only; no original rules, scripts or game assets. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {makeStage1Client, STAGE1_PROTOCOL} from './client.mjs';

class ProtocolFixture {
  static active;
  messages = [];
  listeners = new Map();
  constructor() { ProtocolFixture.active = this; }
  addEventListener(event, cb) { this.listeners.set(event, cb); }
  postMessage(data) { this.messages.push(data); }
  emit(request, body) {
    this.listeners.get('message')({data:{protocol: STAGE1_PROTOCOL,
      requestId:request.requestId,runId:request.runId,...body}});
  }
  terminate() {}
}
test('keeps current session, separates wall/step commands, rejects stale requests', async () => {
  const c = makeStage1Client({WorkerClass:ProtocolFixture});
  const w = ProtocolFixture.active;
  const input = {tape:Array(50).fill(101),globalRngSeeds:[7,13]};
  await assert.rejects(c.stepFixed(1),{code:'session-not-open'});
  const old = assert.rejects(c.start(input),{code:'stale-session'});
  const req1 = w.messages.at(-1);
  const fresh = c.start(input);
  const req2 = w.messages.at(-1);
  await old;
  w.emit(req1,{type:'ready',state:{fixedFrame:999}});
  assert.equal(c.lastState,null);
  w.emit(req2,{type:'ready',state:{fixedFrame:0}});
  await fresh;
  const wall = c.advanceUnscaled(5), tick = c.stepFixed(2);
  const [wallReq,tickReq] = w.messages.slice(-2);
  assert.equal(wallReq.type,'advance-unscaled');
  assert.equal(tickReq.type,'step-fixed');
  w.emit(wallReq,{type:'state',state:{fixedFrame:0}});
  w.emit(tickReq,{type:'state',state:{fixedFrame:2}});
  await Promise.all([wall,tick]);
  assert.equal(c.lastState.fixedFrame,2);
  c.dispose();
  await assert.rejects(c.snapshot(),{code:'closed-client'});
});

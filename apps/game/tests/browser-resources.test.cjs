const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { createBrowserResourcesProbe } = require('../scripts/lib/browser-resources.cjs');

function fixture() {
  const calls = [];
  const page = new EventEmitter();
  const cdp = new EventEmitter();
  const workerUrl = 'http://127.0.0.1/assets/ui-host-worker.js';
  const heap = { usedSize: 8192, totalSize: 16384, backingStorageSize: 131072 };
  const target = (targetId, url, browserContextId) => ({ targetId, url, browserContextId, type: 'worker' });
  page.workers = () => [{ url: () => workerUrl }];
  page.context = () => ({newCDPSession: async () => cdp});
  cdp.detach = async () => calls.push('detached-page');
  const resources = (method, params) => {
    if (method === 'Runtime.getHeapUsage') return heap;
    if (method === 'Runtime.evaluate') {
      return { result: params.expression.includes('AudioBuffer') ? {} : {objectId: 'prototype'} };
    }
    if (method === 'Runtime.queryObjects') return {objects: {objectId: 'objects'}};
    if (method === 'Runtime.callFunctionOn') {
      return {result: {value: params.functionDeclaration.includes('buffer.byteLength')
        ? {count: 1, capacitiesBytes: [131072], totalCapacityBytes: 131072} : 2}};
    }
    return {};
  };
  cdp.send = async (method, params) => {
    calls.push(method);
    if (method === 'Target.getTargetInfo') return {targetInfo: {browserContextId: 'our-context'}};
    if (method === 'Target.getTargets') return {targetInfos: [target('game-worker', workerUrl, 'our-context'),
      target('another-worker', workerUrl, 'unrelated-context')]};
    if (method === 'Target.attachToTarget') {
      assert.equal(params.targetId, 'game-worker');
      return {sessionId: 'game-session'};
    }
    if (method === 'Target.sendMessageToTarget') {
      assert.equal(params.sessionId, 'game-session');
      const request = JSON.parse(params.message);
      cdp.emit('Target.receivedMessageFromTarget', {sessionId: 'wrong-session', message: '{"id":1,"result":null}'});
      cdp.emit('Target.receivedMessageFromTarget', {sessionId: 'game-session', message: JSON.stringify({
        id: request.id, result: resources(request.method, request.params),
      })});
      return {};
    }
    return resources(method, params);
  };
  return {page, cdp, heap, calls};
}

test('reports main and page-owned worker resources, pending requests and unexposed PCM', async () => {
  const {page, cdp, heap, calls} = fixture();
  const probe = createBrowserResourcesProbe(page);
  const finished = {}, pending = {};
  page.emit('request', finished);
  page.emit('request', pending);
  page.emit('requestfinished', finished);
  const result = await probe.sample('paused', {inventory: true});
  assert.deepEqual(result.main.heap, heap);
  assert.equal(result.main.wasmLinearMemory.totalCapacityBytes, 131072);
  assert.equal(result.main.decodedPcm, null);
  assert.equal(result.main.webGlHandles.WebGLTexture, 2);
  assert.equal(result.pendingPageRequests, 1);
  assert.equal(result.workers.length, 1);
  assert.deepEqual(result.workers[0].heap, heap);
  assert.deepEqual(result.workers[0].wasmLinearMemory.capacitiesBytes, [131072]);
  assert(calls.includes('Runtime.releaseObjectGroup'));
  assert(calls.includes('Target.detachFromTarget'));
  assert.equal(cdp.listenerCount('Target.receivedMessageFromTarget'), 0);
  probe.close();
  assert.equal(page.listenerCount('request'), 0);
});

test('keeps cheap samples free of inventory queries, and represents a missing worker explicitly', async () => {
  const {page, calls} = fixture();
  page.workers = () => [];
  const probe = createBrowserResourcesProbe(page);
  const result = await probe.sample('after-exit');
  assert.deepEqual(result.workers, []);
  assert.equal(result.visibleDedicatedWorkers, 0);
  assert.equal(result.main.wasmLinearMemory, undefined);
  assert(!calls.includes('Runtime.queryObjects'));
  assert(!calls.includes('Target.attachToTarget'));
  probe.close();
});

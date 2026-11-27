const PROTOCOL_TIMEOUT_MS = 5000;
const GL_CLASSES = ['WebGLTexture', 'WebGLBuffer', 'WebGLFramebuffer', 'WebGLRenderbuffer', 'WebGLProgram', 'WebGLShader'];
const resourceMeasurement = {
  heap: 'Runtime.getHeapUsage reports bytes for each target\'s V8 isolate. Backing-storage bytes are a separate field.',
  inventory: 'Inventory checkpoints request garbage collection, then inspect reachable objects through CDP. Timing in this resource run includes the probes.',
  wasm: 'WebAssembly.Memory buffer capacity in bytes per reachable JavaScript memory object. Capacities can remain high after Lua frees objects in a reused heap.',
  pcm: 'Float32 sample capacity of reachable AudioBuffer objects in the page. Does not measure browser audio-process or driver memory.',
  webGl: 'Reachable JavaScript handles of the listed classes, including deleted handles still referenced in JavaScript. Driver object allocation and GPU memory bytes are unavailable.',
  pendingPageRequests: 'Playwright page request events minus finished or failed events. Worker-only network requests may be outside this scope.',
};

async function bounded(operation, context) {
  let timer;
  try {
    return await Promise.race([operation(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${context} timed out`)), PROTOCOL_TIMEOUT_MS);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

async function diagnostic(errors, name, operation) {
  try {
    return await operation();
  } catch (error) {
    errors[name] = error instanceof Error ? error.message : String(error);
    return null;
  }
}

async function queryInventory(send, key, prototype, summarise) {
  const objectGroup = `starfall-resources-${key}`;
  try {
    const { result } = await send('Runtime.evaluate', { expression: prototype, objectGroup, silent: true });
    if (!result.objectId) throw new Error(`Prototype unavailable in this context: ${key}`);
    const { objects } = await send('Runtime.queryObjects', { prototypeObjectId: result.objectId, objectGroup });
    const response = await send('Runtime.callFunctionOn', {
      objectId: objects.objectId, functionDeclaration: String(summarise), returnByValue: true, silent: true,
    });
    if (response.exceptionDetails || response.result.value === undefined) throw new Error(`Object inventory unavailable: ${key}`);
    return response.result.value;
  } finally {
    await send('Runtime.releaseObjectGroup', { objectGroup });
  }
}

async function probeTarget(send, main, inventory) {
  const errors = {};
  const result = { errors, heap: await diagnostic(errors, 'heap', () => send('Runtime.getHeapUsage', {})) };
  if (!inventory) return result;

  await diagnostic(errors, 'gc', () => send('HeapProfiler.collectGarbage', {}));
  result.wasmLinearMemory = await diagnostic(errors, 'wasm', () => queryInventory(send, 'wasm',
    'typeof WebAssembly === "object" ? WebAssembly.Memory.prototype : null', function() {
      const capacitiesBytes = this.map(memory => memory.buffer.byteLength).sort((a, b) => a - b);
      return { count: capacitiesBytes.length, capacitiesBytes,
        totalCapacityBytes: capacitiesBytes.reduce((sum, capacity) => sum + capacity, 0) };
    }));

  if (main) {
    result.decodedPcm = await diagnostic(errors, 'pcm', () => queryInventory(send, 'pcm',
      'typeof AudioBuffer === "function" ? AudioBuffer.prototype : null', function() {
        return { count: this.length, totalCapacityBytes: this.reduce((sum, buffer) =>
          sum + buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT, 0) };
      }));
    result.webGlHandles = {};
    for (const name of GL_CLASSES) {
      result.webGlHandles[name] = await diagnostic(errors, name, () => queryInventory(send, name,
        `typeof ${name} === "function" ? ${name}.prototype : null`, function() { return this.length; }));
    }
  }
  result.heapAfterInventory = await diagnostic(errors, 'heapAfterInventory', () => send('Runtime.getHeapUsage', {}));
  return result;
}

async function probeWorker(cdp, send, target, inventory) {
  // Playwright exposes a page session, and the page can open a nested session
  // for the selected dedicated worker without pausing or replacing its script.
  const { sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: false });
  const pending = new Map();
  let nextId = 0;
  const receive = event => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message);
    const call = pending.get(message.id);
    if (!call) return;
    if (message.error) call.reject(new Error(message.error.message));
    else call.resolve(message.result);
  };
  cdp.on('Target.receivedMessageFromTarget', receive);
  try {
    const workerSend = async (method, params) => {
      const id = ++nextId;
      try {
        return await bounded(() => new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject });
          send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }).catch(reject);
        }), method);
      } finally {
        pending.delete(id);
      }
    };
    return await probeTarget(workerSend, false, inventory);
  } finally {
    cdp.off('Target.receivedMessageFromTarget', receive);
    await send('Target.detachFromTarget', { sessionId });
  }
}

function createBrowserResourcesProbe(page) {
  const pendingRequests = new Set();
  const onRequest = request => pendingRequests.add(request);
  const onComplete = request => pendingRequests.delete(request);
  page.on('request', onRequest);
  page.on('requestfinished', onComplete);
  page.on('requestfailed', onComplete);

  return {
    async sample(label, {inventory = false} = {}) {
      const start = performance.now();
      const workerUrls = page.workers().map(worker => worker.url());
      const sample = { label, utc: new Date().toISOString(), inventory, pendingPageRequests: pendingRequests.size,
        visibleDedicatedWorkers: workerUrls.length, main: null, workers: [], errors: {} };
      const cdp = await diagnostic(sample.errors, 'session', () => bounded(
        () => page.context().newCDPSession(page), 'page CDP session'));
      if (!cdp) return sample;
      const send = (method, params) => bounded(() => cdp.send(method, params), method);
      try {
        sample.main = await probeTarget(send, true, inventory);
        if (!workerUrls.length) return sample;
        const targets = await diagnostic(sample.errors, 'workerDiscovery', async () => {
          const { targetInfo } = await send('Target.getTargetInfo', {});
          const { targetInfos } = await send('Target.getTargets', {});
          return targetInfos.filter(target => target.type === 'worker' && workerUrls.includes(target.url)
            && (!targetInfo.browserContextId || target.browserContextId === targetInfo.browserContextId));
        });
        if (!targets) return sample;
        if (targets.length !== workerUrls.length) sample.errors.workerCoverage = `Found ${targets.length} matching CDP targets for ${workerUrls.length} workers`;
        for (const target of targets) {
          const metrics = await diagnostic(sample.errors, `worker-${target.targetId}`, () => probeWorker(cdp, send, target, inventory));
          sample.workers.push({ id: target.targetId, url: target.url, ...metrics });
        }
        return sample;
      } finally {
        await diagnostic(sample.errors, 'detach', () => bounded(() => cdp.detach(), 'detach page CDP session'));
        sample.probeWallMs = performance.now() - start;
      }
    },
    close() {
      page.off('request', onRequest);
      page.off('requestfinished', onComplete);
      page.off('requestfailed', onComplete);
      pendingRequests.clear();
    },
  };
}

module.exports = { createBrowserResourcesProbe, resourceMeasurement };

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');
const { parseArgs } = require('node:util');

const seed = 70441022;
const stage = 78000021;
const viewport = { width: 1334, height: 750 };
const hudWindow = 'MiniGameBattleUIWindow';
const hudLabel = '魔物抵御战战场';
const pauseLabel = '战斗暂停';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.gz': 'application/gzip', '.wasm': 'application/wasm', '.png': 'image/png', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.lua': 'text/plain' };

const workerShim = Buffer.from(`
const pausePost = self.postMessage.bind(self);
self.postMessage = (data, ...args) => {
  if (data?.type === 'open' && data.window === 'MiniGameBattlePauseWindow' ||
      data?.type === 'event' && data.event.name === 'world' && data.event.state.paused) {
    data = {...data, pauseProbeEmittedAt: performance.timeOrigin + performance.now()};
  }
  return pausePost(data, ...args);
};
const originalPauseSeed = crypto.getRandomValues.bind(crypto);
crypto.getRandomValues = array => {
  if (array instanceof Uint32Array && array.length === 1) {
    array[0] = ${seed};
    pausePost({type:'pause-probe-seed', value:array[0]});
    return array;
  }
  return originalPauseSeed(array);
};
`);

function inputs(values) {
  const { dist: dir, label, 'expect-commit': expectedCommit, 'expect-tree': expectedTree } = values;
  const count = Number(values.samples);
  const first = Number(values['first-frame']);
  const last = Number(values['last-frame']);
  assert(dir && /^[a-z0-9-]+$/.test(label ?? '') && /^[a-f0-9]{40}$/.test(expectedCommit ?? ''), 'Supply --dist, --label and exact --expect-commit');
  assert(Number.isSafeInteger(count) && count >= 20, 'Require at least 20 complete pause samples');
  assert(Number.isSafeInteger(first) && Number.isSafeInteger(last) && first >= 900 && (last - first) / (count + 1) >= 30,
    'Require a game-frame window large enough to separate samples');
  const dist = path.resolve(dir);
  const manifest = json(path.join(dist, 'version.json'));
  assert.equal(manifest.commit, expectedCommit, 'Unexpected release commit');
  if (expectedTree) assert.equal(manifest.tree, expectedTree, 'Unexpected release tree');
  const inventory = fs.readFileSync(path.join(dist, 'asset-inventory.json'));
  const files = JSON.parse(inventory).files;
  const workers = Object.keys(files).filter(file => /^assets\/release-[a-f0-9]+\/ui-host-worker\.js$/.test(file));
  assert.equal(workers.length, 1, 'Expected one inventoried battle Worker');
  const [worker] = workers;
  const resourceDir = path.dirname(worker);
  const fguiFile = `${resourceDir}/fgui/ActivityDungeon1017Battle.json`;
  for (const file of [worker, fguiFile]) assert.equal(hash(fs.readFileSync(path.join(dist, file))), files[file], file);
  const outputDir = path.resolve(values['out-dir']);
  return { dist, manifest, worker, fguiFile, label, count, first, last, outputDir, fguiSha256: files[fguiFile],
    workerSha256: files[worker], inventorySha256: hash(inventory) };
}

function listen(config) {
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    const file = path.resolve(config.dist, '.' + decodeURIComponent(pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(config.dist + path.sep) || !fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    if (pathname === '/' + config.worker) response.end(Buffer.concat([workerShim, fs.readFileSync(file)]));
    else fs.createReadStream(file).pipe(response);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function installProbe({ stageId, hudWindow, hudLabel, pauseLabel }) {
  const schema = 'starfall.monster-defense.progress/1';
  for (let stage = 78000001; stage < stageId; stage++) {
    localStorage.setItem(schema + '/' + stage, JSON.stringify({ schema, stageId: stage, settlement: 'confirmed_natural_win' }));
  }
  const paths = (root, ...names) => names.reduce((parent, name) => parent?.children.find(node => node.name === name), root);
  const now = () => performance.timeOrigin + performance.now();
  const ui = () => document.querySelector('#app > section.screen');
  const scene = () => ui()?.getAttribute('aria-label');
  const canvas = () => document.querySelector('canvas[aria-label="战场画面"]');
  let world, choice, pauseId, armed, sample, revision=0, inflightTick, lastReturnedTick;
  const starts = [], failure = [], seeds = [], completed = [];
  const choiceName = 'MiniGameSkillChoiceWindow';
  const pauseName = 'MiniGameBattlePauseWindow';
  const visible = () => {
    if (!sample?.sentAt || sample.visibleAt || scene() !== pauseLabel || document.hidden) return;
    if (!ui()?.checkVisibility() || !ui().querySelector('canvas')?.checkVisibility()) return;
    const visibleSample = sample;
    visibleSample.visibleAt = now();
    requestAnimationFrame(() => {
      if (scene() === pauseLabel) visibleSample.paintOpportunityAt = now();
    });
  };
  new MutationObserver(visible).observe(document, { subtree: true, attributes: true, attributeFilter: ['aria-label'] });
  document.addEventListener('pointerup', event => {
    if (!armed || !event.isTrusted || event.button !== 0) return;
    sample = { ...armed, pointerUpAt: now(), x: event.clientX, y: event.clientY, worldAtPointer: world,
      activeTickAtPointer: inflightTick, lastCompletedTickAtPointer: lastReturnedTick };
    armed = undefined;
  }, true);

  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(...args) {
      super(...args);
      const entry = new URL(args[0], location.href);
      this.battleProbe = entry.pathname.endsWith('/ui-host-worker.js');
      if (!this.battleProbe) return;
      this.addEventListener('error', event => failure.push(event.message));
      this.addEventListener('messageerror', () => failure.push('Worker message error'));
      this.addEventListener('message', ({ data }) => {
        if (data.type === 'pause-probe-seed') seeds.push(data.value);
        if (data.type === 'error') failure.push(data.message);
        if (data.type === 'open' && data.window === hudWindow) pauseId = paths(data.tree, 'Main', 'Top', 'PauseBtn')?.id;
        if (data.type === 'open' && data.window === pauseName && sample?.sentAt && !sample.workerOpenAt) {
          sample.workerOpenAt = data.pauseProbeEmittedAt;
          sample.openReceivedAt = now();
          visible();
        }
        if (data.type === 'open' && data.window === choiceName) {
          choice = { id: paths(data.tree, 'Main', 'TipsList')?.id, revision: ++revision, cards: [] };
        }
        if (data.type === 'close' && data.window === choiceName) choice = undefined;
        if (data.type === 'ops' && choice) for (const op of data.ops) {
          if (op.id === choice.id && op.op === 'list-clear') choice = { id: choice.id, revision: ++revision, cards: [] };
          if (op.id === choice.id && op.op === 'list-add') choice.cards.push({ id: op.item.id, ready: false });
          if (op.op === 'transition-play' && op.name === 'up') {
            const card = choice.cards.find(card => card.id === op.id);
            if (card) card.ready = true;
          }
        }
        if (data.type === 'settled') {
          if (data.requestId === inflightTick?.requestId) {
            lastReturnedTick = { ...inflightTick, receivedAt: now(), moreSteps: data.moreSteps === true };
            inflightTick = undefined;
          }
          if (data.requestId === sample?.clickId) sample.clickAckAt = now();
        }
        if (data.type !== 'event') return;
        if (data.event.name === 'start-battle') starts.push({ stageId: data.event.stageId, stress: data.event.stress === true });
        if (data.event.name === 'battle-close') world = undefined;
        if (data.event.name !== 'world') return;
        const state = data.event.state;
        let living = 0;
        let modeledOpponents = 0;
        for (const unit of state.units) if (unit.camp === 2) {
          if (unit.stateName !== 'DEAD' && unit.stateName !== 'DESTROY') living++;
          if (unit.model) modeledOpponents++;
        }
        world = { stage: state.stageId, frame: state.fixedFrame, wave: state.curMonsterWave, speed: state.speedIndex,
          paused: state.paused, living, modeledOpponents, bullets: state.bullets.length, effects: state.effects.length };
        if (sample?.workerOpenAt && state.paused && sample.pausedFrame === undefined) {
          sample.pausedFrame = state.fixedFrame;
          sample.pausedSnapshotWorkerAt = data.pauseProbeEmittedAt;
          sample.pausedSnapshotReceivedAt = now();
        }
      });
    }
    postMessage(message, ...args) {
      if (this.battleProbe) {
        if (message.signal?.kind === 'tick') inflightTick = { requestId: message.requestId, postedAt: now(),
          ms: message.signal.ms, stepBudget: message.signal.stepBudget ?? null, resume: message.signal.resume === true };
        if (sample && !sample.sentAt && message.type === 'click' && message.componentId === pauseId) {
          sample.clickId = message.requestId;
          sample.sentAt = now();
        }
      }
      return super.postMessage(message, ...args);
    }
  };
  window.endlessPauseProbe = {
    view: () => ({ world, scene: scene(), choice, starts, failure, seeds, renderer: canvas()?.dataset.renderer,
      map: document.body.dataset.map, hidden: document.hidden, pending: sample }),
    arm(target) {
      if (scene() !== hudLabel || !pauseId || !world || world.paused || world.speed !== 2 || document.hidden) return false;
      sample = undefined;
      armed = target;
      return true;
    },
    take() {
      if (!sample?.paintOpportunityAt || sample.pausedFrame === undefined || !sample.clickAckAt) return null;
      const complete = sample;
      sample = undefined;
      completed.push(complete);
      return complete;
    },
    cancel() { armed = sample = undefined; },
  };
}

async function main(config) {
  const { chromium } = require('playwright');
  const resultPath = path.join(config.outputDir, `${config.label}.json`);
  const report = { ...config, seed, stage, viewport, os: os.version(), cpu: os.cpus()[0]?.model, workerShimSha256: hash(workerShim),
    startUtc: new Date().toISOString(), samples: [], choiceFrames: [], competingChoices: [], errors: [],
    measurement: 'Trusted pointerup on native pause, main-thread Worker post, Worker pause-window emission, main receipt, active visible FGUI layer and its next browser paint opportunity. The first paused world snapshot gives the effective rule frame. The previous published frame can lag rules already executed at pointerup.' };
  fs.mkdirSync(config.outputDir, { recursive: true });
  fs.writeFileSync(resultPath, JSON.stringify(report, null, 2), { flag: 'wx' });
  const flush = () => fs.writeFileSync(resultPath, JSON.stringify(report, null, 2));
  const pkg = json(path.join(config.dist, config.fguiFile));
  const top = pkg.components[pkg.componentIndex.BattleTop];
  const offer = pkg.components[pkg.componentIndex.SkillChoice].children.find(node => node.name === 'TipsList');
  const card = pkg.components[offer.defaultItem.slice(13)];
  const button = name => {
    const node = top.children.find(child => child.name === name);
    const prefab = pkg.components[node.src];
    return [node.x + (node.width ?? prefab.width) / 2, node.y + (node.height ?? prefab.height) / 2];
  };
  let server, browser;
  try {
    server = await listen(config);
    const origin = `http://127.0.0.1:${server.address().port}`;
    const executablePath = process.env.CHROME_PATH;
    browser = await chromium.launch({ channel: !executablePath && process.platform === 'win32' ? 'msedge' : undefined,
      executablePath, headless: true,
      args: ['--disable-background-networking','--proxy-server=http://127.0.0.1:1'] });
    report.browser = browser.version();
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, serviceWorkers: 'block' });
    const page = await context.newPage();
    const cdp = await browser.newBrowserCDPSession();
    report.gpu = (await cdp.send('SystemInfo.getInfo')).gpu;
    await cdp.detach();
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('request', request => {
      if (!request.url().startsWith(origin + '/') && !request.url().startsWith('blob:' + origin + '/') && !request.url().startsWith('data:')) {
        report.errors.push(`Unexpected origin ${request.url()}`);
      }
    });
    page.on('response', response => { if (response.status() >= 400) report.errors.push(`${response.status()} ${response.url()}`); });
    page.on('requestfailed', request => report.errors.push(`${request.failure()?.errorText} ${request.url()}`));
    await page.addInitScript(installProbe, { stageId: stage, hudWindow, hudLabel, pauseLabel });
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    const scene = name => page.getByRole('region', { name, exact: true });
    const current = () => page.evaluate(() => window.endlessPauseProbe.view());
    const visit = async (x, y) => {
      const canvas = await page.locator('#app canvas:visible').last().boundingBox();
      assert(canvas, 'Missing original UI canvas');
      await page.mouse.click(canvas.x + x * canvas.width / 1334, canvas.y + y * canvas.height / 750);
    };
    const frame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await scene('魔物抵御战活动主页').waitFor({ timeout: 45000 });
    await page.locator('#startup').waitFor({ state: 'detached' });
    await frame();
    await visit(1147,679);
    await scene('选择关卡').waitFor();
    await page.mouse.move(690,370);
    await page.mouse.wheel(0,4200);
    await frame();
    await visit(1162,368);
    await scene(hudLabel).waitFor({ timeout: 40000 });
    await page.locator('.battle-wait').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => window.endlessPauseProbe.view().world?.frame >= 15);
    await visit(...button('SpeedBtn'));
    await page.waitForFunction(() => window.endlessPauseProbe.view().world?.speed === 2);
    const initial = await current();
    assert.deepEqual(initial.starts, [{ stageId:stage, stress:false }]);
    assert.deepEqual(initial.seeds, [seed]);
    assert.equal(initial.renderer, 'canvas');
    assert.equal(initial.map, 'map3');
    const deadline = Date.now() + 360000;
    let choiceRevision = -1;
    let lastPausedFrame = 0;
    while (report.samples.length < config.count) {
      const state = await current();
      assert(Date.now() < deadline, 'Timed out collecting the declared game-frame window');
      assert(!state.hidden && !state.failure.length && !report.errors.length, 'Unexpected browser state or Worker error');
      assert(state.scene !== '战斗结算', 'Natural settlement before every sample was collected');
      const activeChoice = state.choice;
      if (state.scene === '选择强化' && activeChoice?.cards.length && activeChoice.revision !== choiceRevision && activeChoice.cards.every(card => card.ready)) {
        const count = activeChoice.cards.length;
        const width = count * card.width + (count - 1) * offer.columnGap;
        await frame();
        await visit(offer.x + Math.floor((offer.width - width) / 2) + card.width / 2, offer.y + card.height / 2);
        await visit(667,654);
        choiceRevision = activeChoice.revision;
        report.choiceFrames.push(state.world?.frame);
      }
      const index = report.samples.length;
      const targetFrame = Math.max(lastPausedFrame + 24, Math.ceil(config.first + (config.last - config.first) * (index + 1) / (config.count + 1)));
      if (state.world?.frame > config.last) throw new Error('Quiet HUD opportunities ran past the declared frame window');
      if (state.scene !== hudLabel || state.world?.paused || state.world?.frame < targetFrame) {
        await sleep(35);
        continue;
      }
      const armed = await page.evaluate(target => window.endlessPauseProbe.arm(target), { index, targetFrame });
      if (!armed) continue;
      await visit(...button('PauseBtn'));
      const ready = await page.waitForFunction(() => {
        const result = window.endlessPauseProbe.take();
        if (result) return { result };
        const { scene, pending } = window.endlessPauseProbe.view();
        if (scene === '选择强化' && !pending?.sentAt) return { competingChoice: pending };
        return false;
      }, undefined, { timeout: 12000 });
      const observation = await ready.jsonValue();
      await ready.dispose();
      if ('competingChoice' in observation) {
        report.competingChoices.push({ targetFrame, observation: observation.competingChoice });
        await page.evaluate(() => window.endlessPauseProbe.cancel());
        continue;
      }
      const sample = observation.result;
      assert(sample.pointerUpAt <= sample.sentAt && sample.sentAt <= sample.workerOpenAt + 1 &&
        sample.workerOpenAt <= sample.openReceivedAt + 1 && sample.openReceivedAt <= sample.visibleAt &&
        sample.visibleAt <= sample.paintOpportunityAt, 'Pause-event timestamps were not ordered');
      assert(sample.worldAtPointer?.speed === 2 && sample.worldAtPointer.frame >= config.first &&
        sample.pausedFrame >= sample.worldAtPointer.frame && sample.pausedFrame <= config.last, 'Pause event falls outside the live frame window');
      assert(sample.pausedSnapshotReceivedAt >= sample.openReceivedAt && sample.pausedSnapshotWorkerAt >= sample.workerOpenAt - 1);
      lastPausedFrame = sample.pausedFrame;
      report.samples.push(sample);
      if (!index) await page.screenshot({ path: path.join(config.outputDir, `${config.label}-first-pause.png`) });
      assert.equal((await current()).world?.frame, sample.pausedFrame, 'Rules advanced while pause remained open');
      flush();
      console.log(JSON.stringify({ sample: index + 1, frame: sample.pausedFrame, wave: sample.worldAtPointer.wave,
        living: sample.worldAtPointer.living, pauseMs: sample.paintOpportunityAt - sample.pointerUpAt }));
      await visit(660,380);
      await scene(hudLabel).waitFor();
      await page.waitForFunction(previous => {
        const { world } = window.endlessPauseProbe.view();
        return world?.speed === 2 && !world.paused && world.frame > previous;
      }, sample.pausedFrame, { timeout: 12000 });
    }
    const summarize = field => {
      const values = report.samples.map(sample => sample[field] - sample.pointerUpAt).sort((a,b) => a-b);
      const at = ratio => values[Math.ceil(values.length * ratio) - 1];
      return { p50: at(.5), p95: at(.95), p99: at(.99), maximum: values.at(-1) };
    };
    report.summary = Object.fromEntries(['sentAt','workerOpenAt','openReceivedAt','visibleAt','paintOpportunityAt','pausedSnapshotReceivedAt']
      .map(field => [field, summarize(field)]));
    report.final = await current();
    assert.deepEqual(report.final.starts, initial.starts);
    assert(!report.final.failure.length && !report.errors.length);
    report.complete = true;
    console.log(JSON.stringify({ result: resultPath, samples: report.samples.length, summary: report.summary }));
  } catch (error) {
    report.fatal = error.stack;
    throw error;
  } finally {
    report.endUtc = new Date().toISOString();
    flush();
    try { await browser?.close(); } finally { server?.close(); }
  }
}

const { values } = parseArgs({ options: { dist:{type:'string'}, label:{type:'string'}, 'expect-commit':{type:'string'},
  'expect-tree':{type:'string'}, samples:{type:'string',default:'20'}, 'first-frame':{type:'string',default:'3600'},
  'last-frame':{type:'string',default:'5400'}, 'out-dir':{type:'string',default:process.cwd()},
  'validate-only':{type:'boolean'}, help:{type:'boolean'} } });
if (values.help) console.log(`node ${path.basename(__filename)} --dist DIR --expect-commit FULL_SHA --label RUN
  [--expect-tree FULL_SHA] [--samples 20 --first-frame 3600 --last-frame 5400] [--out-dir DIR] [--validate-only]
  Output defaults to the current directory. CHROME_PATH overrides the browser executable.`);
else if (values['validate-only']) console.log(JSON.stringify(inputs(values), null, 2));
else main(inputs(values)).catch(error => { console.error(error.stack); process.exitCode = 1; });

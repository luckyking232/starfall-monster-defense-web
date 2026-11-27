const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { pipeline } = require('node:stream');
const { setTimeout: sleep } = require('node:timers/promises');
const { parseArgs } = require('node:util');

const app = path.resolve(__dirname, '..');
const viewport = { width: 1334, height: 750 };
const stageId = 78000021;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.gz': 'application/gzip',
  '.wasm': 'application/wasm', '.png': 'image/png', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.woff2': 'font/woff2', '.lua': 'text/plain',
};

function options() {
  const { values } = parseArgs({ options: {
    backend: { type: 'string', default: 'canvas' }, duration: { type: 'string', default: '600' },
    dist: { type: 'string', default: path.join(app, 'dist') }, label: { type: 'string' },
    base: { type: 'string' }, proxy: { type: 'string' }, profile: { type: 'string' }, 'expect-commit': { type: 'string' },
    output: {type:'string',default:path.join(app,'test-results','stress-benchmark')},
    'expect-tree': {type:'string'}, 'pause-samples': {type:'string',default:'0'},
    resources: {type:'boolean'}, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log([
      'node scripts/benchmark-stress.cjs [--backend canvas|webgl] [--duration 600] [--label NAME]',
      '                     [--dist PATH | --base URL] [--expect-commit SHA] [--expect-tree TREE] [--output DIR]',
      '                     [--proxy URL|direct] [--profile TEST_PROFILE_PATH]',
      '                     [--pause-samples N] (a separate input-latency run after warmup)',
      '                     [--resources] (separate heap, Wasm and resource lifecycle diagnostics)',
      'Uses this game project and its locked Playwright dependency; local builds stay on loopback.',
      'An optional persistent profile must be a dedicated directory inside the evidence output directory.',
    ].join('\n'));
    return null;
  }
  const durationMs = Number(values.duration) * 1000;
  assert(Number.isFinite(durationMs) && durationMs >= 1000, '--duration must be at least one second');
  assert(['canvas', 'webgl'].includes(values.backend), '--backend must be canvas or webgl');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const label = values.label ?? `builtin-${values.backend}-${values.duration}s-${stamp}`;
  assert(/^[\w-]+$/.test(label), '--label must contain only letters, digits, underscores or hyphens');
  const base = values.base ? new URL(values.base) : null;
  if (base) {
    assert(['http:', 'https:'].includes(base.protocol) && !base.username && !base.password, '--base must be an HTTP(S) game URL');
    assert(!base.hash && !base.search, '--base must be the game directory URL without a query string or fragment');
    if (!base.pathname.endsWith('/')) base.pathname += '/';
  }
  const proxy = values.proxy ?? 'direct';
  if (proxy !== 'direct') {
    assert(base, '--proxy is only needed with --base');
    const proxyUrl = new URL(proxy);
    assert(['http:', 'https:', 'socks5:'].includes(proxyUrl.protocol) && !proxyUrl.username && !proxyUrl.password &&
      (!proxyUrl.pathname || proxyUrl.pathname === '/') && !proxyUrl.search && !proxyUrl.hash,
    '--proxy needs a proxy server URL with no path, query string or credentials');
  }
  const profile = values.profile ? path.resolve(values.profile) : undefined;
  if (profile) {
    const relative = path.relative(path.resolve(values.output), profile);
    assert(base && relative && !relative.startsWith('..') && !path.isAbsolute(relative),
      '--profile requires --base and a dedicated browser profile under the review directory');
  }
  const pauseSamples=Number(values['pause-samples']);
  assert(Number.isSafeInteger(pauseSamples) && pauseSamples>=0, 'Expected a non-negative pause sample count');
  return { backend: values.backend, durationMs, label, base, proxy, profile, pauseSamples, resources: values.resources,
    outputDir:path.resolve(values.output),
    dist:path.resolve(values.dist), expectedCommit:values['expect-commit'], expectedTree:values['expect-tree'] };
}

async function serve(dist) {
  assert(fs.statSync(path.join(dist, 'index.html'), { throwIfNoEntry: false })?.isFile(), `Production dist unavailable at ${dist}`);
  const server = http.createServer((request, response) => {
    let file;
    try {
      const { pathname } = new URL(request.url, 'http://127.0.0.1');
      file = path.resolve(dist, '.' + decodeURIComponent(pathname === '/' ? '/index.html' : pathname));
    } catch {
      response.writeHead(400).end();
      return;
    }
    const stat = file.startsWith(dist + path.sep) ? fs.statSync(file, { throwIfNoEntry: false }) : undefined;
    if (!stat?.isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    pipeline(fs.createReadStream(file), response, () => {});
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server;
}

function installObserver() {
  const protocol = 'starfall.monster-defense.original-ui/1';
  const buckets = new Uint32Array(2001);
  const projectilePaths = new Set();
  const effectPaths = new Set();
  const pathLimit = 128;
  let pathsTruncated = false;
  let tickCount = 0;
  let maxTickMs = 0;
  let skippedInactiveTicks = 0;
  let invalidTicks = 0;
  const observation = {
    starts: [], closes: 0, choices: 0, hiddenTransitions: 0, scoreEvents: [], workerErrors: [],
    world: null, lastFrame: 0, maxOpponents: 0, loadout: null,
  };
  window.builtinSoak = () => {
    const p95Rank = Math.ceil(tickCount * .95);
    const p99Rank = Math.ceil(tickCount * .99);
    let p95Ms = null;
    let p99Ms = null;
    let seen = 0;
    for (let bucket = 0; tickCount && bucket < buckets.length; bucket++) {
      seen += buckets[bucket];
      const estimate = Math.min(maxTickMs, bucket === buckets.length - 1 ? maxTickMs : bucket);
      if (p95Ms === null && seen >= p95Rank) p95Ms = estimate;
      if (seen >= p99Rank) {
        p99Ms = estimate;
        break;
      }
    }
    return {
      ...observation, workerTickRoundTrip: { count: tickCount, p95Ms, p99Ms, maxMs: tickCount ? maxTickMs : null,
        skippedInactiveTicks, invalidTicks },
      paths: { projectiles: [...projectilePaths].sort(), effects: [...effectPaths].sort(), truncated: pathsTruncated },
    };
  };
  function retainPaths(target, models) {
    if (!models) return;
    for (const model of models) {
      if (typeof model.path !== 'string' || target.has(model.path)) continue;
      if (target.size < pathLimit) target.add(model.path);
      else pathsTruncated = true;
    }
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) observation.hiddenTransitions++; });
  let lastDensityFrame = -30;
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    pendingTicks = new Map();
    tracking = false;
    speed = 0;
    paused = false;

    constructor(...args) {
      super(...args);
      this.addEventListener('error', event => observation.workerErrors.push(event.message));
      this.addEventListener('messageerror', () => observation.workerErrors.push('messageerror'));
      this.addEventListener('message', ({ data }) => {
        if (data?.type === 'settled' || data?.type === 'error') {
          const pending = this.pendingTicks.get(data.requestId);
          if (pending) {
            this.pendingTicks.delete(data.requestId);
            if (data.type === 'settled' && data.protocol === protocol && data.session === pending.session) {
              const duration = performance.now() - pending.sentAt;
              buckets[Math.min(buckets.length - 1, Math.ceil(duration))]++;
              tickCount++;
              maxTickMs = Math.max(maxTickMs, duration);
            } else invalidTicks++;
          }
        }
        if (data?.type === 'open' && data.window === 'MiniGameSkillChoiceWindow') observation.choices++;
        if (data?.type === 'error') observation.workerErrors.push({ code: data.code, message: data.message });
        if (data?.type !== 'event') return;
        const event = data.event;
        if (event.name === 'start-battle') {
          observation.starts.push({ stageId: event.stageId, stress: event.stress });
          this.tracking = event.stress === true;
          this.speed = 0;
          this.paused = false;
          this.pendingTicks.clear();
          buckets.fill(0);
          tickCount = maxTickMs = skippedInactiveTicks = invalidTicks = 0;
          observation.lastFrame = observation.maxOpponents = 0;
          observation.world = null;
          lastDensityFrame = -30;
          projectilePaths.clear();
          effectPaths.clear();
          pathsTruncated = false;
        }
        if (event.name === 'battle-close') {
          observation.closes++;
          this.tracking = false;
        }
        if (event.name === 'stress-loadout') observation.loadout = event.report;
        if (['clear-earned', 'endless-record', 'progress-save-failed'].includes(event.name) ||
            (event.name === 'settlement' && event.endless)) observation.scoreEvents.push(event);
        if (event.name !== 'world') return;
        const state = event.state;
        this.speed = state.speedIndex;
        this.paused = state.paused;
        observation.lastFrame = state.fixedFrame;
        if (state.fixedFrame - lastDensityFrame >= 30 || !observation.world || state.paused !== observation.world.paused) {
          let opponents = 0;
          for (const unit of state.units) if (unit.camp === 2) opponents++;
          observation.maxOpponents = Math.max(observation.maxOpponents, opponents);
          observation.world = {
            frame: state.fixedFrame, opponents, speed: state.speedIndex, paused: state.paused, kills: state.killEnemyCount,
            projectiles: state.bullets?.length ?? 0, effects: state.effects?.length ?? 0,
          };
          retainPaths(projectilePaths, state.bullets);
          retainPaths(effectPaths, state.effects);
          lastDensityFrame = state.fixedFrame;
        }
      });
    }

    postMessage(message, ...args) {
      if (this.tracking && message?.type === 'presentation' && message.signal?.kind === 'tick') {
        if (message.protocol !== protocol || !Number.isSafeInteger(message.requestId) || typeof message.session !== 'string' ||
            this.pendingTicks.size >= 8 || this.pendingTicks.has(message.requestId)) {
          invalidTicks++;
        } else if (!(this.speed > 0) || this.paused || observation.lastFrame === 0 || document.hidden) {
          skippedInactiveTicks++;
        } else {
          this.pendingTicks.set(message.requestId, { sentAt: performance.now(), session: message.session });
        }
      }
      return super.postMessage(message, ...args);
    }
  };
}

function observePage() {
  const canvas = document.querySelector('canvas[aria-label="战场画面"]');
  const overlay = document.querySelector('.stress-live');
  return {
    time: performance.now(), hidden: document.hidden,
    scene: document.querySelector('#app > section.screen')?.getAttribute('aria-label'),
    stressActive: document.querySelector('#app')?.dataset.stressActive === 'true',
    hudText: overlay?.textContent, hudVisible: overlay ? !overlay.hidden : false,
    canvas: canvas && { renderer: canvas.dataset.renderer, width: canvas.width, height: canvas.height },
    ...window.builtinSoak(),
  };
}

function progress() {
  return Object.keys(localStorage).filter(key => /starfall\.(monster-defense\.progress|offline-cleared-stage)\//.test(key))
    .sort().map(key => [key, localStorage.getItem(key)]);
}

// Wall-clock tap, message delivery, native pause notification, and the first
// browser paint opportunity following actual visibility of the original window.
function installPauseProbe() {
  let armed=false, current=null, lastFrame=0;
  const results=[];
  window.armPauseProbe=()=>{armed=true; current=null;};
  window.readPauseProbe=()=>results;
  document.addEventListener('pointerup',()=>{
    if (armed) { armed=false; current={tap:performance.now(),frameAtTap:lastFrame}; }
  },true);
  const Base=window.Worker;
  window.Worker=class extends Base {
    constructor(...args) {
      super(...args);
      this.addEventListener('message',({data})=>{
        if(data?.type==='event' && data.event.name==='world'){
          lastFrame=data.event.state.fixedFrame;
          if(current && data.event.state.paused && current.pausedFrame===undefined) current.pausedFrame=lastFrame;
        }
        if(current && data?.type==='open' && data.window==='MiniGameBattlePauseWindow') current.open=performance.now();
      });
    }
    postMessage(message,...args) {
      if(current && message.type==='click' && current.sent===undefined) current.sent=performance.now();
      return super.postMessage(message,...args);
    }
  };
  new MutationObserver(()=>{
    if(!current || current.visible!==undefined || !document.querySelector('[aria-label="战斗暂停"]')) return;
    const sample=current;
    sample.visible=performance.now();
    requestAnimationFrame(()=>{
      sample.paintOpportunity=performance.now();
      results.push(sample);
    });
  }).observe(document,{subtree:true,attributes:true,attributeFilter:['aria-label']});
}

async function measurePauses(page,count) {
  async function clickOriginal(x,y) {
    const box=await page.locator('#app section canvas:visible').last().boundingBox();
    assert(box,'Original FGUI canvas unavailable');
    await page.mouse.click(box.x+x*box.width/1334,box.y+y*box.height/750);
  }
  let frame=480;
  for(let index=0; index<count; index++){
    await page.waitForFunction(target=>window.builtinSoak().lastFrame>=target,frame);
    await page.evaluate(()=>window.armPauseProbe());
    await clickOriginal(163,47);
    await page.waitForFunction(i=>window.readPauseProbe()[i]?.pausedFrame!==undefined,index);
    const sample=await page.evaluate(i=>window.readPauseProbe()[i],index);
    assert(sample.sent>=sample.tap && sample.open>=sample.sent && sample.visible>=sample.open);
    frame=sample.pausedFrame+18;
    await clickOriginal(660,380);
    await page.getByRole('region',{name:'魔物抵御战战场',exact:true}).waitFor();
  }
  const samples=await page.evaluate(()=>window.readPauseProbe());
  const intervals=samples.map(s=>s.paintOpportunity-s.tap).sort((a,b)=>a-b);
  return {samples,p95Ms:intervals[Math.ceil(.95*count)-1],maxMs:intervals.at(-1)};
}

async function readReport(report) {
  const raw = await report.evaluate(element => {
    const values = scope => Object.fromEntries(Array.from(scope.querySelectorAll('dl dt'), term =>
      [term.textContent.trim(), term.nextElementSibling.textContent.trim()]));
    const [worst, latest] = element.querySelectorAll('.stress-window');
    const notes = Array.from(element.querySelectorAll('p'), note => note.textContent.trim());
    return {
      text: element.innerText, metrics: values(element.querySelector('dl')),
      worst: worst && { values: values(worst), description: worst.querySelector('p')?.textContent.trim() },
      latest: latest && values(latest), notes,
    };
  });
  const metric = (label, unit) => {
    const value = raw.metrics[label];
    const match = value?.match(/^([\d.]+)\s*(.+)?$/);
    assert(match && match[2] === unit && Number.isFinite(Number(match[1])), `Invalid metric ${label}: ${value}`);
    return Number(match[1]);
  };
  const density = values => ({
    opponents: Number(values['怪物']), projectiles: Number(values['弹体']), effects: Number(values['特效']),
    hurtNumbers: Number(values['新增飘字'] ?? values['帧间新增飘字']),
  });
  const latest = raw.notes.find(note => note.startsWith('最后出图 · '));
  const finalConfig = latest?.match(/^最后出图 · (Canvas|WebGL) · (\d+) × (\d+) · ([\d.]+)×速$/);
  const worstConfig = raw.worst?.description?.match(/^有效时段 ([\d.]+) 秒 至 ([\d.]+) 秒 · (Canvas|WebGL) · (\d+) × (\d+) · ([\d.]+)×速$/);
  assert(finalConfig && worstConfig, 'The built-in report is missing its renderer or worst-second configuration');
  const config = ([renderer, width, height, speed]) => ({ renderer: renderer.toLowerCase(), width: Number(width), height: Number(height), speed: Number(speed) });
  return {
    raw, activeMs: Math.round(metric('有效计时', '秒') * 1000), intervals: metric('帧间隔样本', undefined),
    p95Ms: metric('帧间隔 P95', 'ms'), p99Ms: metric('帧间隔 P99', 'ms'), maxGapMs: metric('最长帧间隔', 'ms'),
    gapsOver100Ms: metric('帧间隔 > 100 ms', '次'), stallsOver1s: metric('帧间隔 > 1 秒', '次'),
    maxUnfinishedGapMs: Number(raw.notes.find(note => note.startsWith('中断前最长无出图 '))?.match(/([\d.]+) ms/)?.[1]) || null,
    latestConfig: config(finalConfig.slice(1)), latestCounts: raw.latest && density(raw.latest),
    worstSecond: {
      fps: metric('最差一秒', 'FPS'), startMs: Math.round(Number(worstConfig[1]) * 1000),
      endMs: Math.round(Number(worstConfig[2]) * 1000), config: config(worstConfig.slice(3)), counts: density(raw.worst.values),
    },
  };
}

async function main(settings) {
  if (!settings) return;
  const { chromium } = require('playwright');
  const { backend, durationMs, label, proxy, profile, dist, expectedCommit } = settings;
  fs.mkdirSync(settings.outputDir,{recursive:true});
  const output = name => path.join(settings.outputDir, label + name);
  assert(!fs.existsSync(output('.json')), 'This label already contains benchmark evidence');
  const result = {
    requestedBackend: backend, durationMs, viewport, os: os.version(), cpu: os.cpus()[0]?.model,
    dist: settings.base ? undefined : dist, proxy, profile, startUtc: new Date().toISOString(),
    workerTickMeasurement: 'Wall time from posting an active positive-speed tick to the matching Worker settled event. Includes queueing, transport, serialization and result delivery. Percentiles use approximately 1 ms histogram buckets, with the 2 s overflow reported as the maximum.',
    samples: [], requestErrors: [], pageErrors: [], otherOrigins: [], screenshotErrors: {},
  };
  const flush = () => fs.writeFileSync(output('.json'), JSON.stringify(result, null, 2));
  let server;
  let browser;
  let context;
  let page;
  let resourceProbe;
  const sampleResources = async (phase, inventory, frame = null) => {
    const sample = await resourceProbe.sample(phase, { inventory });
    result.resourceDiagnostics.samples.push({ ...sample, frame });
    flush();
  };
  const capture = async (name, screenshot) => {
    const image = output(`-${name}.png`);
    try {
      await screenshot(image);
      result[name + 'Screenshot'] = image;
    } catch (error) {
      result.screenshotErrors[name] = error.message;
    }
    flush();
  };
  try {
    server = settings.base ? undefined : await serve(dist);
    const base = settings.base ?? new URL(`http://127.0.0.1:${server.address().port}/`);
    result.base = base.href;
    const launch = {
      ...(process.platform === 'win32' ? {channel:'msedge'} : {}), headless: true,
      args: ['--disable-background-networking', ...(proxy === 'direct' ? ['--no-proxy-server'] : [])],
      ...(proxy === 'direct' ? {} : { proxy: { server: proxy } }),
    };
    const contextOptions = { viewport, deviceScaleFactor: 1, serviceWorkers: 'block' };
    if (profile) {
      context = await chromium.launchPersistentContext(profile, { ...launch, ...contextOptions });
      browser = context.browser();
    } else {
      browser = await chromium.launch(launch);
      context = await browser.newContext(contextOptions);
    }
    page = context.pages()[0] ?? await context.newPage();
    if (browser) {
      result.browser = browser.version();
      const gpu = await browser.newBrowserCDPSession();
      result.graphics = (await gpu.send('SystemInfo.getInfo')).gpu;
      await gpu.detach();
    } else {
      const cdp = await context.newCDPSession(page);
      result.browser = await cdp.send('Browser.getVersion');
      await cdp.detach();
    }
    page.setDefaultTimeout(45000);
    page.on('pageerror', error => result.pageErrors.push(error.stack ?? error.message));
    result.browserWarnings = [];
    page.on('console', message => {
      if (['warning', 'error'].includes(message.type()) && result.browserWarnings.length < 60) {
        result.browserWarnings.push({ type: message.type(), text: message.text().slice(0, 1500) });
      }
    });
    page.on('request', request => {
      if (!/^(data|blob):/.test(request.url()) && new URL(request.url()).origin !== base.origin) result.otherOrigins.push(request.url());
    });
    page.on('response', response => {
      if (response.status() >= 400) result.requestErrors.push([response.url(), response.status()]);
    });
    page.on('requestfailed', request => result.requestErrors.push([request.url(), request.failure()?.errorText]));
    const version = new URL('version.json', base);
    version.searchParams.set('builtin-soak', Date.now());
    const response = await page.goto(version.href);
    assert(response?.ok(), `Build manifest unavailable at ${version}`);
    result.manifest = await response.json();
    assert(result.manifest.commit && result.manifest.tree, 'Build manifest is missing its commit or tree');
    if (expectedCommit) assert(result.manifest.commit.startsWith(expectedCommit), `Unexpected build commit ${result.manifest.commit}`);
    if (settings.expectedTree) assert.equal(result.manifest.tree, settings.expectedTree, 'Unexpected build tree');
    if (server) {
      result.inventorySha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(dist, 'asset-inventory.json'))).digest('hex');
    }

    await page.addInitScript(installObserver);
    if (settings.pauseSamples) await page.addInitScript(installPauseProbe);
    if (settings.resources) {
      const { createBrowserResourcesProbe, resourceMeasurement } = require('./lib/browser-resources.cjs');
      resourceProbe = createBrowserResourcesProbe(page);
      result.resourceDiagnostics = { timingIncludesProbes: true, measurement: resourceMeasurement, samples: [] };
    }
    await page.goto(base.href, { waitUntil: 'domcontentloaded' });
    result.channel = await page.locator('meta[name="game-channel"]').getAttribute('content');
    if (settings.base?.hostname.endsWith('.github.io')) assert.equal(result.channel, 'test', 'Expected the isolated Pages test game');
    await page.getByRole('region', { name: '魔物抵御战活动主页', exact: true }).waitFor();
    await page.locator('#startup').waitFor({ state: 'detached' });
    result.progressBefore = await page.evaluate(progress);
    if (profile) {
      // Match the fresh local browser's settings while keeping the test profile's HTTP cache.
      await page.getByRole('button', { name: '网页设置', exact: true }).click();
      for (const name of ['音乐音量', '音效音量']) {
        const slider = page.getByRole('slider', { name, exact: true });
        if (await slider.inputValue() !== '100') await slider.press('End');
        assert.equal(await slider.inputValue(), '100', name);
      }
      await page.getByLabel('显示帧率', { exact: true }).uncheck();
      await page.getByLabel('省电画质（降低战场分辨率）', { exact: true }).uncheck();
      await page.getByRole('button', { name: '关闭', exact: true }).click();
    }
    const openTab = async () => {
      await page.getByRole('button', { name: '网页设置', exact: true }).click();
      await page.getByRole('button', { name: '压测', exact: true }).click();
    };
    const enterBattle = async () => {
      await page.getByLabel('压测渲染方式', { exact: true }).selectOption(backend);
      await page.getByRole('button', { name: '开始怪海压测', exact: true }).click();
      await page.getByRole('region', { name: '魔物抵御战战场', exact: true }).waitFor();
      await page.locator('.battle-wait').waitFor({ state: 'hidden' });
      await page.locator('.stress-live').waitFor({ state: 'visible' });
    };
    const exitBattle = async () => {
      await page.getByRole('button', { name: '结束压测', exact: true }).click();
      await page.getByText('上次采样', { exact: true }).waitFor();
      await page.getByRole('button', { name: '开始怪海压测', exact: true }).waitFor();
    };
    await openTab();
    if (resourceProbe) await sampleResources('before-first-battle', true);
    await enterBattle();
    const first = await page.evaluate(observePage);
    assert(first.stressActive && first.hudVisible && first.canvas, 'Stress did not reach live world rendering');
    assert.deepEqual(first.starts, [{ stageId, stress: true }], 'Unexpected start event or stage');
    result.initial = first;
    flush();
    const activeStart = performance.now();
    let checkpointMs = Math.min(durationMs, 15000);
    let sampledMidpoint = false;

    while (true) {
      await sleep(Math.max(0, activeStart + checkpointMs - performance.now()));
      const state = await page.evaluate(observePage);
      assert(state.stressActive && state.hudVisible && !state.hidden && !state.hiddenTransitions && !state.closes && !state.choices,
        'The continuous run lost its foreground battle HUD, opened an upgrade or closed');
      assert(!state.workerErrors.length, `Worker errors: ${JSON.stringify(state.workerErrors)}`);
      const { time, lastFrame, hudText, canvas, world, maxOpponents, workerTickRoundTrip, paths } = state;
      const sample = { utc: new Date().toISOString(), checkpointMs, elapsedWallMs: performance.now() - activeStart,
        pageTimeMs: time, frame: lastFrame, hudText, canvas, world, maxOpponents, workerTickRoundTrip, paths };
      result.samples.push(sample);
      console.log(JSON.stringify({ checkpointMs, elapsedWallMs: Math.round(sample.elapsedWallMs), frame: lastFrame,
        hudText, maxOpponents, workerTickRoundTrip }));
      flush();
      if (resourceProbe && result.samples.length === 1) await sampleResources('first-battle-warm', false, lastFrame);
      if (resourceProbe && durationMs >= 60000 && checkpointMs >= durationMs / 2 && !sampledMidpoint) {
        await sampleResources('first-battle-midpoint', false, lastFrame);
        sampledMidpoint = true;
      }
      if (checkpointMs === durationMs) break;
      checkpointMs = Math.min(durationMs, checkpointMs + 15000);
    }

    if(settings.pauseSamples){
      result.inputLatency=await measurePauses(page,settings.pauseSamples);
      flush();
    }
    await openTab();
    await page.getByText('本次采样', { exact: true }).waitFor();
    result.elapsedWallMs = performance.now() - activeStart;
    if (resourceProbe) await sampleResources('first-battle-paused', true, (await page.evaluate(observePage)).lastFrame);
    // Settings has already frozen the world. Restore the onscreen HUD only for the screenshot.
    await capture('hud', image => page.screenshot({ path: image, timeout: 10000,
      style: '.web-backdrop { visibility: hidden !important; } .stress-live[hidden] { display: block !important; }' }));
    await exitBattle();
    const report = page.getByRole('region', { name: '压测统计' });
    result.report = await readReport(report);
    const loadout = page.getByText('实际配置 · 15 项技能 · 135 次强化', { exact: true });
    await loadout.click();
    result.loadoutTable = await page.getByRole('table').innerText();
    result.final = await page.evaluate(observePage);
    result.progressAfter = await page.evaluate(progress);
    result.scoresUnchanged = JSON.stringify(result.progressAfter) === JSON.stringify(result.progressBefore);
    result.backendFallback = result.report.latestConfig.renderer !== backend;
    flush();
    if (resourceProbe) await sampleResources('after-first-exit', true, result.final.lastFrame);

    await capture('report', async image => {
      const dialog = page.getByRole('dialog');
      const temporaryStyle = await page.addStyleTag({ content:
        '.web-backdrop { position:fixed !important; inset:0 auto auto 0 !important; width:100vw !important; height:auto !important; padding:0 !important; transform:none !important; display:block !important; }' +
        '.web-panel { margin:0 auto !important; height:fit-content !important; max-height:none !important; overflow:visible !important; }' });
      try {
        await dialog.evaluate(panel => { panel.scrollTop = 0; });
        const naturalHeight = await dialog.evaluate(panel => Math.ceil(panel.getBoundingClientRect().height), undefined, { timeout: 5000 });
        assert(naturalHeight <= 2100, `Report exceeds screenshot height limit: ${naturalHeight}px`);
        await page.setViewportSize({ width: viewport.width, height: Math.max(viewport.height, naturalHeight + 64) });
        await dialog.screenshot({ path: image, timeout: 10000 });
      } finally {
        await temporaryStyle.evaluate(style => style.remove());
      }
    });

    assert(result.report.activeMs >= durationMs - 5, `Only ${result.report.activeMs} ms recorded out of ${durationMs} ms requested`);
    assert(result.report.intervals > 0 && result.final.world.frame > first.world.frame, 'No frame progression during the run');
    assert(Object.values(result.report.worstSecond.counts).every(Number.isFinite), 'Worst second lacks a load count');
    assert.equal(result.report.latestConfig.speed, 2, 'Unexpected simulation speed');
    assert(result.final.workerTickRoundTrip.count > 0 && result.final.workerTickRoundTrip.invalidTicks === 0,
      'No valid positive-speed Worker tick round trips or mismatched protocol');
    assert.equal(result.report.latestConfig.renderer, result.samples.at(-1).canvas.renderer, 'Report does not match the observed renderer');
    assert.deepEqual(result.final.starts, [{ stageId, stress: true }]);
    assert.equal(result.final.closes, 1, 'Expected exactly one stress run to close');
    assert(!result.final.stressActive && !result.final.choices && !result.final.hiddenTransitions, 'Stress lifecycle departed from one visible run');
    assert(result.scoresUnchanged && result.final.scoreEvents.length === 0, 'The stress run changed gameplay records');
    assert(!result.final.workerErrors.length && !result.pageErrors.length && !result.requestErrors.length && !result.otherOrigins.length,
      'The run observed worker, browser, HTTP or external request errors');
    if (resourceProbe) {
      await page.setViewportSize(viewport);
      await enterBattle();
      await page.waitForFunction(() => window.builtinSoak().lastFrame >= 90);
      await openTab();
      const second = await page.evaluate(observePage);
      assert(second.starts.length === 2 && second.closes === 1 && second.stressActive, 'Second resource battle did not start');
      await sampleResources('second-battle-paused', true, second.lastFrame);
      await exitBattle();
      await page.waitForFunction(() => window.builtinSoak().closes === 2);
      const secondExit = await page.evaluate(observePage);
      assert(secondExit.closes === 2 && !secondExit.stressActive && !secondExit.workerErrors.length,
        'Second resource battle did not close cleanly');
      await sampleResources('after-second-exit', true, secondExit.lastFrame);
      result.resourceDiagnostics.lifecycle = { starts: secondExit.starts.length, closes: secondExit.closes,
        secondBattleFrame: second.lastFrame };
    }
    result.complete = true;
    result.screenshotsComplete = Object.keys(result.screenshotErrors).length === 0;
    console.log(JSON.stringify({ result: output('.json'), report: result.report, backendFallback: result.backendFallback,
      workerTickRoundTrip: result.final.workerTickRoundTrip, paths: result.final.paths, screenshotErrors: result.screenshotErrors }));
  } catch (error) {
    result.fatal = error.stack ?? String(error);
    if (page && result.initial && !result.final) {
      result.lastObservation = await page.evaluate(observePage).catch(() => null);
      result.failureScreen = await page.evaluate(() => ({
        scene: document.querySelector('#app .screen')?.getAttribute('aria-label'),
        alerts: [...document.querySelectorAll('[role="alert"], .fatal-panel')].map(panel => panel.textContent?.trim()),
        body: document.body.innerText.slice(0, 1600),
        canvases: [...document.querySelectorAll('canvas')].map(canvas => ({ label: canvas.ariaLabel, width: canvas.width, height: canvas.height })),
      })).catch(() => null);
      await capture('failure', image => page.screenshot({ path: image, timeout: 5000 }));
    }
    throw error;
  } finally {
    result.endUtc = new Date().toISOString();
    flush();
    resourceProbe?.close();
    try {
      if (profile) await context?.close();
      else await browser?.close();
    } finally { server?.close(); }
  }
}

Promise.resolve().then(options).then(main).catch(error => {
  console.error(error.stack ?? error);
  process.exitCode = 1;
});

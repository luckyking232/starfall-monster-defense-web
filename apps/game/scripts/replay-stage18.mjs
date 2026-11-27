// Local Stage 18 A/B using the original buttons and Lua. No instrumentation enters a player build.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { build } from 'vite';
import { rolldown } from 'rolldown';
import { buildStageAssets } from './build-stage-assets.ts';

const app = fileURLToPath(new URL('../', import.meta.url));
const root = path.resolve(process.env.STARFALL_BENCH_SOURCE ?? app);
const evidence = path.resolve(process.argv[2] ?? 'test-results/stage18-replay');
const variants = (process.argv[3] ?? 'canvas,webgl').split(',');
const endFrame = Number(process.argv[4] ?? 1550);
const captureFrames = process.argv[5]?.split(',').map(Number) ?? [];
const clockMode = process.env.STARFALL_BENCH_CLOCK ?? 'fixed';
const speed = Number(process.env.STARFALL_BENCH_SPEED ?? 1);
if (!['fixed', 'real'].includes(clockMode) || ![1, 2].includes(speed) || (speed === 2 && clockMode !== 'real')) {
  throw new Error('Use STARFALL_BENCH_CLOCK=fixed|real and STARFALL_BENCH_SPEED=1|2 (2× requires real mode)');
}
const runId = new Date().toISOString().replace(/[:.]/g, '-');
fs.mkdirSync(evidence, { recursive: true });
const dist = fs.mkdtempSync(path.join(evidence, 'site-'));

function replace(code, before, after) {
  if (!code.includes(before)) throw new Error(`Missing replay marker ${before}`);
  return code.replace(before, after);
}

function instrumentOverlap(source) {
  source = source.replaceAll('\r\n', '\n');
  source = replace(source, '  let pendingWorld: RuleState | undefined;', `  let pendingWorld: RuleState | undefined;
  const probeOverlap = new URLSearchParams(location.search).has('probeOverlap');`);
  source = replace(source, '      await client.tick(elapsed);', `      const completion = client.tick(elapsed);
      // Submit the next Lua step before drawing the previous snapshot in this RAF.
      if (probeOverlap) paintPendingWorld();
      await completion;`);
  source = replace(source, `    if (worldFrame || !pendingWorld || !running || stopped || document.hidden || modalOpen) return;
    worldFrame = requestAnimationFrame(() => {`, `    if (probeOverlap || worldFrame || !pendingWorld || !running || stopped || document.hidden || modalOpen) return;
    worldFrame = requestAnimationFrame(paintPendingWorld);
  }
  function paintPendingWorld(): void {`);
  return replace(source, '    });\n  }\n  function stopWorldFrame(): void {', '  }\n  function stopWorldFrame(): void {');
}

await build({ configFile:false, root, publicDir:false, base:'./',
  define: {
    __STARFALL_ASSET_DIRECTORY__: JSON.stringify('assets/'),
    __STARFALL_STAGE_ASSETS__: JSON.stringify(await buildStageAssets(root)),
  },
  build: { outDir:dist, target:'es2022', emptyOutDir:false },
  plugins: [{ name:'stage18-draw-probe', enforce:'pre', transform(source,id) {
    if (id.replaceAll('\\', '/').endsWith('/src/main.ts')) {
      if (variants.some(variant => variant.endsWith('-overlap'))) source = instrumentOverlap(source);
      return source.includes('world?.render(state)')
        ? replace(source, 'world?.render(state)', 'window.perfDraw(() => world?.render(state), state)')
        : replace(source, 'world?.render(event.state)', 'window.perfDraw(() => world?.render(event.state), event.state)');
    }
    if (id.replaceAll('\\', '/').endsWith('/src/ui/original-window.ts')) {
      return replace(source, 'for (const op of message.ops) this.apply(op);',
        'const started = performance.now(); for (const op of message.ops) this.apply(op); window.perfOps(message.ops, performance.now() - started);');
    }
  } }],
});

const bundle = await rolldown({input:path.join(root,'runtime/ui/host-worker.ts'), platform:'browser',
  plugins:[{name:'stage18-rule-probe', transform(source,id) {
    const filename = id.replaceAll('\\', '/');
    if (filename.endsWith('/runtime/ui/host.ts')) {
      const decode = source.includes('decodeBattleSnapshot(tickBattle(signal.ms))') ? 'decodeBattleSnapshot' : 'JSON.parse';
      for (const [before,after] of [
        ["case 'rng.seed': return io.randomSeed?.() ?? (crypto.getRandomValues(new Uint32Array(1))[0]! & 0x7fffffff);", "case 'rng.seed': return 70441022;"],
        ["lua.global.set('__HostCall', hostCall);", "lua.global.set('__HostCall', hostCall);\n lua.global.set('__PerfNow', key => { self.__perfLua[key] = performance.now(); });"],
        [`const state = ${decode}(tickBattle(signal.ms));`, `const data = self.__perfLua = {start:performance.now()}; const raw = tickBattle(signal.ms); data.luaEnd=performance.now(); const state = ${decode}(raw); data.parseEnd=performance.now(); data.rawBytes=raw.length; if (state) state.samplePerf=data;`],
        ['options.postMessage(message);', 'options.postMessage({...message, perfSent: performance.timeOrigin + performance.now()});'],
      ]) source = replace(source,before,after);
      return source;
    }
    if (filename.endsWith('/runtime/ui/battle.ts')) {
      source = source.replaceAll('\r\n', '\n');
      const encode = source.includes('__JsonEncode({control.curFixedFrame') ? 'control' : 'fixedFrame=control';
      for (const [before,after] of [
        ['function __WebBattleTick(milliseconds)\n', 'function __WebBattleTick(milliseconds)\n  __PerfNow("luaStart")\n'],
        ['  if fixed and not MiniGameBattleControl.isPause then\n', '  __PerfNow("beforeFixed")\n  if fixed and not MiniGameBattleControl.isPause then\n'],
        ['    if display and not MiniGameBattleControl.isPause then display() end', '    __PerfNow("afterFixed")\n    if display and not MiniGameBattleControl.isPause then display() end'],
        [`  return __JsonEncode({${encode}.curFixedFrame or 0`, `  __PerfNow("beforeEncode")\n  return __JsonEncode({${encode}.curFixedFrame or 0`],
      ]) source = replace(source,before,after);
      return source;
    }
  }}],
});
const { output } = await bundle.generate({format:'iife'});
const worker = output.find(item => item.type === 'chunk').code;
await bundle.close();

const mime = {
  '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
  '.wasm':'application/wasm','.png':'image/png','.webp':'image/webp','.mp3':'audio/mpeg','.ogg':'audio/ogg',
  '.woff2':'font/woff2','.lua':'text/plain',
};
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname;
  const relative = name === '/' ? 'index.html' : decodeURIComponent(name).slice(1);
  if (relative.split(/[\\/]/).includes('..')) { res.writeHead(400).end(); return; }
  const compiled = path.join(dist, relative);
  const file = fs.existsSync(compiled) ? compiled : path.join(root, 'public', relative);
  const contentType = mime[path.extname(file)] ?? 'application/octet-stream';
  if (name === '/assets/ui-host-worker.js') {
    res.writeHead(200, {'content-type':contentType});
    res.end(worker);
  } else if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.writeHead(200, {'content-type':contentType});
    fs.createReadStream(file).pipe(res);
  } else {
    res.writeHead(404); res.end();
  }
});

async function run(browser, origin, variant) {
  const renderer = variant.replace(/-overlap$/, '');
  const overlap = variant !== renderer;
  const context = await browser.newContext({viewport:{width:1334,height:750}});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(({captureFrames, clockMode}) => {
    const schema = 'starfall.monster-defense.progress/1';
    for (let stageId=78000001; stageId<78000018; stageId++) {
      const value = JSON.stringify({schema, stageId, settlement:'confirmed_natural_win'});
      localStorage.setItem(`${schema}/${stageId}`, value);
      localStorage.setItem(`starfall.web-test:${schema}/${stageId}`, value);
    }
    const perf = window.gamePerf = {ticks:[], errors:[], cards:[], graphics:[], rAF:[], longTasks:[], captures:{}, chooser:null, battle:false};
    new PerformanceObserver(list => {
      if (perf.battle) for (const item of list.getEntries()) perf.longTasks.push([perf.frame,item.duration]);
    }).observe({type:'longtask'});
    const frameRecords = new WeakMap();
    let lastDraw = 0;
    let countDraw2d=0, countFullCanvas=0, countGl=0, countFgui=0, oldRaf=0;
    const originalCanvas = HTMLCanvasElement.prototype.getContext;
    const names = new WeakMap();
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      const c = originalCanvas.call(this, type, ...args);
      if (c && !names.has(c)) {
        const label = this.getAttribute('aria-label') ?? 'unlabeled';
        names.set(c, type === '2d' ? label : this.id ? 'fgui' : 'mesh');
        if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') {
          const ext = c.getExtension('WEBGL_debug_renderer_info');
          perf.graphics.push({type, width:this.width, height:this.height, renderer:ext ? c.getParameter(ext.UNMASKED_RENDERER_WEBGL) : c.getParameter(c.RENDERER)});
        }
      }
      return c;
    };
    const drawImage = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function(...args) {
      if (names.get(this) === '战场画面') {
        countDraw2d++;
        if (args[0] instanceof HTMLCanvasElement) countFullCanvas++;
      }
      return drawImage.apply(this,args);
    };
    for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
      for (const key of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced']) {
        const original=proto[key];
        if (typeof original !== 'function') continue;
        proto[key]=function(...args) {
          countGl++;
          return original.apply(this,args);
        };
      }
    }
    let rec;
    window.perfDraw=(draw,state) => {
      const t=performance.now(), prevGl=countGl, prev2d=countDraw2d, prevCopies=countFullCanvas;
      draw();
      const record = frameRecords.get(state);
      if (!record) return;
      record.drawMs=performance.now()-t;
      record.drawDelta=lastDraw ? t-lastDraw : null;
      record.drawStarted=t;
      lastDraw=t;
      record.worldGl=countGl-prevGl;
      record.world2d=countDraw2d-prev2d;
      record.fullCopies=countFullCanvas-prevCopies;
      if (!state.paused && captureFrames.includes(state.fixedFrame) && !perf.captures[state.fixedFrame]) {
        const canvas = document.querySelector('canvas[aria-label="战场画面"]');
        perf.captures[state.fixedFrame] = canvas.toDataURL('image/png');
      }
    };
    window.perfOps=(ops,ms)=> {
      if (rec) { rec.opsMs=(rec.opsMs??0)+ms; }
    };
    function raf(t) {
      if(perf.battle && oldRaf) {
        perf.rAF.push([perf.frame,t-oldRaf,countGl-countFgui]);
      }
      countFgui=countGl;
      oldRaf=t;
      requestAnimationFrame(raf);
    }
    requestAnimationFrame(raf);
    const NativeWorker=window.Worker;
    window.Worker=class extends NativeWorker {
      constructor(url, options) {
        super(url, options);
        this.addEventListener('message', ({data:d})=> {
          const received=performance.timeOrigin+performance.now();
          if (d.type==='error') perf.errors.push(d.message);
          if (d.type==='open' && d.window==='Activity17MiniGameChoice2Window') {
            perf.chooser=d.tree.children.find(node=>node.name==='Main')?.children.find(node=>node.name==='TipsList')?.id;
          }
          if (d.type==='open' && d.window==='MiniGameSkillChoiceWindow') {
            perf.cards=[];
            perf.list=d.tree.children.find(node=>node.name==='Main')?.children.find(node=>node.name==='TipsList')?.id;
          }
          if (d.type==='close' && d.window==='MiniGameSkillChoiceWindow') { perf.cards=[]; perf.list=null; }
          if (d.type==='ops') for(const op of d.ops) {
            if(op.op==='scroll' && op.id===perf.chooser) perf.scroll=op.x;
            if(op.op==='list-clear' && op.id===perf.list) perf.cards=[];
            if(op.op==='list-add' && op.id===perf.list) perf.cards.push({id:op.item.id,revealed:false});
            if(op.op==='transition-play' && op.name==='up') {
              const card=perf.cards.find(entry=>entry.id===op.id);
              if(card) card.revealed=true;
            }
          }
          if (d.type==='event' && d.event.name==='start-battle') perf.stage=d.event.stageId;
          if (d.type==='event' && d.event.name==='world' && d.event.state.stageId===78000018 && rec) {
            perf.battle=true;
            const state=d.event.state;
            frameRecords.set(state, rec);
            perf.frame=state.fixedFrame;
            perf.paused=state.paused;
            perf.speedIndex=state.speedIndex;
            const players = state.units.filter(unit=>unit.cardId>=78000101 && unit.cardId<=78000105);
            if (captureFrames.includes(state.fixedFrame)) {
              const {samplePerf, ...world} = state;
              rec.state = JSON.stringify(world);
            }
            Object.assign(rec,{
              frame:state.fixedFrame, paused:state.paused, speed:state.speedIndex,
              enemies:state.units.filter(unit=>unit.model && unit.camp!==players[0]?.camp).length,
              kills:state.killEnemyCount, wave:state.curMonsterWave, level:state.curLevel,
              bullets:state.bullets.length, effects:state.effects.length,
              worldTransit:received-d.perfSent, lua:state.samplePerf,
            });
          }
          if(d.type==='ops' && rec && perf.battle){
            rec.ops=(rec.ops??0)+d.ops.length;
            rec.hurt=(rec.hurt??0)+d.ops.filter(op=>op.op==='child-add' && /HitNumberTips|HpNumberTips/i.test(`${op.item.name} ${op.item.refName}`)).length;
            if (!perf.childNames) perf.childNames=[];
            if(perf.childNames.length<70) perf.childNames.push(...d.ops.filter(op=>op.op==='child-add').map(op=>[op.item.name,op.item.refName,op.item.children.map(child=>child.name)]));
          }
          if(d.type==='settled' && rec?.requestId===d.requestId){
            rec.rtt=performance.now()-rec.started;
            if (Number.isFinite(rec.frame)) perf.ticks.push(rec);
            rec=null;
          }
        });
      }
      postMessage(message,...extra){
        if (message.type==='presentation' && message.signal.kind==='tick') {
          rec={requestId:message.requestId,started:performance.now(),realDelta:message.signal.ms};
          if (clockMode === 'fixed') message.signal.ms=1000/30;
          rec.inputMs = message.signal.ms;
        }
        return super.postMessage(message,...extra);
      }
    };
  },{captureFrames, clockMode});
  await page.goto(`${origin}?world=${renderer}${overlap ? '&probeOverlap' : ''}`);
  const click=async(x,y)=> {
    const canvas=page.locator('#app canvas:visible').last();
    await canvas.waitFor();
    const bounds=await canvas.boundingBox();
    await page.mouse.click(bounds.x+x/1334*bounds.width,bounds.y+y/750*bounds.height);
  };
  await page.getByRole('region',{name:'魔物抵御战活动主页'}).waitFor({timeout:45000});
  try {
    await page.locator('#startup').waitFor({state:'hidden',timeout:30000});
    await click(1147,679);
    await page.getByRole('region',{name:'选择关卡',exact:true}).waitFor({timeout:25000});
  } catch (error) {
    await page.screenshot({path:path.join(evidence,`${runId}-${variant}-startup-failed.png`)});
    const details = await page.evaluate(() => ({errors:window.gamePerf.errors, text:document.body.innerText,
      screen:[innerWidth,innerHeight], canvas:[...document.querySelectorAll('canvas')].map(canvas=>canvas.getBoundingClientRect().toJSON())}));
    console.error({ pageErrors:errors, ...details });
    throw error;
  }
  await page.waitForFunction(()=>window.gamePerf.scroll===-3230);
  const choicePkg=await (await page.request.get(`${origin}assets/fgui/ActivityDungeon1017.json`)).json();
  const battlePkg=await (await page.request.get(`${origin}assets/fgui/ActivityDungeon1017Battle.json`)).json();
  const list=choicePkg.components[choicePkg.componentIndex.MiniGameChoice2].children.find(node=>node.name==='TipsList');
  const map=choicePkg.components[list.defaultItem.slice(13)];
  const stage=map.children.find(node=>node.name==='Tips18Btn');
  const button=choicePkg.components[stage.src];
  const offers=battlePkg.components[battlePkg.componentIndex.SkillChoice].children.find(node=>node.name==='TipsList');
  const offerCard=battlePkg.components[offers.defaultItem.slice(13)];
  const scroll=Math.max(-(map.width-list.width),-3230);
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  await click(list.x+scroll+stage.x+button.width/2,list.y+stage.y+button.height/2);
  await page.getByRole('region',{name:'魔物抵御战战场',exact:true}).waitFor({timeout:35000});
  const picks=[];
  let pauseCheck;
  if (clockMode === 'real') {
    const top = battlePkg.components[battlePkg.componentIndex.BattleTop];
    const press = name => {
      const node = top.children.find(child => child.name === name);
      const component = battlePkg.components[node.src];
      return click(node.x + (node.width ?? component.width) / 2, node.y + (node.height ?? component.height) / 2);
    };
    await page.waitForFunction(() => window.gamePerf.frame >= 15 && !window.gamePerf.paused);
    if (speed === 2) await press('SpeedBtn');
    await page.waitForFunction(expected => window.gamePerf.frame >= 60 && !window.gamePerf.paused && window.gamePerf.speedIndex === expected, speed);
    await press('PauseBtn');
    await page.getByRole('region',{name:'战斗暂停',exact:true}).waitFor();
    await page.waitForFunction(() => window.gamePerf.paused);
    const before = await page.evaluate(() => window.gamePerf.frame);
    await page.waitForTimeout(240);
    const after = await page.evaluate(() => window.gamePerf.frame);
    if (before !== after) throw new Error(`Rules advanced while paused from ${before} to ${after}`);
    await click(667,375);
    await page.waitForFunction(({frame, expected}) => !window.gamePerf.paused && window.gamePerf.frame > frame &&
      window.gamePerf.speedIndex === expected, {frame:after, expected:speed});
    pauseCheck = {before, after, resumed:await page.evaluate(() => window.gamePerf.frame), speed};
  }
  console.log(variant,'entered stage',await page.evaluate(()=>window.gamePerf.stage));
  while (true) {
    await page.waitForFunction(limit=>window.gamePerf.frame>=limit || window.gamePerf.cards.length && window.gamePerf.cards.every(card=>card.revealed),endFrame,{timeout:100000,polling:100});
    const {frame,cards}=await page.evaluate(()=>({frame:window.gamePerf.frame,cards:window.gamePerf.cards}));
    if(frame>=endFrame) break;
    const width=cards.length*offerCard.width+(cards.length-1)*offers.columnGap;
    await click(offers.x+Math.floor((offers.width-width)/2)+offerCard.width/2,offers.y+offerCard.height/2);
    await click(667,654);
    picks.push(frame);
    await page.waitForFunction(()=>!window.gamePerf.cards.length || !window.gamePerf.cards.every(card=>card.revealed));
  }
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const data=await page.evaluate(()=>({...window.gamePerf,userAgent:navigator.userAgent,dpr:window.devicePixelRatio,
    screen:[innerWidth,innerHeight],worldRenderer:document.querySelector('canvas[aria-label="战场画面"]').dataset.renderer ?? 'baseline'}));
  data.picks=picks;
  data.clockMode=clockMode;
  data.requestedSpeed=speed;
  data.overlap=overlap;
  data.pauseCheck=pauseCheck;
  data.pageErrors=errors;
  const label = clockMode === 'fixed' ? `${runId}-${variant}` : `${runId}-${speed}x-${variant}`;
  for (const [frame,url] of Object.entries(data.captures)) {
    const filename = `${label}-frame-${frame}.png`;
    fs.writeFileSync(path.join(evidence, filename), Buffer.from(url.split(',')[1], 'base64'));
    data.captures[frame] = filename;
  }
  fs.writeFileSync(path.join(evidence, `${label}.json`),JSON.stringify(data));
  console.log(variant, 'complete', {ticks:data.ticks.length, frame:data.frame,picks, errors:data.errors,pageErrors:errors,renderers:data.graphics});
  await context.close();
  if (errors.length || data.errors.length || data.frame < endFrame || (renderer === 'webgl' && data.worldRenderer !== 'webgl')) {
    throw new Error('Stage 18 replay did not reach the requested frame and renderer without errors');
  }
}

(async()=> {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}/`;
  let browser;
  try {
    browser=await chromium.launch({channel:process.platform === 'win32' ? 'msedge' : undefined,
      executablePath:process.env.CHROME_PATH, headless:true, args:['--enable-unsafe-swiftshader']});
    console.log('Edge',browser.version(),'local server',origin);
    const cdp=await browser.newBrowserCDPSession();
    const system=await cdp.send('SystemInfo.getInfo');
    fs.writeFileSync(path.join(evidence,`${runId}-graphics.json`),JSON.stringify(system.gpu,null,2));
    for (const variant of variants) await run(browser,origin,variant);
  } finally {
    await browser?.close();
    server.close();
  }
})().catch(error=>{ console.error(error); process.exitCode=1; });

import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const traceSource = readFileSync(new URL('./rule-trace.lua', import.meta.url), 'utf8');
const activityStartStamp = 1_700_000_000;
const serverNowStamp = 1_764_000_000;
const stage1Picks = [0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1];
const stage1PickFrames = [344, 654, 1052, 1660, 1842, 2022, 2308, 2645, 3042, 3423, 3822];
const endlessControls = [
  { frame: 48, action: 'speed' },
  { frame: 600, action: 'pause' },
  { frame: 1800, action: 'speed' },
  { frame: 3000, action: 'pause-resume' },
  { frame: 4200, action: 'exit-cancel' },
];
const stageId = stage => 78000000 + (stage === 'stress' ? 21 : stage);
const find = (node, ...names) => names.reduce((parent, name) => {
  const child = parent?.children.find(entry => entry.name === name);
  if (!child) throw new Error(`no original UI child ${name} in ${parent?.name}`);
  return child;
}, node);

export async function replayRules({
  createHost, publicDir, stage, lastFrame = stage === 1 ? 4181 : stage === 18 ? 1550 : 780,
  seed, watch = stage === 1 ? 'settlement' : 'frame', stepBudget, extraRandomFrame, writeRecord, observeEvent,
}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'starfall-rule-replay-'));
  const records = [], inputs = {}, choices = [];
  const controls = stage === 21 ? endlessControls : [];
  const messages = [];
  const windows = new Map(), lists = new Map(), transitions = new Map();
  const summary = {
    frames: 0, fixedCallbacks: 0, peakAliveMonsters: 0, tierFrames: {}, events: {}, usedSkills: {}, choices, settlement: null,
    attackSpeedChanges: 0, freezeFrames: 0, unitTimeStopFrames: 0,
  };
  const attackSpeeds = new Map();
  let gameSpeed = stage === 'stress' ? 2 : 1, nextControl = 0;
  let engine, drain, host, previousFrame = 0, requestId = 0, seedCalls = 0;
  function save(record, raw = JSON.stringify(record)) {
    if (writeRecord) writeRecord(raw);
    else records.push(record);
  }
  function accept(raw) {
    const record = JSON.parse(raw);
    if (record.kind === 'fixed') {
      if (record.frame !== previousFrame + 1) throw new Error(`fixed() advanced from ${previousFrame} to ${record.frame}`);
      previousFrame = record.frame;
      summary.fixedCallbacks += 1;
      summary.frames = record.frame;
      summary.peakAliveMonsters = Math.max(summary.peakAliveMonsters, record.state.aliveMonsters);
      if (record.state.wave && summary.tierFrames[record.state.wave] === undefined) {
        summary.tierFrames[record.state.wave] = record.frame;
      }
      let frozen = false, timeStopped = false;
      for (const unit of record.state.units) {
        if (attackSpeeds.has(unit.uid) && attackSpeeds.get(unit.uid) !== unit.attackSpeed) summary.attackSpeedChanges++;
        attackSpeeds.set(unit.uid, unit.attackSpeed);
        frozen ||= unit.frozen;
        timeStopped ||= unit.stopped;
      }
      if (frozen) summary.freezeFrames++;
      if (timeStopped) summary.unitTimeStopFrames++;
    }
    for (const event of record.events) {
      summary.events[event.type] = (summary.events[event.type] ?? 0) + 1;
      if (event.type === 'skill-hit' && event.skill !== undefined) {
        summary.usedSkills[event.skill] = (summary.usedSkills[event.skill] ?? 0) + 1;
      }
    }
    save(record, raw);
  }
  function collect(message) {
    messages.push(message);
    if (message.type === 'event') observeEvent?.(message.event);
    if (message.type === 'open') windows.set(message.window, message);
    if (message.type === 'close') windows.delete(message.window);
    if (message.type === 'ops') for (const op of message.ops) {
      if (op.op === 'transition-play') transitions.set(op.name, op.playId);
      if (op.op === 'list-items') lists.set(op.id, op.items);
      if (op.op === 'list-clear') lists.set(op.id, []);
      if (op.op === 'list-add') {
        if (!lists.has(op.id)) lists.set(op.id, []);
        lists.get(op.id).push(op.item);
      }
    }
  }
  function open(name) {
    if (!windows.has(name)) throw new Error(`original window did not open: ${name}`);
    return windows.get(name);
  }
  function flush() {
    drain?.();
    for (const message of messages) {
      if (message.type === 'error') throw new Error(message.message);
      if (message.type === 'event' && ['start-battle', 'settlement', 'clear-earned', 'stress-loadout'].includes(message.event.name)) {
        const event = message.event;
        if (event.name === 'settlement') summary.settlement = event;
        if (event.name === 'stress-loadout') {
          const { cards, upgrades } = event.report;
          const unlockedSkills = cards.flatMap(card => card.skills).filter(skill => skill.unlocked === true).length;
          summary.loadout = { heroes: cards.length, unlockedSkills, upgrades };
        }
        save({ frame: event.frame ?? previousFrame, kind: 'host-event', event });
      }
    }
  }
  async function act(method, value, input) {
    messages.length = 0;
    if (input) save({ frame: previousFrame, kind: 'input', ...input });
    await host[method](++requestId, host.session, value);
    flush();
  }
  const click = (node, action, data) => act('click', node.id, { action, ...data });
  const present = (signal, action) => act('present', signal, action && { action });
  async function tick(ms, action) {
    await present({ kind: 'tick', ms, stepBudget }, action);
    while (messages.some(message => message.type === 'settled' && message.moreSteps)) {
      await present({ kind: 'tick', ms: 0, stepBudget, resume: true });
    }
  }
  function lastTransition(name) {
    if (!transitions.has(name)) throw new Error(`original transition missing: ${name}`);
    return transitions.get(name);
  }
  const finishTransition = (playId, name, label) => present({ kind: 'transition', playId, label }, name);

  async function performControl(control, hud) {
    const top = find(hud.tree, 'Main', 'Top');
    if (control.action === 'speed') {
      gameSpeed = gameSpeed === 1 ? 2 : 1;
      await click(find(top, 'SpeedBtn'), 'speed', { speed: gameSpeed });
      return;
    }
    if (control.action === 'exit-cancel') {
      await click(find(top, 'ReturnBtn'), 'open-exit');
      await click(find(open('MiniGameBattleExitWindow').tree, 'Main', 'CancelBtn'), 'cancel-exit');
      return;
    }
    await click(find(top, 'PauseBtn'), 'pause');
    const pause = open('MiniGameBattlePauseWindow');
    if (control.action === 'pause') {
      await tick(250, 'hold-pause');
      if (previousFrame !== control.frame) throw new Error(`pause advanced rules to ${previousFrame}`);
    }
    await click(find(pause.tree, 'Main', 'TouchScreenBtn'), 'resume');
  }

  try {
    const io = {
      async loadBytes(relative) {
        const stored = readFileSync(path.join(publicDir, relative));
        const payload = relative.endsWith('.gz') ? gunzipSync(stored) : stored;
        const hash = data => createHash('sha256').update(data).digest('hex');
        inputs[relative] = { storedSha256: hash(stored), payloadSha256: hash(payload), bytes: stored.length };
        return payload;
      },
      async createLuaEngine(vendor, wasm) {
        writeFileSync(path.join(dir, 'vendor.cjs'), vendor);
        writeFileSync(path.join(dir, 'glue.wasm'), wasm);
        const { LuaFactory } = require(path.join(dir, 'vendor.cjs'));
        const factory = new LuaFactory(path.join(dir, 'glue.wasm'));
        engine = await factory.createEngine({
          openStandardLibs: true, injectObjects: false, enableProxy: false, functionTimeout: 30000,
        });
        return engine;
      },
    };
    if (seed !== undefined) io.randomSeed = () => { seedCalls += 1; return seed; };
    host = createHost({
      postMessage: collect, runtimeBase: 'https://starfall-rule-replay.invalid/', gameplay: true, io,
      activityStartStamp, serverNowStamp, clearedStageIds: stage === 'stress' ? [] :
        Array.from({ length: stage - 1 }, (_, index) => stageId(index + 1)),
    });
    await host.init(++requestId);
    flush();
    engine.global.set('__RuleTraceEmit', accept);
    engine.global.set('__RuleTraceStage1Fixture', stage === 1);
    if (extraRandomFrame !== undefined) engine.global.set('__RuleTraceExtraRandomFrame', extraRandomFrame);
    await engine.doString(traceSource);
    drain = engine.global.get('__RuleTraceDrain');

    const home = open('Activity17MiniGame2MainWindow');
    await click(find(home.tree, 'Main', 'StartBtn'), 'open-chooser');
    if (stage === 'stress') {
      await present({ kind: 'start-stress' }, 'start-stress');
    } else {
      const list = find(open('Activity17MiniGameChoice2Window').tree, 'Main', 'TipsList');
      const [map] = lists.get(list.id);
      await click(find(map, stage === 21 ? 'SpecialBtn' : `Tips${stage}Btn`), 'choose-stage', { stage });
    }

    await finishTransition(lastTransition('in1'), 'loading-in');
    const hud = open('MiniGameBattleUIWindow');
    await present({ kind: 'shown', rootId: hud.rootId }, 'hud-shown');
    await finishTransition(lastTransition('out1'), 'loading-out');
    const intro = lastTransition('in');
    await finishTransition(intro, 'intro-sign', 'Sign');
    await finishTransition(intro, 'intro-end');
    await finishTransition(lastTransition('up'), 'hud-up');

    for (let turns = 0; (previousFrame < lastFrame) && !summary.settlement; turns++) {
      if (turns >= 8000) throw new Error(`replay stalled at frame ${previousFrame}`);
      const choice = windows.get('MiniGameSkillChoiceWindow');
      if (choice) {
        const choiceIndex = stage === 1 ? stage1Picks[choices.length] : 0;
        const list = find(choice.tree, 'Main', 'TipsList');
        const card = lists.get(list.id)?.[choiceIndex];
        if (!card) throw new Error(`missing choice index ${choiceIndex} at frame ${previousFrame}`);
        choices.push(previousFrame);
        await tick(701, 'reveal-choice');
        await click(card, 'select-card', { index: choiceIndex });
        await click(find(choice.tree, 'Main', 'Time', 'SureBtn'), 'confirm-card');
        continue;
      }
      const control = controls[nextControl];
      if (control?.frame === previousFrame) {
        await performControl(control, hud);
        nextControl++;
        continue;
      }
      const limit = Math.min(lastFrame, control?.frame ?? lastFrame);
      const ms = Math.min(250, (limit - previousFrame) * (1000 / 30) / gameSpeed);
      await tick(ms);
    }
    if (summary.frames !== lastFrame || (watch === 'settlement' && !summary.settlement)) {
      throw new Error(`stage ${stage} stopped at ${summary.frames} of ${lastFrame}: ${JSON.stringify(summary.settlement)}`);
    }
    if (stage === 1 && watch === 'settlement' &&
        (summary.settlement?.kills !== 205 || summary.settlement?.win !== true ||
        JSON.stringify(choices) !== JSON.stringify(stage1PickFrames))) {
      throw new Error(`stage 1 historical replay changed: ${JSON.stringify(summary)}`);
    }
    if (stage === 21 && (summary.settlement?.kills !== 573 || summary.settlement?.wave !== 4 || choices.length !== 16 ||
        summary.settlement?.endless?.source !== 'natural' || summary.settlement?.endless?.endedBy !== 'natural' ||
        nextControl !== controls.length)) {
      throw new Error(`ordinary endless replay changed: ${JSON.stringify(summary)}`);
    }
    if (stage === 'stress') {
      const { heroes, unlockedSkills, upgrades } = summary.loadout ?? {};
      if (heroes !== 5 || unlockedSkills !== 15 || upgrades !== 135) throw new Error('stress loadout changed');
      if (lastFrame === 780 && summary.peakAliveMonsters !== 300) {
        throw new Error(`stress replay did not peak at 300 alive: ${summary.peakAliveMonsters}`);
      }
      if (lastFrame === 780 && (!summary.attackSpeedChanges || !summary.unitTimeStopFrames)) {
        throw new Error('stress replay did not observe native attack speed changes and time stop');
      }
    }
    return { records, seedCalls, inputs, summary };
  } finally {
    await host?.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
}

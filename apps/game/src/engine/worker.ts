const RULES_PROTOCOL = 'starfall.monster-defense.rules/1';
const RULES_VERSION = '134395529309427262';
const RULES_FPS = 30;
type RuleEvent = import('./protocol').RuleEvent;

interface LuaApi {
  Start(tape: string, a: number, b: number): boolean;
  Fixed(count: number): number;
  Clock(ms: number): number;
  Select(window: number, generation: number, id: number, confirm: boolean): boolean;
  Snapshot(): string;
  Events(): string;
  Speed(speed: number): number;
  Pause(): string;
  Resume(): string;
  close(): void;
}

interface RuntimeSources {
  factory: {
    getLuaModule(): Promise<unknown>;
    createEngine(options: object): Promise<LuaEngine>;
  };
  spawn: string;
  prefixBridge: string;
  choice: string;
  choiceHelpers: string;
  engine: string;
  driver: string;
  controls: string;
  baseLua: [string, string][];
  prefixLua: [string, string][];
  extraLua: string;
}

interface LuaEngine {
  doString(source: string): Promise<void>;
  global: {
    get(name: string): unknown;
    close(): void;
  };
}

const BASE_LUA = [
  'BaseShootCard.lua', 'BaseShootMonsterGroup.lua', 'BaseShootStage.lua', 'BattleConst.lua',
  'MiniGameBattleConst.lua', 'MiniGameBattleControl.lua', 'MiniGameBattleData.lua',
  'MiniGameBattleMgr.lua', 'MiniGameBattleScene.lua',
];
const PREFIX_LUA = [
  'source-derived-helpers.lua', 'native-prefabs.lua',
  'BaseAttribute.lua', 'BaseShootSkill.lua', 'BaseShootSkillBuff.lua', 'BaseSkillParameter.lua',
  'CardAttribute.lua', 'MathUtil.lua', 'MiniGameBattleAction.lua', 'MiniGameBattleBuff.lua',
  'MiniGameBattleBuffEffect.lua', 'MiniGameBattleBuffMgr.lua', 'MiniGameBattleBullet.lua',
  'MiniGameBattleChoose.lua', 'MiniGameBattleDataCount.lua', 'MiniGameBattleUnit.lua',
];
const scope = self as unknown as {
  location: Location;
  wasmoon: { LuaFactory: new (url: string) => RuntimeSources['factory'] };
  decodeStage1Snapshot(raw: string): import('./protocol').RuleState;
  importScripts(...urls: string[]): void;
  crypto: Crypto;
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent) => void) | null;
};

let sourcesPromise: Promise<RuntimeSources> | null = null;
let active: { runId: string; api: LuaApi } | null = null;
let serial = Promise.resolve();
let runtimeBase = self.location.origin;

function fail(code: string, message: string): never {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  throw error;
}

async function runtimeFile(path: string): Promise<Uint8Array> {
  const url = new URL(`assets/runtime/${path}`, runtimeBase);
  if (url.origin !== self.location.origin) fail('runtime-origin', 'Runtime must share the app origin');
  const response = await fetch(url, { cache: 'no-store', redirect: 'error' });
  if (!response.ok) fail('runtime-missing', `${path}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const manifest = await runtimeManifest();
  const expected = manifest.files[path]?.sha256;
  if (!expected) fail('runtime-unlisted', path);
  const actual = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (x) => x.toString(16).padStart(2, '0')).join('');
  if (actual !== expected) fail('runtime-hash', path);
  return bytes;
}

interface RuntimeManifest {
  schema: string;
  gameResourceVersion: string;
  fileCount: number;
  files: Record<string, { bytes: number; sha256: string; provenance: string }>;
}
let manifestPromise: Promise<RuntimeManifest> | null = null;
async function runtimeManifest(): Promise<RuntimeManifest> {
  manifestPromise ??= fetch(new URL('assets/runtime/manifest.json', runtimeBase)).then(async (response) => {
    if (!response.ok) fail('runtime-manifest', `HTTP ${response.status}`);
    const manifest = await response.json() as RuntimeManifest;
    if (manifest.schema !== 'starfall.monster-defense.runtime-input/1' || manifest.gameResourceVersion !== RULES_VERSION) {
      fail('runtime-version', 'Unexpected runtime manifest');
    }
    return manifest;
  });
  return manifestPromise;
}

const text = async (path: string) => new TextDecoder('utf-8', { fatal: true }).decode(await runtimeFile(path));
const json = async (path: string) => JSON.parse(await text(path));
function runVerifiedJS(bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'text/javascript' }));
  try { scope.importScripts(url); } finally { URL.revokeObjectURL(url); }
}

async function loadSources(): Promise<RuntimeSources> {
  const [vendor, wasm, codec, spawn, prefixBridge, choice, choiceHelpers, engine, driver, controls, extraLua] = await Promise.all([
    runtimeFile('core-worker/inputs/vendor/index.js'),
    runtimeFile('core-worker/inputs/vendor/glue.wasm'),
    runtimeFile('core-worker/skill-choice/snapshot-codec.js'),
    text('core-worker/spawn-audit-bridge.lua'),
    text('core-worker/combat-prefix/bridge.lua'),
    text('core-worker/skill-choice/inputs/MiniGameSkillChoiceWindow.lua'),
    text('core-worker/skill-choice/inputs/choice-original-helpers.lua'),
    text('core-worker/skill-choice/engine.lua'),
    text('core-worker/skill-choice/driver.lua'),
    text('browser-stage1/transport-controls.lua'),
    text('summon-evidence/headless-extension.lua'),
  ]);
  runVerifiedJS(vendor);
  runVerifiedJS(codec);
  if (typeof scope.decodeStage1Snapshot !== 'function') fail('runtime-codec', 'Snapshot decoder missing');
  const wasmUrl = URL.createObjectURL(new Blob([wasm as BlobPart], { type: 'application/wasm' }));
  try {
    const factory = new scope.wasmoon.LuaFactory(wasmUrl);
    await factory.getLuaModule();
    const [baseLua, prefixLua] = await Promise.all([
      Promise.all(BASE_LUA.map(async (name) => [name, await text(`core-worker/inputs/lua/${name}`)] as [string, string])),
      Promise.all(PREFIX_LUA.map(async (name) => [name, await text(`core-worker/combat-prefix/inputs/${name}`)] as [string, string])),
    ]);
    return { factory, spawn, prefixBridge, choice, choiceHelpers, engine, driver, controls, baseLua, prefixLua, extraLua };
  } finally {
    URL.revokeObjectURL(wasmUrl);
  }
}

async function makeApi(runId: string): Promise<LuaApi> {
  sourcesPromise ??= loadSources();
  const source = await sourcesPromise;
  const lua = await source.factory.createEngine({
    openStandardLibs: true, injectObjects: false, enableProxy: false, functionTimeout: 5000,
  });
  try {
    for (const [, sourceText] of source.baseLua) await lua.doString(sourceText);
    for (const [name, sourceText] of source.prefixLua) {
      if (name === 'CardAttribute.lua') await lua.doString("TableData={GetTable=function(k) assert(k=='BaseAttribute');return BaseAttribute end}");
      await lua.doString(name === 'MathUtil.lua' ? `MathUtil=(function()\n${sourceText}\nend)()` : sourceText);
    }
    await lua.doString('OriginalCombat={AddUnit=MiniGameBattleSceneMgr.AddUnit,AddMonster=MiniGameBattleSceneMgr.AddMonster,AddBullet=MiniGameBattleSceneMgr.AddBullet,UpdateBattleOverState=MiniGameBattleSceneMgr.UpdateBattleOverState,UpdateProcess=MiniGameBattleSceneMgr.UpdateProcess}');
    const helpers = Object.fromEntries(source.prefixLua)['source-derived-helpers.lua'];
    const setup = `ChoiceWindow=(function()
      local require=function(name)
        assert(name=='ActivityDungeon1017Battle_SkillChoiceWindowByName','unavailable Lua module: '..name)
        return true
      end
      ${source.choice}
    end)()
    ${source.choiceHelpers}`;
    await lua.doString([source.spawn, helpers, source.prefixBridge, setup, source.engine, source.driver, source.controls, source.extraLua].join('\n'));
    const api = Object.fromEntries(['Start', 'Fixed', 'Clock', 'Select', 'Snapshot', 'Events', 'Speed', 'Pause', 'Resume'].map((name) => [name, lua.global.get(`choiceSession${name}`)])) as unknown as LuaApi;
    api.close = () => lua.global.close();
    return api;
  } catch (error) {
    lua.global.close();
    throw error;
  }
}

function state(api: LuaApi) {
  return scope.decodeStage1Snapshot(api.Snapshot());
}
function result(api: LuaApi, advancedFixed = 0) {
  const raw = api.Events();
  const events: RuleEvent[] = raw ? raw.split('\n').map((line) => {
    const [kind, frame, ...args] = line.split('\t') as [string, string, ...string[]];
    return { kind, frame: Number(frame), args };
  }) : [];
  return { state: state(api), events, advancedFixed };
}
function integer(value: unknown, min: number, max: number): value is number {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
}

async function handle(message: any): Promise<void> {
  const { type, requestId, runId } = message;
  if (type === 'configure') {
    if (message.protocol !== RULES_PROTOCOL) return;
    const url = new URL(message.baseUrl);
    if (url.origin !== self.location.origin) fail('runtime-origin', 'Runtime base must share the app origin');
    runtimeBase = url.href;
    return;
  }
  if (message.protocol !== RULES_PROTOCOL || !integer(requestId, 1, 2147483647) || typeof runId !== 'string') {
    return scope.postMessage({ protocol: RULES_PROTOCOL, requestId, runId, type: 'error', code: 'bad-request', message: 'Invalid Worker request' });
  }
  try {
    if (type === 'contract') {
      return scope.postMessage({ protocol: RULES_PROTOCOL, requestId, runId, type: 'contract', version: RULES_VERSION, fps: RULES_FPS, gameId: 70441022 });
    }
    if (type === 'init') {
      if (active) fail('session-active', 'Close the current run before starting another');
      if (message.stageId !== 78000001) fail('stage-unsupported', 'The first runtime slice only supports stage 1');
      if (!Array.isArray(message.tape) || message.tape.length !== 50 || message.tape.some((value: unknown) => !integer(value, 1, 10000))) fail('bad-rng-tape', 'Require fifty RNG values');
      if (!Array.isArray(message.globalRngSeeds) || message.globalRngSeeds.length !== 2 || message.globalRngSeeds.some((value: unknown) => !integer(value, 0, 2147483647))) fail('bad-global-rng', 'Require two Lua seeds');
      const api = await makeApi(runId);
      api.Start(message.tape.join(','), message.globalRngSeeds[0], message.globalRngSeeds[1]);
      active = { runId, api };
      return scope.postMessage({ protocol: RULES_PROTOCOL, requestId, runId, type: 'ready', version: RULES_VERSION, fps: RULES_FPS, gameId: 70441022, ...result(api) });
    }
    if (!active || active.runId !== runId) fail('session-not-ready', 'The requested run is not active');
    const api = active.api;
    if (type === 'close') {
      api.close();
      active = null;
      return scope.postMessage({ protocol: RULES_PROTOCOL, requestId, runId, type: 'closed' });
    }
    let advancedFixed = 0;
    if (type === 'step-fixed') {
      if (!integer(message.count, 1, 600)) fail('bad-fixed-count', 'Fixed steps must be 1 through 600');
      advancedFixed = api.Fixed(message.count);
    } else if (type === 'advance-unscaled') {
      if (!integer(message.ms, 0, 60000)) fail('bad-wall-clock', 'Unscaled advance must be 0 through 60000 ms');
      api.Clock(message.ms);
    } else if (type === 'speed') {
      if (message.index !== 1 && message.index !== 2) fail('bad-speed', 'Only 1x and 2x');
      api.Speed(message.index);
    } else if (type === 'pause') api.Pause();
    else if (type === 'resume') api.Resume();
    else if (type === 'select') {
      if (!integer(message.windowId, 1, 2147483647) || !integer(message.generation, 0, 2147483647) || !integer(message.skillId, 78000000, 78999999) || typeof message.confirm !== 'boolean') fail('bad-select', 'Invalid skill selection');
      api.Select(message.windowId, message.generation, message.skillId, message.confirm);
    } else if (type !== 'snapshot') fail('bad-action', `Unknown action: ${type}`);
    return scope.postMessage({ protocol: RULES_PROTOCOL, requestId, runId, type: 'state', ...result(api, advancedFixed) });
  } catch (error) {
    const e = error as Error & { code?: string };
    return scope.postMessage({ protocol: RULES_PROTOCOL, requestId, runId, type: 'error', code: e.code ?? 'runtime-failed', message: e.message });
  }
}

scope.onmessage = (event) => {
  serial = serial.then(() => handle(event.data)).catch((error) => {
    scope.postMessage({ protocol: RULES_PROTOCOL, requestId: event.data?.requestId, runId: event.data?.runId, type: 'error', code: 'runtime-failed', message: String(error) });
  });
};

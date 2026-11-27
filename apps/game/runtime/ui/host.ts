import { UI_PRELUDE_LUA } from './prelude';
import { decodeBattleSnapshot } from './battle-snapshot';
import { BATTLE_BASE, BATTLE_COMBAT, BATTLE_PLATFORM } from './battle';
import { UI_TIMERS_LUA } from './timers';
import { STAGES } from '../../src/content/stages';
import { readNativeModelMetadata } from './native-model-metadata';
import {
  UI_PROTOCOL,
  type UiEvent,
  type UiHostMessage,
  type UiOp,
  type UiPresentationRequest,
  type UiTreeNode,
} from './protocol';

export interface LuaEngineLike {
  doString(source: string): Promise<unknown>;
  global: {
    get(name: string): unknown;
    set(name: string, value: unknown): void;
    close(): void;
  };
}

export interface UiHostIo {
  randomSeed?(): number;
  loadBytes(path: string): Promise<Uint8Array>;
  createLuaEngine(vendor: Uint8Array, wasm: Uint8Array): Promise<LuaEngineLike>;
}

export interface OriginalUiHostOptions {
  postMessage(message: UiHostMessage): void;
  runtimeBase: string;
  // 秒级时间戳，必须由调用方传入；宿主不编造产品排期或平台时间。
  activityStartStamp: number;
  serverNowStamp: number;
  clearedStageIds?: readonly number[];
  assistedStageIds?: readonly number[];
  allUnlocked?: boolean;
  gameplay?: boolean;
  io?: UiHostIo;
}

export interface OriginalUiHost {
  readonly session: string;
  init(requestId: number): Promise<void>;
  click(requestId: number, session: string, componentId: number): Promise<void>;
  present(requestId: number, session: string, signal: UiPresentationRequest['signal']): Promise<void>;
  dispose(requestId?: number): Promise<void>;
}

export function fail(code: string, message: string): never {
  const error = new Error(`${code}: ${message}`) as Error & { code?: string };
  error.code = code;
  throw error;
}

const UI_MANIFEST_PATH = 'assets/runtime/ui/manifest.json';
const RUNTIME_MANIFEST_PATH = 'assets/runtime/manifest.json';
const FGUI_PACKAGE_PATHS = [
  'assets/fgui/ActivityDungeon1017.json',
  'assets/fgui/ActivityDungeon1017Battle.json',
  'assets/fgui/CommonResource.json',
  'assets/fgui/Loading.json',
];
const EXTRA_DATA_MODULES: Record<string, string> = {
  BaseShootStage: 'core-worker/inputs/lua/BaseShootStage.lua',
  BaseShootCard: 'core-worker/inputs/lua/BaseShootCard.lua',
};
const VENDOR_JS = 'core-worker/inputs/vendor/index.js';
const VENDOR_WASM = 'core-worker/inputs/vendor/glue.wasm';
// showId=17 由 BaseActivityStageConfig[70440017].show_id 证实；对应
// BaseActivity[70060517](type=10119, parameter="70440017") 在绑定时推导。
const ACTIVITY_SHOW_ID = 17;
const DEFENSE_GAME_ID = 70441022;
const STAGE_CHOOSER = 'Activity17MiniGameChoice2Window';
const ENDLESS_STAGE = STAGES.find((stage) => stage.endless)!.id;
const DESIGN_WIDTH = 1334;
const DESIGN_HEIGHT = 750;

const EXCLUDED_CAPABILITIES = [
  'red-dot',
  'task-system',
  'daily-reward',
  'battle',
  'item-icon',
  'account-save',
];

// OpenWindow 的稳定宿主 key；package/comName 在 init 时用真实 FGUI
// componentIndex 校验后才注入 WinResConfig。null 表示该窗口的 Lua/包不在
// 本切片内，打开它会得到显式错误。
const WINDOW_DEFS: Record<string, { packageName: string; comName: string } | null> = {
  Activity17MiniGame2MainWindow: { packageName: 'ActivityDungeon1017', comName: 'MiniGame2Window' },
  Activity17MiniGameChoice2Window: { packageName: 'ActivityDungeon1017', comName: 'MiniGameChoice2Window' },
  Activity17MiniGameChoice2_InfoSkillWindow: { packageName: 'ActivityDungeon1017', comName: 'MiniGameChoice2_InfoSkillWindow' },
  Activity17MiniTask2Window: { packageName: 'ActivityDungeon1017', comName: 'MiniTask2Window' },
  BattleLoadingWindow: {packageName:'Loading',comName:'BattleLoadingWindow'},
  MiniGameBattleUIWindow: { packageName: 'ActivityDungeon1017Battle', comName: 'BattleUIWindow' },
  MiniGameSkillChoiceWindow: { packageName: 'ActivityDungeon1017Battle', comName: 'SkillChoiceWindow' },
  MiniGameBattlePauseWindow: { packageName: 'ActivityDungeon1017Battle', comName: 'BattlePauseWindow' },
  MiniGameBattleExitWindow: { packageName: 'ActivityDungeon1017Battle', comName: 'BattleExitWindow' },
  MiniGameBattleEndWindow: { packageName: 'ActivityDungeon1017Battle', comName: 'BattleEndWindow' },
  Activity17DodgerGameMainWindow: null,
  Activity17DodgerGameWindow: null,
};

interface FguiControllerDef {
  name: string;
  pages: { id: string; name: string }[];
}

interface FguiChildDef {
  name: string;
  type: string;
  objectType?: string;
  src?: string;
  packageId?: string | null;
  refName?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  visible?: boolean;
  touchable?: boolean;
  text?: string;
  defaultItem?: string;
}

interface FguiComponentDef {
  id: string;
  name: string;
  objectType: string;
  width: number;
  height: number;
  controllers?: FguiControllerDef[];
  children?: FguiChildDef[];
  transitions?: unknown[];
}

interface FguiItemDef {
  id: string;
  name: string | null;
  type: string;
  exported: boolean;
}

interface FguiPackage {
  package: { id: string; name: string };
  componentIndex: Record<string, string>;
  components: Record<string, FguiComponentDef>;
  items: Record<string, FguiItemDef>;
}

interface UiManifest {
  platformModules: Record<string,{file:string;sha256:string}>;
  schema: string;
  entryPoint: string;
  loadOrder: string[];
  files: Record<string, { file: string; sha256: string; gzipFile?: string; rawFile?: string; payloadSha256?: string }>;
}

interface RuntimeManifest {
  schema: string;
  files: Record<string, { sha256: string }>;
  nativeModels?: {file: string; sha256: string};
}

interface FNode {
  source: unknown;
  id: number;
  parent: number | null;
  window: string;
  name: string;
  type: string;
  objectType: string;
  packageId: string;
  componentId: string;
  refName?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
  touchable: boolean;
  text?: string;
  url?: string;
  controllers: Map<string, { pages: { id: string; name: string }[]; selected: number }>;
  children: number[];
  list?: { defaultItem: string | null; numItems: number; items: number[]; scrollX: number };
  transitions?: unknown[];
  clickHandlerCount: number;
}

interface WindowRecord {
  key: string;
  generation: number;
  state: 'opening' | 'open' | 'closed';
  rootId: number | null;
  packageId: string;
  comName: string;
}

type Task =
  | { kind: 'window.open'; record: WindowRecord; token: number }
  | { kind: 'setview'; record: WindowRecord; token: number }
  | { kind: 'window.close'; record: WindowRecord }
  | { kind: 'window.message'; record: WindowRecord; msgId: number; token: number }
  | { kind: 'net.rsp'; msgName: string; payload: string; token: number; record: WindowRecord | null }
  | { kind: 'net.err'; msgName: string; code: string; token: number; record: WindowRecord | null };

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

function defaultIo(runtimeBase: string): UiHostIo {
  return {
    async loadBytes(path: string): Promise<Uint8Array> {
      const url = new URL(path.slice('assets/'.length), runtimeBase);
      if (url.origin !== new URL(runtimeBase).origin) fail('runtime-origin', 'Runtime must share the app origin');
      const response = await fetch(url, { redirect: 'error' });
      if (!response.ok) fail('runtime-missing', `${path}: HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      const view = new Uint8Array(bytes);
      if (!path.endsWith('.gz') || view[0] !== 0x1f || view[1] !== 0x8b) return view;
      const decompressed = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      return new Uint8Array(await new Response(decompressed).arrayBuffer());
    },
    async createLuaEngine(vendor: Uint8Array, wasm: Uint8Array): Promise<LuaEngineLike> {
      const scope = globalThis as {
        wasmoon?: { LuaFactory: new (url: string) => { createEngine(options: object): Promise<LuaEngineLike> } };
        importScripts?: (...urls: string[]) => void;
      };
      if (typeof scope.importScripts !== 'function') {
        fail('io-unavailable', 'classic Worker importScripts is required');
      }
      const importScripts = scope.importScripts.bind(scope);
      const vendorUrl = URL.createObjectURL(new Blob([vendor as BlobPart], { type: 'text/javascript' }));
      try {
        importScripts(vendorUrl);
      } finally {
        URL.revokeObjectURL(vendorUrl);
      }
      if (!scope.wasmoon) fail('io-unavailable', 'wasmoon vendor did not initialise');
      const wasmUrl = URL.createObjectURL(new Blob([wasm as BlobPart], { type: 'application/wasm' }));
      try {
        const factory = new scope.wasmoon.LuaFactory(wasmUrl);
        return await factory.createEngine({
          openStandardLibs: true,
          injectObjects: false,
          enableProxy: false,
          functionTimeout: 30000,
        });
      } finally {
        URL.revokeObjectURL(wasmUrl);
      }
    },
  };
}

function allowStagePractice(source: string): string {
  // The original chooser uses one score for playability, completion and the roster.
  // Keep the natural completion marks and expose the original final-stage roster.
  const hooks = [
    ['local function StageIsUnlock(stageId)', 'local function StageIsUnlock(stageId)\n  do return true, true end'],
    ['local function StageIsPass(stageId)', "local function StageIsPass(stageId)\n  do return __HostCall('progress.cleared', stageId) end"],
    ['local function GetCurUnlockStage()', `local function GetCurUnlockStage()\n  do return TableData.GetConfig(${ENDLESS_STAGE}, 'BaseShootStage') end`],
    ['FloatTipsUtil.ShowWarnTips(T(11927))', 'ld("MiniGameBattle")\n          MiniGameBattleMgr.InitBattle({stageId = stageId})'],
  ] as const;
  for (const [original, local] of hooks) {
    if (source.split(original).length !== 2) fail('ui-progress-adapter', `Original chooser hook changed: ${original}`);
    source = source.replace(original, local);
  }
  return source;
}

export function createOriginalUiHost(options: OriginalUiHostOptions): OriginalUiHost {
  const io = options.io ?? defaultIo(options.runtimeBase);
  const session = crypto.randomUUID();
  const startedWallClock = Date.now();
  const cleared = new Set<number>();
  const assisted = new Set<number>();
  function addProgress(stageIds: readonly number[] | undefined, marks = cleared): boolean {
    if (!Array.isArray(stageIds)) return false;
    const count = marks.size;
    for (const stage of STAGES) {
      if (!stage.endless && stageIds.includes(stage.id)) marks.add(stage.id);
    }
    return marks.size !== count;
  }
  function completed(stageId: number): boolean {
    return cleared.has(stageId) || assisted.has(stageId);
  }
  function highestCompletedStage(): number {
    let latest = 0;
    for (const stage of STAGES) {
      if (stage.endless || stage.pre !== latest || !completed(stage.id)) break;
      latest = stage.id;
    }
    return latest;
  }
  addProgress(options.clearedStageIds);
  addProgress(options.assistedStageIds, assisted);

  let lua: LuaEngineLike | null = null;
  let dispatch: ((kind: string, a?: unknown, b?: unknown, c?: unknown) => Promise<unknown>) | null = null;
  let disposed = false;
  let nextNodeId = 1;
  let nextGeneration = 1;
  let currentWindow: WindowRecord | null = null;

  const nodes = new Map<number, FNode>();
  const windows = new Map<string, WindowRecord>();
  const packagesById = new Map<string, FguiPackage>();
  const packagesByName = new Map<string, FguiPackage>();
  const sources = new Map<string, string>();
  const tasks: Task[] = [];
  const shown = new Set<number>();
  const animations = new Map<number, { nodeId: number; name: string; labels: Set<string> }>();
  const opsBuffer: UiOp[] = [];
  const resolvedWindows = new Map<string, { packageId: string; packageName: string; comName: string }>();
  let entryPoint = '';
  let modelMetadata = '{}';
  let effectLifetimes = '{}';
  let tickBattle: ((ms: number) => string) | undefined;
  const preferences = new Map<string, number>();
  let nextSound = 0;
  let activeStage: number | null = null;
  let battleFinished = false;
  let battleUsedDebug = false;
  let advanceChooserAfterBattle = false;


  function post(message: UiHostMessage): void {
    options.postMessage(message);
  }
  function postEvent(event: UiEvent): void {
    post({ protocol: UI_PROTOCOL, session, type: 'event', event });
  }
  function pushOp(op: UiOp): void {
    if (op.op === 'set') {
      let owner = nodes.get(op.id);
      while (owner && owner.parent !== null) owner = nodes.get(owner.parent);
      if (owner && windows.get(owner.window)?.rootId !== owner.id) return;
    }
    opsBuffer.push(op);
  }
  function flushOps(): void {
    if (opsBuffer.length === 0) return;
    const ops = opsBuffer.splice(0, opsBuffer.length);
    post({ protocol: UI_PROTOCOL, session, type: 'ops', ops });
  }

  function node(id: number): FNode {
    const found = nodes.get(id);
    if (!found) fail('unknown-component', `no live component with id ${id}`);
    return found;
  }

  async function loadJson(path: string): Promise<unknown> {
    const bytes = await io.loadBytes(path);
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  }

  let batch: { start: number; end: number; total: number; complete: number; label: string } | undefined;
  function reportStartup(percent: number, phase: string): void {
    if (options.gameplay) post({protocol:UI_PROTOCOL,session,type:'startup',percent,phase});
  }
  function beginBatch(start:number, end:number, total:number, label:string): void {
    batch = { start,end,total,complete:0,label };
    reportStartup(start,label);
  }
  async function loadVerified(path: string, expected: string | undefined): Promise<Uint8Array> {
    const bytes = await io.loadBytes(path);
    if (!expected) fail('runtime-unlisted', path);
    const actual = await sha256Hex(bytes);
    if (actual !== expected) fail('runtime-hash', path);
    if (batch && batch.complete < batch.total) {
      batch.complete++;
      reportStartup(batch.start + (batch.end-batch.start)*batch.complete/batch.total,
        batch.label + '（' + batch.complete + '/' + batch.total + '）');
    }
    return bytes;
  }

  function buildComponent(packageId: string, componentId: string, windowKey: string, childDef: FguiChildDef | null, parent: number | null): FNode {
    const pkg = packagesById.get(packageId);
    if (!pkg) fail('fgui-missing', `package not loaded: ${packageId}`);
    const def = pkg.components[componentId];
    if (!def) fail('fgui-missing', `component not found: ${packageId}/${componentId}`);
    const record: FNode = {
      source: childDef ?? def,
      id: nextNodeId++,
      parent,
      window: windowKey,
      name: childDef?.name ?? def.name,
      type: childDef?.type ?? 'Component',
      objectType: def.objectType,
      packageId,
      componentId,
      x: childDef?.x ?? 0,
      y: childDef?.y ?? 0,
      width: childDef?.width ?? def.width,
      height: childDef?.height ?? def.height,
      visible: childDef?.visible ?? true,
      touchable: childDef?.touchable ?? true,
      controllers: new Map(
        (def.controllers ?? []).map((controller) => [
          controller.name,
          { pages: controller.pages.map((page) => ({ id: page.id, name: page.name })), selected: 0 },
        ]),
      ),
      children: [],
      clickHandlerCount: 0,
    };
    if (childDef?.refName) record.refName = childDef.refName;
    if (childDef?.text !== undefined) record.text = childDef.text;
    if (def.transitions) record.transitions = def.transitions;
    nodes.set(record.id, record);
    for (const child of def.children ?? []) {
      const childNode = buildChild(packageId, child, windowKey, record.id);
      record.children.push(childNode.id);
    }
    return record;
  }

  function buildChild(packageId: string, child: FguiChildDef, windowKey: string, parent: number): FNode {
    if ((child.type === 'Component' || child.type === 'Button') && child.src) {
      const childPackageId = child.packageId ?? packageId;
      return buildComponent(childPackageId, child.src, windowKey, child, parent);
    }
    const leaf: FNode = {
      source: child,
      id: nextNodeId++,
      parent,
      window: windowKey,
      name: child.name,
      type: child.type,
      objectType: child.objectType ?? child.type,
      packageId: child.packageId ?? packageId,
      componentId: child.src ?? '',
      x: child.x ?? 0,
      y: child.y ?? 0,
      width: child.width ?? 0,
      height: child.height ?? 0,
      visible: child.visible ?? true,
      touchable: child.touchable ?? true,
      controllers: new Map(),
      children: [],
      clickHandlerCount: 0,
    };
    if (child.refName) leaf.refName = child.refName;
    if (child.text !== undefined) leaf.text = child.text;
    if (child.type === 'List') {
      leaf.list = { defaultItem: child.defaultItem ?? null, numItems: 0, items: [], scrollX: 0 };
    }
    nodes.set(leaf.id, leaf);
    return leaf;
  }

  function serializeNode(record: FNode): UiTreeNode {
    const out: UiTreeNode = {
      source: record.source,
      id: record.id,
      name: record.name,
      type: record.type,
      objectType: record.objectType,
      packageId: record.packageId,
      componentId: record.componentId,
      x: record.x,
      y: record.y,
      width: record.width,
      height: record.height,
      visible: record.visible,
      touchable: record.touchable,
      controllers: Object.fromEntries(
        [...record.controllers.entries()].map(([name, state]) => [
          name,
          { pages: state.pages.map((page) => ({ ...page })), selected: state.selected },
        ]),
      ),
      children: record.children.map((childId) => serializeNode(node(childId))),
      clickHandlerCount: record.clickHandlerCount,
    };
    if (record.refName !== undefined) out.refName = record.refName;
    if (record.text !== undefined) out.text = record.text;
    if (record.url !== undefined) out.url = record.url;
    if (record.transitions !== undefined) out.transitions = record.transitions;
    if (record.list) {
      out.list = { numItems: record.list.numItems, defaultItem: record.list.defaultItem, scrollX: record.list.scrollX };
    }
    return out;
  }

  function parseItemUrl(url: string): { packageId: string; itemId: string } {
    if (!url.startsWith('ui://')) fail('fgui-url', `unsupported url: ${url}`);
    const rest = url.slice('ui://'.length);
    for (const packageId of packagesById.keys()) {
      if (rest.startsWith(packageId)) return { packageId, itemId: rest.slice(packageId.length) };
    }
    fail('fgui-url', `url references an unloaded package: ${url}`);
  }

  function createListItem(list: FNode): FNode {
    if (!list.list) fail('not-a-list', `${list.name} is not a list`);
    if (!list.list.defaultItem) fail('list-no-default-item', `${list.name} has no defaultItem`);
    const { packageId, itemId } = parseItemUrl(list.list.defaultItem);
    const item = buildComponent(packageId, itemId, list.window, null, list.id);
    list.children.push(item.id);
    list.list.items.push(item.id);
    return item;
  }

  function trimListItems(list: FNode, count: number): string {
    if (!list.list) fail('not-a-list', `${list.name} is not a list`);
    const removed = new Set(list.list.items.splice(count));
    if (!removed.size) return '';
    list.children = list.children.filter((id) => !removed.has(id));
    list.list.numItems = list.list.items.length;
    pushOp(count ? { op: 'list-trim', id: list.id, count } : { op: 'list-clear', id: list.id });
    return removeNodeTrees(removed);
  }

  function removeNodeTrees(ids: Iterable<number>): string {
    const removed = new Set<number>();
    function remove(id: number): void {
      const record = nodes.get(id);
      if (!record) return;
      for (const childId of record.children) remove(childId);
      shown.delete(id);
      nodes.delete(id);
      removed.add(id);
    }
    for (const id of ids) remove(id);
    for (const [key, animation] of animations) {
      if (removed.has(animation.nodeId)) animations.delete(key);
    }
    return [...removed].join(',');
  }

  async function releaseWindowTree(record: WindowRecord): Promise<void> {
    if (record.rootId === null) return;
    const removed = removeNodeTrees([record.rootId]);
    record.rootId = null;
    if (removed) await dispatch?.('nodes.release', removed);
  }

  function closeWindowRecord(record: WindowRecord): void {
    if (record.state === 'closed') return;
    record.state = 'closed';
    record.generation = nextGeneration++;
    tasks.push({ kind: 'window.close', record });
  }

  async function failWindow(record: WindowRecord, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    post({ protocol: UI_PROTOCOL, session, type: 'error', code: 'task-failed', message });
    if (record.state !== 'closed') {
      record.state = 'closed';
      record.generation = nextGeneration++;
      await releaseWindowTree(record);
      flushOps();
      post({ protocol: UI_PROTOCOL, session, type: 'close', window: record.key });
    }
  }

  function taskLive(task: Task): boolean {
    if (task.kind === 'net.rsp' || task.kind === 'net.err') {
      return task.record === null || task.record.state !== 'closed';
    }
    if (task.kind === 'window.close') return task.record.state === 'closed';
    if (task.kind === 'window.message') return task.record.state === 'open';
    return task.record.state === 'opening';
  }

  async function runTask(task: Task): Promise<void> {
    if (!dispatch) fail('host-not-ready', 'Lua engine is not initialised');
    if (task.kind === 'window.open') {
      currentWindow = task.record;
      try {
        await dispatch('window.open', task.record.key, task.token);
      } finally {
        currentWindow = null;
      }
      return;
    }
    if (task.kind === 'setview') {
      const record = task.record;
      if (record.rootId !== null) return;
      const resolved = resolvedWindows.get(record.key);
      if (!resolved) fail('unknown-window', record.key);
      const componentId = packagesById.get(resolved.packageId)?.componentIndex[resolved.comName];
      if (!componentId) fail('fgui-missing', `${resolved.packageName}/${resolved.comName}`);
      const root = buildComponent(resolved.packageId, componentId, record.key, null, null);
      record.rootId = root.id;
      record.state = 'open';
      post({ protocol: UI_PROTOCOL, session, type: 'open', window: record.key, rootId: root.id, tree: serializeNode(root) });
      currentWindow = record;
      try {
        await dispatch('setview', task.token, root.id);
      } finally {
        currentWindow = null;
      }
      return;
    }
    if (task.kind === 'window.close') {
      currentWindow = task.record;
      try {
        await dispatch('window.close', task.record.key);
      } finally {
        currentWindow = null;
        await releaseWindowTree(task.record);
        flushOps();
        post({ protocol: UI_PROTOCOL, session, type: 'close', window: task.record.key });
        if (task.record.key === 'MiniGameBattleEndWindow') {
          activeStage = null;
          if (advanceChooserAfterBattle && windows.get(STAGE_CHOOSER)?.state === 'open') {
            await lua!.doString(`require(${JSON.stringify(STAGE_CHOOSER)}).UpdateInfo()`);
          }
          postEvent({ name: 'battle-close' });
        } else if (options.gameplay && task.record.key === entryPoint &&
                   ![...windows.values()].some((window) => window.state !== 'closed')) {
          // In the standalone page there is no enclosing activity UI to uncover.
          await lua!.doString(`OpenWindow(WinResConfig[${JSON.stringify(entryPoint)}].name)`);
        }
      }
      return;
    }
    if (task.kind === 'window.message') {
      currentWindow = task.record;
      try {
        await dispatch('window.message', task.record.key, task.msgId, task.token);
      } finally {
        currentWindow = null;
      }
      return;
    }
    if (task.kind === 'net.rsp') {
      currentWindow = task.record;
      try {
        await dispatch('net.rsp', task.msgName, task.payload, task.token);
      } finally {
        currentWindow = null;
      }
      return;
    }
    currentWindow = task.record;
    try {
      await dispatch('net.err', task.msgName, task.code, task.token);
    } finally {
      currentWindow = null;
    }
  }

  async function drain(): Promise<void> {
    while (tasks.length > 0) {
      const task = tasks.shift()!;
      if (!taskLive(task)) {
        postEvent({ name: 'stale-dropped', what: task.kind });
        continue;
      }
      try {
        await runTask(task);
      } catch (error) {
        if (task.kind === 'net.rsp' || task.kind === 'net.err') {
          const message = error instanceof Error ? error.message : String(error);
          post({ protocol: UI_PROTOCOL, session, type: 'error', code: 'task-failed', message });
        } else {
          await failWindow(task.record, error);
        }
      }
    }
    flushOps();
  }

  function requireNumber(value: unknown, what: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail('bad-argument', `${what} must be a finite number`);
    return value;
  }

  function hostCall(op: string, a?: unknown, b?: unknown, c?: unknown, d?: unknown): unknown {
    if (disposed) fail('disposed', 'host is disposed');
    switch (op) {
      case 'native.models': return modelMetadata;
      case 'native.effectLifetimes': return effectLifetimes;
      case 'battle.result': {
        const stageId = requireNumber(a, 'stageId');
        if (stageId !== activeStage || battleFinished) return 0;
        battleFinished = true;
        const result = JSON.parse(String(b)) as Omit<Extract<UiEvent, { name: 'settlement' }>, 'name' | 'stageId' | 'endless'>;
        if (stageId === ENDLESS_STAGE) {
          postEvent({ name: 'settlement', stageId, ...result, endless: {
            source: battleUsedDebug ? 'practice' : 'natural',
            endedBy: currentWindow?.key === 'MiniGameBattleExitWindow' ? 'exit' : 'natural',
          } });
          return 0;
        }
        if (result.win === true && result.loss === false) {
          const previous = highestCompletedStage();
          const marks = battleUsedDebug ? assisted : cleared;
          if ((!battleUsedDebug || !cleared.has(stageId)) && addProgress([stageId], marks)) {
            advanceChooserAfterBattle = highestCompletedStage() > previous;
            postEvent(battleUsedDebug ? { name: 'clear-earned', stageId, assisted: true } : { name: 'clear-earned', stageId });
          }
        }
        postEvent({ name: 'settlement', stageId, ...result });
        return 0;
      }
      case 'progress.cleared': return completed(requireNumber(a, 'stageId'));
      case 'audio.speed': postEvent({ name: 'audio-speed', speed: Number(a) }); return 0;
      case 'audio.play': {
        const id = ++nextSound;
        postEvent({ name:'audio-play', id, kind: a === 'bgm' ? 'bgm' : 'sfx', path: String(b),
          ...(typeof c === 'number' ? { frame:c } : {}), ...(typeof d === 'number' ? { emitter:d } : {}) });
        return id;
      }
      case 'audio.stop': postEvent({ name:'audio-stop',id: a === 'bgm' ? 'bgm' : Number(a) }); return 0;

      case 'rng.seed': return io.randomSeed?.() ?? (crypto.getRandomValues(new Uint32Array(1))[0]! & 0x7fffffff);
      case 'prefs.get': return preferences.get(String(a)) ?? b;
      case 'prefs.set': preferences.set(String(a), Number(b)); return 0;
      case 'lua.source': {
        const source = sources.get(String(a));
        if (source === undefined) fail('module-not-found', `no original Lua module named ${String(a)}`);
        return source;
      }
      case 'view.setAsync': {
        const token = requireNumber(a, 'token');
        if (!currentWindow) fail('no-window', 'SetViewAsync outside a window context');
        const resolved = resolvedWindows.get(currentWindow.key);
        if (!resolved) fail('window-unavailable', currentWindow.key);
        if (b !== resolved.packageName || c !== resolved.comName) {
          fail(
            'view-mismatch',
            `${currentWindow.key} requested ${String(b)}/${String(c)} but the registry resolved ${resolved.packageName}/${resolved.comName}`,
          );
        }
        tasks.push({ kind: 'setview', record: currentWindow, token });
        return 0;
      }
      case 'window.open': {
        const name = String(a);
        const token = requireNumber(b, 'token');
        if (options.gameplay && name === 'Activity17MiniTask2Window') {
          postEvent({ name:'unsupported', capability:'task-system', detail:name });
          return false;
        }
        const resolved = resolvedWindows.get(name);
        if (!resolved) fail('window-unavailable', `window is not available in this host: ${name}`);
        const existing = windows.get(name);
        if (existing && existing.state !== 'closed') closeWindowRecord(existing);
        const record: WindowRecord = {
          key: name,
          generation: nextGeneration++,
          state: 'opening',
          rootId: null,
          packageId: resolved.packageId,
          comName: resolved.comName,
        };
        windows.set(name, record);
        tasks.push({ kind: 'window.open', record, token });
        return 0;
      }
      case 'window.close': {
        const record = windows.get(String(a));
        if (options.gameplay && record?.key === 'MiniGameBattleUIWindow') {
          for (const key of ['MiniGameBattlePauseWindow','MiniGameBattleExitWindow','MiniGameSkillChoiceWindow']) {
            const child = windows.get(key);
            if (child && child.state !== 'closed') closeWindowRecord(child);
          }
        }
        if (record && record.state !== 'closed') closeWindowRecord(record);
        return 0;
      }
      case 'window.message': {
        const record = windows.get(String(a));
        if (record && record.state === 'open') {
          tasks.push({ kind: 'window.message', record, msgId: requireNumber(b, 'msgId'), token:Number(c) || 0 });
          return true;
        }
        return 0;
      }
      case 'window.current': return currentWindow?.rootId ?? 0;
      case 'window.enter': {
        const prev = currentWindow?.rootId ?? 0;
        if (a === 0) currentWindow = null;
        else {
          const owner = nodes.get(Number(a));
          const record = owner && windows.get(owner.window);
          if (!record || record.state !== 'open') return undefined;
          currentWindow = record;
        }
        return prev;
      }
      case 'window.isOpen': return windows.get(String(a))?.state === 'open';
      case 'obj.parent': return nodes.get(Number(a))?.parent ?? 0;
      case 'hud.root': return windows.get('MiniGameBattleUIWindow')?.rootId ?? 0;
      case 'obj.fromUrl': {
        const {packageId,itemId} = parseItemUrl(String(a));
        return buildComponent(packageId,itemId,'MiniGameBattleUIWindow',null,null).id;
      }
      case 'transition.active':
        return [...animations.values()].some(item=>item.nodeId===a && item.name===b);
      case 'transition.exists': {
        return (node(Number(a)).transitions ?? []).some((t) => (t as {name:string}).name === b);
      }
      case 'transition.scaled': {
        const op = opsBuffer.find(o=>o.op==='transition-play' && o.playId===Number(a));
        if(op?.op==='transition-play') op.scaled=b===true;
        return 0;
      }
      case 'obj.create': {
        if (!currentWindow) fail('no-window', 'CreateObject outside a mounted window');
        const pkg = packagesByName.get(String(a));
        const id = pkg?.componentIndex[String(b)];
        if (!pkg || !id) fail('fgui-missing', String(b));
        return buildComponent(pkg.package.id, id, currentWindow.key, null, null).id;
      }
      case 'obj.add': {
        const parent = node(Number(a));
        const child = node(Number(b));
        if (child.parent !== null || windows.get(child.window)?.rootId === child.id) fail('invalid-child', child.name);
        if (child.window !== parent.window) {
          const adopt = (n: FNode): void => {
            n.window = parent.window;
            for (const id of n.children) adopt(node(id));
          };
          adopt(child);
        }
        child.parent = parent.id;
        parent.children.push(child.id);
        pushOp({ op: 'child-add', id: parent.id, item: serializeNode(child) });
        return 0;
      }
      case 'obj.remove': {
        const parent = node(Number(a));
        const child = node(Number(b));
        if (child.parent !== parent.id) fail('invalid-child', child.name);
        parent.children = parent.children.filter((id) => id !== child.id);
        if (parent.list) {
          parent.list.items = parent.list.items.filter((id) => id !== child.id);
          parent.list.numItems = parent.list.items.length;
        }
        pushOp({ op: 'child-remove', id: child.id });
        return removeNodeTrees([child.id]);
      }
      case 'transition.play': {
        const target = node(Number(a));
        const name = String(b);
        const playId = requireNumber(c, 'playId');
        animations.set(playId, { nodeId: target.id, name, labels: new Set() });
        pushOp({ op: 'transition-play', id: target.id, name, playId, labels: [] });
        return 0;
      }
      case 'transition.hook': {
        const playId = Number(a);
        const entry = animations.get(playId);
        if (!entry) return 0;
        entry.labels.add(String(b));
        const op = opsBuffer.find((item) => item.op === 'transition-play' && item.playId === playId);
        if (op?.op === 'transition-play') op.labels = [...entry.labels];
        return 0;
      }
      case 'obj.textChild': {
        const target = node(Number(a));
        const children = target.children.map((id) => node(id));
        return (children.find((c) => c.name === 'WordTxt') ?? children.find((c) => c.name === 'NameTxt'))?.id ?? 0;
      }
      case 'obj.getChild': {
        const parent = node(requireNumber(a, 'componentId'));
        const name = String(b);
        const childId = parent.children.find((childId) => nodes.get(childId)?.name === name);
        return childId ?? 0;
      }
      case 'obj.getController': {
        const target = node(requireNumber(a, 'componentId'));
        const name = String(b);
        // FairyGUI GetController returns null for a missing controller; the
        // original ChangeUIController helper relies on that (SpecialBtn has no c2).
        return target.controllers.has(name) ? 1 : 0;
      }
      case 'obj.get': {
        const target = node(requireNumber(a, 'componentId'));
        const key = String(b);
        if (key === 'numItems') {
          if (!target.list) fail('not-a-list', `${target.name} is not a list`);
          return target.list.numItems;
        }
        if (key === 'value') return (target as FNode & { value?: number }).value ?? 0;
        if (key === 'text' || key === 'url') return target[key] ?? '';
        if (key === 'visible' || key === 'touchable') return target[key];
        if (['x', 'y', 'width', 'height'].includes(key)) {
          return (target as unknown as Record<string, number>)[key];
        }
        fail('unsupported-property', `cannot read ${key} on ${target.name}`);
        break;
      }
      case 'obj.set': {
        const target = node(requireNumber(a, 'componentId'));
        const key = String(b);
        const value = c;
        if (key === 'text' || key === 'url') {
          const text = String(value);
          target[key] = text;
          pushOp({ op: 'set', id: target.id, key, value: text });
          return 0;
        }
        if (key === 'visible' || key === 'touchable') {
          const flag = value === true;
          target[key] = flag;
          pushOp({ op: 'set', id: target.id, key, value: flag });
          return 0;
        }
        if (['x', 'y', 'width', 'height', 'value', 'alpha', 'rotation', 'scaleX', 'scaleY'].includes(key)) {
          const number = requireNumber(value, key);
          (target as unknown as Record<string, number>)[key] = number;
          pushOp({ op: 'set', id: target.id, key, value: number });
          return 0;
        }
        fail('unsupported-property', `cannot write ${key} on ${target.name}`);
        break;
      }
      case 'obj.center': {
        const target = node(requireNumber(a, 'componentId'));
        const parent = target.parent === null ? null : nodes.get(target.parent);
        const parentWidth = parent ? parent.width : DESIGN_WIDTH;
        const parentHeight = parent ? parent.height : DESIGN_HEIGHT;
        target.x = Math.round((parentWidth - target.width) / 2);
        target.y = Math.round((parentHeight - target.height) / 2);
        pushOp({ op: 'center', id: target.id, x: target.x, y: target.y });
        return 0;
      }
      case 'controller.set': {
        const target = node(requireNumber(a, 'componentId'));
        const name = String(b);
        const controller = target.controllers.get(name);
        if (!controller) fail('unknown-controller', `${target.name} has no controller ${name}`);
        const index = requireNumber(c, 'selectedIndex');
        if (!Number.isInteger(index) || index < 0 || index >= controller.pages.length) {
          fail('controller-page', `${name} on ${target.name} has ${controller.pages.length} pages, got ${index}`);
        }
        controller.selected = index;
        pushOp({ op: 'controller', id: target.id, name, index });
        return 0;
      }
      case 'controller.get': {
        const target = node(requireNumber(a, 'componentId'));
        const controller = target.controllers.get(String(b));
        if (!controller) fail('unknown-controller', `${target.name} has no controller ${String(b)}`);
        return controller.selected;
      }
      case 'list.setNumItems': {
        const list = node(requireNumber(a, 'componentId'));
        const count = requireNumber(b, 'numItems');
        if (!list.list) fail('not-a-list', `${list.name} is not a list`);
        if (!Number.isInteger(count) || count < 0) fail('bad-argument', `numItems must be a non-negative integer, got ${count}`);
        const previous = list.list.items.length;
        if (count === previous) return '';
        if (count < previous) return trimListItems(list, count);
        const items: UiTreeNode[] = [];
        for (let index = previous; index < count; index += 1) {
          items.push(serializeNode(createListItem(list)));
        }
        list.list.numItems = count;
        if (previous === 0) pushOp({ op: 'list-items', id: list.id, items });
        else for (const item of items) pushOp({ op: 'list-add', id: list.id, item });
        return '';
      }
      case 'list.itemAt': {
        const list = node(requireNumber(a, 'componentId'));
        if (!list.list) fail('not-a-list', `${list.name} is not a list`);
        const index = requireNumber(b, 'index');
        const itemId = list.list.items[index];
        if (itemId === undefined) fail('bad-argument', `${list.name} has ${list.list.items.length} items, index ${index}`);
        return itemId;
      }
      case 'list.addFromPool': {
        const list = node(requireNumber(a, 'componentId'));
        if (!list.list) fail('not-a-list', `${list.name} is not a list`);
        const item = createListItem(list);
        list.list.numItems = list.list.items.length;
        pushOp({ op: 'list-add', id: list.id, item: serializeNode(item) });
        return item.id;
      }
      case 'list.clearItems': {
        const list = node(requireNumber(a, 'componentId'));
        return trimListItems(list, 0);
      }
      case 'list.setPosX': {
        const list = node(requireNumber(a, 'componentId'));
        if (!list.list) fail('not-a-list', `${list.name} is not a list`);
        list.list.scrollX = requireNumber(b, 'x');
        pushOp({ op: 'scroll', id: list.id, x: list.list.scrollX });
        return 0;
      }
      case 'click.add':
      case 'click.set': {
        const target = node(requireNumber(a, 'componentId'));
        target.clickHandlerCount = requireNumber(b, 'count');
        pushOp({ op: 'click-handlers', id: target.id, count: target.clickHandlerCount });
        return 0;
      }
      case 'net.send': {
        const msgName = String(a);
        const payload = JSON.parse(String(b)) as Record<string, unknown>;
        const token = requireNumber(c, 'token');
        const record = currentWindow;
        if (options.gameplay && activeStage !== null && msgName === 'ActivityPlayMiniGameReq') {
          tasks.push({ kind: 'net.rsp', msgName: 'ActivityPlayMiniGameRsp', payload: '{}', token, record: null });
          return 0;
        }
        if (msgName === 'ActivityGetMiniGameReq') {
          const activityId = requireNumber(payload['activityId'], 'activityId');
          const gameId = requireNumber(payload['gameId'], 'gameId');
          const miniHighScore = gameId === DEFENSE_GAME_ID ? highestCompletedStage() : 0;
          tasks.push({
            kind: 'net.rsp',
            msgName: 'ActivityGetMiniGameRsp',
            payload: JSON.stringify({ gameId, activityId, miniHighScore, miniDailyStat: 0 }),
            token,
            record,
          });
          return 0;
        }
        if (msgName === 'ActivityPlayMiniGameReq') {
          postEvent({ name: 'unsupported', capability: 'battle-submit', detail: 'battle settlement is outside the UI host' });
          tasks.push({ kind: 'net.err', msgName: 'ActivityPlayMiniGameRsp', code: 'RC_LOCAL_UNSUPPORTED', token, record });
          return 0;
        }
        if (msgName === 'ActivityRewardMiniGameReq') {
          postEvent({ name: 'unsupported', capability: 'daily-reward', detail: 'daily reward requires the excluded task system' });
          tasks.push({ kind: 'net.err', msgName: 'ActivityRewardMiniGameRsp', code: 'RC_LOCAL_UNSUPPORTED', token, record });
          return 0;
        }
        fail('net-unsupported', `no local adapter for ${msgName}`);
        break;
      }
      case 'res.itemUrl': {
        const pkg = packagesByName.get(String(a));
        if (!pkg) fail('unknown-package', `package not loaded: ${String(a)}`);
        const itemName = String(b);
        const item = Object.values(pkg.items).find((entry) => entry.name === itemName && entry.exported);
        if (!item) fail('unknown-resource', `${String(a)}:${itemName}`);
        return `ui://${pkg.package.id}${item.id}`;
      }
      case 'ui.showItemFrame': {
        const itemId = requireNumber(a, 'itemId');
        const root = node(requireNumber(b, 'componentId'));
        const count = requireNumber(c, 'count');
        const numberTxt = root.children.map((childId) => node(childId)).find((child) => child.name === 'NumberTxt');
        if (!numberTxt) fail('child-not-found', `${root.name} has no child named NumberTxt`);
        numberTxt.text = String(count);
        pushOp({ op: 'set', id: numberTxt.id, key: 'text', value: numberTxt.text });
        if (!root.children.map((childId) => node(childId)).some((child) => child.name === 'ItemLoader')) {
          fail('child-not-found', `${root.name} has no child named ItemLoader`);
        }
        postEvent({ name: 'unsupported', capability: 'item-icon', detail: `item ${itemId} icon needs the BaseItem table` });
        return 0;
      }
      case 'ui.itemClick': {
        postEvent({ name: 'item-tips', itemId: requireNumber(a, 'itemId') });
        return 0;
      }
      case 'ui.warn': {
        postEvent({ name: 'warn-tips', text: String(a) });
        return 0;
      }
      case 'ui.itemTips': {
        postEvent({ name: 'item-rewards' });
        return 0;
      }
      case 'reddot.add': {
        node(requireNumber(a, 'componentId'));
        postEvent({ name: 'unsupported', capability: 'red-dot', detail: `red dot on ${String(b)} needs the excluded task system` });
        return 0;
      }
      case 'reddot.update':
        return 0;
      case 'battle.init': {
        const stageId = requireNumber(a, 'stageId');
        if (!Number.isInteger(stageId) || stageId <= 0) fail('bad-argument', `stageId must be a positive integer, got ${stageId}`);
        activeStage = stageId;
        battleFinished = false;
        battleUsedDebug = false;
        advanceChooserAfterBattle = false;
        postEvent({ name: 'start-battle', stageId });
        return 0;
      }
      case 'battle.close': {
        postEvent({ name: 'battle-close' });
        return 0;
      }
      case 'module-group': {
        postEvent({ name: 'module-group', group: String(a) });
        return 0;
      }
      case 'time.now':
        return Math.floor(options.serverNowStamp + (Date.now() - startedWallClock) / 1000);
      case 'log': {
        postEvent({ name: 'log', text: String(a) });
        return 0;
      }
      default:
        fail('unknown-host-op', op);
    }
  }

  function buildWinResConfigLua(): string {
    const entries = Object.entries(WINDOW_DEFS).map(([key, def]) => {
      if (def === null) return `[${JSON.stringify(key)}] = { name = ${JSON.stringify(key)} }`;
      const pkg = packagesByName.get(def.packageName);
      if (!pkg) fail('fgui-missing', `package not loaded: ${def.packageName}`);
      if (!pkg.componentIndex[def.comName]) {
        fail('fgui-missing', `${def.packageName} has no component ${def.comName}`);
      }
      resolvedWindows.set(key, { packageId: pkg.package.id, packageName: def.packageName, comName: def.comName });
      return `[${JSON.stringify(key)}] = { name = ${JSON.stringify(key)}, package = ${JSON.stringify(def.packageName)}, comName = ${JSON.stringify(def.comName)} }`;
    });
    return `WinResConfig = {\n${entries.join(',\n')}\n}`;
  }

  async function load(): Promise<void> {
    if (!Number.isFinite(options.activityStartStamp) || options.activityStartStamp <= 0) {
      fail('bad-time', 'activityStartStamp (seconds) must be provided by the caller');
    }
    if (!Number.isFinite(options.serverNowStamp) || options.serverNowStamp <= 0) {
      fail('bad-time', 'serverNowStamp (seconds) must be provided by the caller (platform time)');
    }
    const uiManifest = (await loadJson(UI_MANIFEST_PATH)) as UiManifest;
    if (uiManifest.schema !== 'starfall.monster-defense.ui-input/1') fail('ui-manifest', 'unexpected ui manifest schema');
    const runtimeManifest = (await loadJson(RUNTIME_MANIFEST_PATH)) as RuntimeManifest;
    if (runtimeManifest.schema !== 'starfall.monster-defense.runtime-input/1') {
      fail('runtime-manifest', 'unexpected runtime manifest schema');
    }
    entryPoint = uiManifest.entryPoint;
    if (!WINDOW_DEFS[entryPoint]) fail('ui-manifest', `entry point ${entryPoint} is not a registered window`);

    reportStartup(6,'正在读取原版界面');
    for (const packagePath of FGUI_PACKAGE_PATHS) {
      const pkg = (await loadJson(packagePath)) as FguiPackage;
      packagesById.set(pkg.package.id, pkg);
      packagesByName.set(pkg.package.name, pkg);
    }

    beginBatch(12,40,Object.keys(uiManifest.files).length + Object.keys(EXTRA_DATA_MODULES).length + 2,'正在校验游戏资源');
    const decoder = new TextDecoder('utf-8', { fatal: true });
    await Promise.all(
      Object.entries(uiManifest.files).map(async ([name, entry]) => {
        const rawPath = entry.rawFile ?? entry.file;
        const file = typeof DecompressionStream === 'function' ? entry.gzipFile ?? rawPath : rawPath;
        const bytes = await loadVerified(`assets/runtime/ui/${file}`, entry.payloadSha256 ?? entry.sha256);
        const module = name.replace(/\.lua$/, '');
        const source = decoder.decode(bytes);
        sources.set(module, options.allUnlocked && module === STAGE_CHOOSER ? allowStagePractice(source) : source);
      }),
    );
    await Promise.all(
      Object.entries(EXTRA_DATA_MODULES).map(async ([name, path]) => {
        const bytes = await loadVerified(`assets/runtime/${path}`, runtimeManifest.files[path]?.sha256);
        sources.set(name, decoder.decode(bytes));
      }),
    );
    const [vendor, wasm] = await Promise.all([
      loadVerified(`assets/runtime/${VENDOR_JS}`, runtimeManifest.files[VENDOR_JS]?.sha256),
      loadVerified(`assets/runtime/${VENDOR_WASM}`, runtimeManifest.files[VENDOR_WASM]?.sha256),
    ]);

    reportStartup(41,'正在启动 Lua 引擎');
    lua = await io.createLuaEngine(vendor, wasm);
    lua.global.set('__HostCall', hostCall);
    await lua.doString(buildWinResConfigLua());
    await lua.doString(UI_PRELUDE_LUA);
    const dispatchFn = lua.global.get('__HostDispatch');
    if (typeof dispatchFn !== 'function') fail('host-prelude', '__HostDispatch missing');
    dispatch = dispatchFn as (kind: string, a?: unknown, b?: unknown, c?: unknown) => Promise<unknown>;

    for (const file of uiManifest.loadOrder) {
      const module = file.replace(/\.lua$/, '');
      if (!sources.has(module)) fail('ui-manifest', `loadOrder entry missing from files: ${file}`);
      await lua.doString(`require(${JSON.stringify(module)})`);
    }
    for (const module of Object.keys(EXTRA_DATA_MODULES)) {
      await lua.doString(`require(${JSON.stringify(module)})`);
    }

    if (options.gameplay) {
      const engine = lua;
      beginBatch(43,48,Object.keys(uiManifest.platformModules).length,'正在装配战斗界面');
      await Promise.all(Object.entries(uiManifest.platformModules).map(async ([name,item])=>{
        sources.set(name.replace(/\.lua$/, ''),decoder.decode(await loadVerified('assets/runtime/ui/'+item.file,item.sha256)));
      }));
      const effects = await loadJson('assets/effects/manifest.json') as { lifetimes?: Record<string, { seconds: number; loop: boolean }> };
      effectLifetimes = JSON.stringify(effects.lifetimes ?? {});
      if (runtimeManifest.nativeModels) {
        const { file, sha256 } = runtimeManifest.nativeModels;
        beginBatch(48,60,1,'正在读取角色与场景');
        modelMetadata = decoder.decode(await loadVerified('assets/' + file, sha256));
      } else {
        const native = await loadJson('assets/native/manifest.json') as {
          prefabs: { container: string; json: string; jsonSha256: string }[];
        };
        beginBatch(48,60,native.prefabs.length,'正在读取角色与场景');
        const definitions = await Promise.all(native.prefabs.map(async (entry) => {
          const prefab = JSON.parse(decoder.decode(await loadVerified('assets/native/' + entry.json, entry.jsonSha256)));
          return [entry.container.toLowerCase(), readNativeModelMetadata(prefab)];
        }));
        modelMetadata = JSON.stringify(Object.fromEntries(definitions));
      }
      const paths = [
        ...BATTLE_BASE.map((name) => 'core-worker/inputs/lua/' + name + '.lua'),
        ...BATTLE_COMBAT.map((name) => 'core-worker/combat-prefix/inputs/' + name + '.lua'),
        'core-worker/skill-choice/inputs/choice-original-helpers.lua',
      ];
      beginBatch(60,72,paths.length,'正在校验战斗规则');
      const scripts = await Promise.all(paths.map(async (path) => decoder.decode(
        await loadVerified('assets/runtime/' + path, runtimeManifest.files[path]?.sha256))));
      for (const [i, script] of scripts.entries()) {
        const path = paths[i]!;
        if (path.endsWith('/MathUtil.lua')) await engine.doString('MathUtil=(function()\n' + script + '\nend)()');
        else if (path.endsWith('/source-derived-helpers.lua')) await engine.doString('local previous = ProtoEnum\n' + script + '\nfor k,v in pairs(previous) do ProtoEnum[k]=v end');
        else await engine.doString(script);
      }
      await engine.doString(UI_TIMERS_LUA);
      await engine.doString(BATTLE_PLATFORM);
      await engine.doString("__UiSetTimerContext(function() return __HostCall('window.current') end, function(owner,callback,...) local prev=__HostCall('window.enter',owner); if prev~=nil then callback(...); __HostCall('window.enter',prev) end end)");
      tickBattle = engine.global.get('__WebBattleTick') as (ms: number) => string;
    }
    const bind = lua.global.get('__HostBindActivity');
    if (typeof bind !== 'function') fail('host-prelude', '__HostBindActivity missing');
    const activityId = await (bind as (showId: number, stamp: number) => Promise<unknown>)(
      ACTIVITY_SHOW_ID,
      options.activityStartStamp,
    );
    if (typeof activityId !== 'number') fail('activity-binding', 'no activity bound');
  }

  return {
    session,

    async init(requestId: number): Promise<void> {
      if (disposed) fail('disposed', 'host is disposed');
      await load();
      post({
        protocol: UI_PROTOCOL,
        session,
        type: 'ready',
        requestId,
        entryPoint,
        windows: Object.keys(WINDOW_DEFS),
        excludedCapabilities: [...EXCLUDED_CAPABILITIES],
      });
      if (!lua) fail('host-not-ready', 'Lua engine is not initialised');
      await lua.doString(`OpenWindow(WinResConfig[${JSON.stringify(entryPoint)}].name)`);
      await drain();
      post({ protocol: UI_PROTOCOL, session, type: 'settled', requestId });
    },

    async click(requestId: number, requestSession: string, componentId: number): Promise<void> {
      if (disposed) fail('disposed', 'host is disposed');
      if (requestSession !== session) fail('stale-session', 'click targets a previous host session');
      if (!Number.isInteger(componentId)) fail('bad-argument', 'componentId must be an integer');
      const target = nodes.get(componentId);
      if (!target) fail('unknown-component', `no live component with id ${componentId}`);
      const record = windows.get(target.window);
      if (!record || record.state !== 'open') {
        fail('unknown-component', `component ${componentId} belongs to a closed window`);
      }
      if (!dispatch) fail('host-not-ready', 'Lua engine is not initialised');
      if (options.gameplay && record.key === 'Activity17MiniGame2MainWindow') {
        let ancestor: FNode | undefined = target;
        while (ancestor) {
          const souvenir = {TaskBtn:'gift', TodayTask:'task', ReturnBtn:'return'} as const;
          if (Object.hasOwn(souvenir, ancestor.name)) {
            postEvent({ name: 'souvenir', kind: souvenir[ancestor.name as keyof typeof souvenir] });
            post({ protocol: UI_PROTOCOL, session, type: 'settled', requestId });
            return;
          }
          ancestor = ancestor.parent === null ? undefined : nodes.get(ancestor.parent);
        }
      }
      currentWindow = record;
      let clickError: unknown = null;
      try {
        await dispatch('click', componentId);
      } catch (error) {
        clickError = error;
      } finally {
        currentWindow = null;
      }
      await drain();
      if (clickError !== null) throw clickError;
      post({ protocol: UI_PROTOCOL, session, type: 'settled', requestId });
    },

    async present(requestId, requestSession, signal): Promise<void> {
      if (disposed || requestSession !== session) fail('stale-session', 'presentation belongs to a previous session');
      if (signal.kind === 'progress') {
        const newNatural = addProgress(signal.clearedStageIds);
        const newAssisted = addProgress(signal.assistedStageIds, assisted);
        if (newNatural || newAssisted) {
          await lua!.doString(`Activity17_MiniGameService.MiniGameInfoReq(${DEFENSE_GAME_ID})`);
          await drain();
        }
        post({ protocol: UI_PROTOCOL, session, type: 'settled', requestId });
        return;
      }
      if (signal.kind === 'debug-level') {
        const result = options.gameplay && activeStage !== null && lua && await lua.doString(`
          local d = MiniGameBattleData
          if not MiniGameBattleMgr.isBattleStart or MiniGameBattleControl.isPause or MiniGameBattleControl.isOver then
            return "请在战斗进行中使用"
          end
          if d.levelMax then return "已达到本关等级上限" end
          local before = d.curLevel
          local need = d.stageConfig.level_time[before + 1] - d.curExp - d.waitDealExpAdd
          MiniGameBattleDataMgr.AddExp(math.max(0, need))
          MiniGameBattleDataMgr.DealExpAdd()
          return d.curLevel > before and "已升一级" or "本次未提升等级"
        `);
        const levelUp = { applied: result === '已升一级', text: String(result || '请在战斗进行中使用') };
        if (levelUp.applied) battleUsedDebug = true;
        await drain();
        postEvent({name: 'warn-tips', text: levelUp.text });
        post({ protocol: UI_PROTOCOL, session, type: 'settled', requestId, levelUp });
        return;
      }
      if (signal.kind === 'tick' || signal.kind === 'background') {
        if (tickBattle && activeStage !== null && lua) {
          if (signal.kind === 'background') {
            await lua.doString("if MiniGameBattleMgr.isBattleStart and not MiniGameBattleControl.isPause and not MiniGameBattleControl.isOver then require('MiniGameBattleUIWindow').ClickPauseBtn() end");
          } else {
            if (!Number.isFinite(signal.ms) || signal.ms < 0 || signal.ms > 1000) fail('bad-clock', String(signal.ms));
            const state = decodeBattleSnapshot(tickBattle(signal.ms));
            if (state) postEvent({ name: 'world', state });
          }
          await drain();
        }
        post({ protocol: UI_PROTOCOL, session, type: 'settled', requestId });
        return;
      }
      const animation = signal.kind === 'transition' ? animations.get(signal.playId) : undefined;
      const target = nodes.get(signal.kind === 'shown' ? signal.rootId : animation?.nodeId ?? -1);
      const record = target ? windows.get(target.window) : null;
      if (record?.state === 'open' && dispatch) {
        currentWindow = record;
        try {
          if (signal.kind === 'shown' && record.rootId === signal.rootId && !shown.has(signal.rootId)) {
            shown.add(signal.rootId);
            await dispatch('window.shown', record.key);
          } else if (signal.kind === 'transition' && animation) {
            if (signal.label === undefined) animations.delete(signal.playId);
            if (signal.label === undefined || animation.labels.delete(signal.label)) {
              await dispatch('transition', signal.playId, signal.label);
            }
          }
        } finally {
          currentWindow = null;
        }
        await drain();
      }
      post({ protocol: UI_PROTOCOL, session, type: 'settled', requestId });
    },

    async dispose(requestId?: number): Promise<void> {
      if (disposed) {
        if (requestId !== undefined) fail('disposed', 'host is disposed');
        return;
      }
      disposed = true;
      tasks.length = 0;
      nodes.clear();
      windows.clear();
      if (lua) {
        lua.global.close();
        lua = null;
      }
      dispatch = null;
      if (requestId !== undefined) post({ protocol: UI_PROTOCOL, session, type: 'disposed', requestId });
    },
  };
}

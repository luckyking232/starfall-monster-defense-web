import { beforeEach, describe, expect, test } from 'vitest';
import { OriginalUiClient } from '../../src/ui/client';
import { ProgressStore } from '../../src/platform/progress';
import { MemoryStorage } from '../support/memory-storage';
import { UI_PROTOCOL, type UiHostMessage, type UiTreeNode } from '../../runtime/ui/protocol';

const SESSION = 'session-1';

function tree(): UiTreeNode {
  return {
    id: 1,
    name: 'MiniGame2Window',
    type: 'Component',
    objectType: 'Component',
    packageId: 'aonql508',
    componentId: 'q3oh4p',
    x: 0,
    y: 0,
    width: 1334,
    height: 750,
    visible: true,
    touchable: true,
    controllers: {},
    children: [],
    clickHandlerCount: 0,
  };
}

class FakeWorker {
  static instances: FakeWorker[] = [];
  posted: Record<string, unknown>[] = [];
  terminated = false;
  private readonly listeners = new Map<string, ((event: never) => void)[]>();

  constructor(
    readonly url: string | URL,
    readonly options?: WorkerOptions,
  ) {
    FakeWorker.instances.push(this);
  }

  postMessage(message: Record<string, unknown>): void {
    this.posted.push(message);
    const requestId = message['requestId'] as number;
    const type = message['type'] as string;
    if (type === 'init') {
      this.emit({
        protocol: UI_PROTOCOL,
        session: SESSION,
        type: 'ready',
        requestId,
        entryPoint: 'Activity17MiniGame2MainWindow',
        windows: ['Activity17MiniGame2MainWindow'],
        excludedCapabilities: [],
      });
      this.emit({ protocol: UI_PROTOCOL, session: SESSION, type: 'open', window: 'Activity17MiniGame2MainWindow', rootId: 1, tree: tree() });
      this.emit({ protocol: UI_PROTOCOL, session: SESSION, type: 'settled', requestId });
    } else if (type === 'click' && message['componentId'] === 42) {
      this.emit({ protocol: UI_PROTOCOL, session: SESSION, type: 'ops', ops: [{ op: 'set', id: 9, key: 'text', value: 'x' }] });
      this.emit({ protocol: UI_PROTOCOL, session: SESSION, type: 'settled', requestId });
    } else if (type === 'dispose') {
      this.emit({ protocol: UI_PROTOCOL, session: SESSION, type: 'disposed', requestId });
    }
  }

  addEventListener(type: string, listener: (event: never) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(data: UiHostMessage): void {
    for (const listener of this.listeners.get('message') ?? []) {
      (listener as (event: { data: UiHostMessage }) => void)({ data });
    }
  }
}

describe('OriginalUiClient', () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    (globalThis as { Worker?: unknown }).Worker = FakeWorker;
  });

  test('init sends the protocol handshake and resolves with the ready payload', async () => {
    const client = new OriginalUiClient('https://app.test/assets/ui-host-worker.js');
    const worker = FakeWorker.instances[0]!;
    const ready = await client.init({ activityStartStamp: 1_700_000_000, serverNowStamp: 1_764_000_000 });
    expect(worker.posted[0]).toMatchObject({
      protocol: UI_PROTOCOL,
      type: 'init',
      activityStartStamp: 1_700_000_000,
      serverNowStamp: 1_764_000_000,
    });
    expect(ready.entryPoint).toBe('Activity17MiniGame2MainWindow');
    expect(client.sessionId).toBe(SESSION);
  });

  test('each initialization reads the supplied session progress store', async () => {
    const progress = new ProgressStore(null);
    const client = new OriginalUiClient('https://app.test/assets/ui-host-worker.js', progress);
    const worker = FakeWorker.instances[0]!;
    const time = { activityStartStamp: 1_700_000_000, serverNowStamp: 1_764_000_000 };

    await client.init(time);
    expect(worker.posted[0]?.['clearedStageIds']).toEqual([]);

    progress.commitClear(78000001);
    await client.init(time);
    expect(worker.posted[1]?.['clearedStageIds']).toEqual([78000001]);
  });

  test('persists earned progress before delivering the event and keeps the original slot bound', async () => {
    const storage = new MemoryStorage();
    const progress = new ProgressStore(storage);
    const client = new OriginalUiClient('https://app.test/assets/ui-host-worker.js', progress);
    const worker = FakeWorker.instances[0]!;
    const startingSlot = progress.listSlots().activeSlotId;
    await client.init({ activityStartStamp: 1, serverNowStamp: 2 });
    const nextSlot = new ProgressStore(storage).createSlot('另一个标签使用的档');
    const reloaded = new ProgressStore(storage);
    const saved: number[][] = [];
    client.onMessage((message) => {
      if (message.type === 'event' && message.event.name === 'clear-earned') saved.push(reloaded.load(startingSlot).clearedStageIds);
    });
    worker.emit({ protocol: UI_PROTOCOL, session: 'outdated', type: 'event', event: { name: 'clear-earned', stageId: 78000002 } });
    worker.emit({ protocol: UI_PROTOCOL, session: SESSION, type: 'event', event: { name: 'clear-earned', stageId: 78000001 } });
    expect(saved).toEqual([[78000001]]);
    expect(reloaded.load(nextSlot).clearedStageIds).toEqual([]);
  });

  test('passes all-unlocked separately and emits a persistence error when a win is session-only', async () => {
    const storage = new MemoryStorage();
    const progress = new ProgressStore(storage);
    progress.unlockAll();
    const client = new OriginalUiClient('https://app.test/assets/ui-host-worker.js', progress);
    const worker = FakeWorker.instances[0]!;
    await client.init({ activityStartStamp: 1, serverNowStamp: 2 });
    expect(worker.posted[0]).toMatchObject({ allUnlocked: true, clearedStageIds: [] });
    const seen: UiHostMessage[] = [];
    client.onMessage((message) => seen.push(message));
    storage.setItem = () => { throw new Error('quota'); };
    worker.emit({ protocol: UI_PROTOCOL, session: SESSION, type: 'event', event: { name: 'clear-earned', stageId: 78000001 } });
    expect(seen).toContainEqual({ protocol: UI_PROTOCOL, session: SESSION, type: 'event', event: { name: 'progress-save-failed' } });
    expect(new ProgressStore(storage).load().clearedStageIds).toEqual([]);
  });

  test('persists the assisted source and sends it back to a newly opened worker', async () => {
    const storage = new MemoryStorage();
    const original = new OriginalUiClient('https://app.test/assets/ui-host-worker.js', new ProgressStore(storage));
    const time = { activityStartStamp: 1, serverNowStamp: 2 };
    await original.init(time);
    FakeWorker.instances[0]!.emit({ protocol: UI_PROTOCOL, session: SESSION, type: 'event',
      event: { name: 'clear-earned', stageId: 78000002, assisted: true } });
    await original.dispose();

    const reopened = new OriginalUiClient('https://app.test/assets/ui-host-worker.js', new ProgressStore(storage));
    await reopened.init(time);
    expect(FakeWorker.instances[1]!.posted[0]).toMatchObject({ clearedStageIds: [], assistedStageIds: [78000002] });
    await reopened.dispose();
  });

  test('binds an endless record to its starting slot and persists it before presenting the result', async () => {
    const storage = new MemoryStorage();
    const progress = new ProgressStore(storage);
    const client = new OriginalUiClient('https://app.test/assets/ui-host-worker.js', progress);
    const worker = FakeWorker.instances[0]!;
    const emit = (event: Extract<UiHostMessage, {type: 'event'}>['event']) =>
      worker.emit({ protocol: UI_PROTOCOL, session: SESSION, type: 'event', event });
    const startingSlot = progress.listSlots().activeSlotId;
    await client.init({ activityStartStamp: 1, serverNowStamp: 2 });
    emit({ name: 'start-battle', stageId: 78000021 });
    const nextSlot = new ProgressStore(storage).createSlot('另一档');
    const results: UiHostMessage[] = [];
    client.onMessage(message => {
      if (message.type === 'event' && message.event.name === 'endless-record') {
        results.push(message);
        expect(new ProgressStore(storage).loadEndless(startingSlot).practice?.kills).toBe(45);
      }
    });
    const event = { name: 'settlement', stageId: 78000021, frame: 800, win: false, loss: false, wave: 5, kills: 45,
      endless: { source: 'practice', endedBy: 'exit' } } as const;
    emit(event);
    emit(event);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({event: {newRecord: true}});
    expect(progress.loadEndless(nextSlot).practice).toBeNull();
    await client.dispose();
  });

  test('view messages reach listeners while stale-session messages are dropped', async () => {
    const client = new OriginalUiClient('https://app.test/assets/ui-host-worker.js');
    const worker = FakeWorker.instances[0]!;
    const seen: UiHostMessage[] = [];
    client.onMessage((message) => seen.push(message));
    await client.init({ activityStartStamp: 1_700_000_000, serverNowStamp: 1_764_000_000 });
    expect(seen.map((message) => message.type)).toEqual(['open']);

    worker.emit({ protocol: UI_PROTOCOL, session: 'old-session', type: 'ops', ops: [] });
    expect(seen).toHaveLength(1);

    await client.click(42);
    expect(worker.posted[1]).toMatchObject({ type: 'click', componentId: 42, session: SESSION });
    expect(seen.map((message) => message.type)).toEqual(['open', 'ops']);
  });

  test('request-scoped errors reject and asynchronous errors reach listeners', async () => {
    const client = new OriginalUiClient('https://app.test/assets/ui-host-worker.js');
    const worker = FakeWorker.instances[0]!;
    await client.init({ activityStartStamp: 1_700_000_000, serverNowStamp: 1_764_000_000 });
    const seen: UiHostMessage[] = [];
    client.onMessage((message) => seen.push(message));

    const clickPromise = client.click(7);
    const clickRequest = worker.posted[1]!;
    worker.emit({
      protocol: UI_PROTOCOL,
      session: SESSION,
      type: 'error',
      requestId: clickRequest['requestId'] as number,
      code: 'unknown-component',
      message: 'unknown-component: 7',
    });
    await expect(clickPromise).rejects.toThrow(/unknown-component/);

    worker.emit({ protocol: UI_PROTOCOL, session: SESSION, type: 'error', code: 'task-failed', message: 'boom' });
    expect(seen.some((message) => message.type === 'error' && message.message === 'boom')).toBe(true);
  });

  test('dispose notifies the worker, terminates it and blocks further use', async () => {
    const client = new OriginalUiClient('https://app.test/assets/ui-host-worker.js');
    const worker = FakeWorker.instances[0]!;
    await client.init({ activityStartStamp: 1_700_000_000, serverNowStamp: 1_764_000_000 });
    await client.dispose();
    expect(worker.posted[1]).toMatchObject({ type: 'dispose' });
    expect(worker.terminated).toBe(true);
    await expect(client.click(1)).rejects.toThrow(/disposed|closed/);
    await expect(client.init({ activityStartStamp: 1, serverNowStamp: 2 })).rejects.toThrow(/disposed|closed/);
  });
});

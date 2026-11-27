import {
  UI_PROTOCOL,
  type UiHostMessage,
  type UiReadyMessage,
} from '../../runtime/ui/protocol';
import { isProgressStorageEvent, ProgressStore, type StorageLike } from '../platform/progress';
import { localEventKey, scopedStorage } from '../platform/channel';

function browserStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : scopedStorage(window.localStorage);
  } catch {
    return null;
  }
}

export interface OriginalUiInitOptions {
  activityStartStamp: number;
  serverNowStamp: number;
  gameplay?: boolean;
}

interface Pending {
  resolve: (value: never) => void;
  reject: (error: Error) => void;
  ready?: UiReadyMessage;
}

export class OriginalUiClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Set<(message: UiHostMessage) => void>();
  private sequence = 0;
  private session = '';
  private progressSlotId = '';
  private closed = false;
  private readonly onStorage = (event: StorageEvent): void => {
    const key = localEventKey(event.key);
    if (key === undefined || !this.session || this.closed || !isProgressStorageEvent(key, this.progressSlotId)) return;
    const { clearedStageIds, assistedStageIds } = this.progressStore.load(this.progressSlotId);
    void this.request('presentation', { session: this.session, signal: { kind: 'progress', clearedStageIds, assistedStageIds } })
      .catch(() => { /* The worker may have closed or been reinitialized. */ });
  };

  constructor(
    workerUrl?: string | URL,
    private readonly progressStore = new ProgressStore(browserStorage()),
  ) {
    if (workerUrl === undefined && typeof document === 'undefined') {
      throw new Error('OriginalUiClient: workerUrl is required outside a document context');
    }
    this.worker = new Worker(workerUrl ?? new URL('assets/ui-host-worker.js', document.baseURI), { type: 'classic' });
    this.worker.addEventListener('message', ({ data }) => this.receive(data as UiHostMessage));
    this.worker.addEventListener('error', (event) => {
      this.fail(new Error(event.message || 'UI worker failed'));
    });
    if (typeof window !== 'undefined') window.addEventListener('storage', this.onStorage);
  }

  get sessionId(): string {
    return this.session;
  }

  onMessage(listener: (message: UiHostMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private receive(message: UiHostMessage): void {
    if (message.protocol !== UI_PROTOCOL) return;
    if (message.type === 'ready') {
      this.session = message.session;
      const pending = this.pending.get(message.requestId);
      if (pending) pending.ready = message;
      return;
    }
    if (message.type === 'settled') {
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      this.pending.delete(message.requestId);
      (pending.resolve as (value: UiReadyMessage | void) => void)(pending.ready as UiReadyMessage);
      return;
    }
    if (message.type === 'disposed') {
      const pending = this.pending.get(message.requestId);
      if (pending) {
        this.pending.delete(message.requestId);
        (pending.resolve as (value: void) => void)();
      }
      return;
    }
    if (message.type === 'error') {
      if (message.requestId !== undefined) {
        const pending = this.pending.get(message.requestId);
        if (pending) {
          this.pending.delete(message.requestId);
          pending.reject(new Error(`${message.code}: ${message.message}`));
          return;
        }
      }
    }
    if (this.session && message.session && message.session !== this.session) return;
    if (message.type === 'event' && message.event.name === 'clear-earned' && this.session && this.progressSlotId) {
      const saved = this.progressStore.commitClear(message.event.stageId, this.progressSlotId, message.event.assisted ? 'assisted' : 'natural');
      if (!saved.persistent) {
        for (const listener of this.listeners) listener({ ...message, event: { name: 'progress-save-failed' } });
      }
    }
    for (const listener of this.listeners) listener(message);
  }

  private fail(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.closed = true;
    if (typeof window !== 'undefined') window.removeEventListener('storage', this.onStorage);
    this.worker.terminate();
  }

  private request(type: string, fields: Record<string, unknown>): Promise<never> {
    if (this.closed) return Promise.reject(new Error('OriginalUiClient is disposed'));
    const requestId = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.worker.postMessage({ protocol: UI_PROTOCOL, type, requestId, ...fields });
    });
  }

  init(options: OriginalUiInitOptions): Promise<UiReadyMessage> {
    if (this.closed) return Promise.reject(new Error('OriginalUiClient is disposed'));
    this.session = '';
    this.progressSlotId = this.progressStore.listSlots().activeSlotId;
    const progress = this.progressStore.load(this.progressSlotId);
    const fields: Record<string, unknown> = {
      gameplay: options.gameplay === true,
      activityStartStamp: options.activityStartStamp,
      serverNowStamp: options.serverNowStamp,
      clearedStageIds: progress.clearedStageIds,
      assistedStageIds: progress.assistedStageIds,
      allUnlocked: progress.allUnlocked,
    };
    if (typeof document !== 'undefined') fields['baseUrl'] = new URL('./', document.baseURI).href;
    return this.request('init', fields) as Promise<UiReadyMessage>;
  }

  click(componentId: number): Promise<void> {
    return this.request('click', { session: this.session, componentId }) as Promise<void>;
  }

  tick(ms: number): Promise<void> {
    return this.request('presentation', { session: this.session, signal: { kind: 'tick', ms } });
  }

  levelUp(): Promise<void> {
    return this.request('presentation', { session: this.session, signal: { kind: 'debug-level' } });
  }

  background(): Promise<void> {
    return this.request('presentation', { session: this.session, signal: { kind: 'background' } });
  }

  windowShown(rootId: number): Promise<void> {
    return this.request('presentation', { session: this.session, signal: { kind: 'shown', rootId } });
  }

  transition(playId: number, label?: string): Promise<void> {
    return this.request('presentation', { session: this.session, signal: { kind: 'transition', playId, label } });
  }

  async dispose(): Promise<void> {
    if (this.closed) return;
    try {
      await this.request('dispose', {});
    } finally {
      this.closed = true;
      if (typeof window !== 'undefined') window.removeEventListener('storage', this.onStorage);
      this.worker.terminate();
    }
  }
}

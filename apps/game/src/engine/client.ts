import { RULES_PROTOCOL, type RuleReply, type RngInput } from './protocol';

interface Pending {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  runId: string;
}

export class RulesClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, Pending>();
  private sequence = 0;
  private runId = '';
  private closed = false;

  constructor(workerUrl?: string | URL) {
    this.worker = new Worker(workerUrl ?? new URL('./worker.ts', import.meta.url), { type: 'classic' });
    this.worker.postMessage({ protocol: RULES_PROTOCOL, type: 'configure', baseUrl: new URL('./', document.baseURI).href });
    this.worker.addEventListener('message', ({ data }) => {
      const pending = this.pending.get(data.requestId);
      if (!pending) return;
      this.pending.delete(data.requestId);
      if (data.runId !== pending.runId) return;
      if (data.protocol !== RULES_PROTOCOL) {
        pending.reject(new Error('Unexpected Worker protocol'));
      } else if (data.type === 'error') {
        pending.reject(new Error(`${data.code}: ${data.message}`));
      } else {
        pending.resolve(data);
      }
    });
    this.worker.addEventListener('error', (event) => {
      this.fail(new Error(event.message));
    });
  }

  private fail(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.closed = true;
    this.worker.terminate();
  }

  private request(type: string, fields: Record<string, unknown> = {}, runId = this.runId): Promise<any> {
    if (this.closed) return Promise.reject(new Error('Rules client is closed'));
    const requestId = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject, runId });
      this.worker.postMessage({ protocol: RULES_PROTOCOL, type, requestId, runId, ...fields });
    });
  }

  async start(stageId: number, rng: RngInput): Promise<RuleReply> {
    this.runId = crypto.randomUUID();
    return this.request('init', { stageId, tape: [...rng.tape], globalRngSeeds: [...rng.globalRngSeeds] });
  }

  describe(): Promise<any> {
    return this.request('contract', {}, '');
  }

  snapshot(): Promise<RuleReply> {
    return this.request('snapshot');
  }

  stepFixed(count: number): Promise<RuleReply> {
    return this.request('step-fixed', { count });
  }

  advanceUnscaled(ms: number): Promise<RuleReply> {
    return this.request('advance-unscaled', { ms });
  }

  speed(index: 1 | 2): Promise<RuleReply> {
    return this.request('speed', { index });
  }

  pause(): Promise<RuleReply> {
    return this.request('pause');
  }

  resume(): Promise<RuleReply> {
    return this.request('resume');
  }

  select(windowId: number, generation: number, skillId: number, confirm: boolean): Promise<RuleReply> {
    return this.request('select', { windowId, generation, skillId, confirm });
  }

  async close(): Promise<void> {
    if (!this.runId) return;
    try {
      await this.request('close');
    } finally {
      this.closed = true;
      this.worker.terminate();
      this.runId = '';
    }
  }

  dispose(): void {
    this.fail(new Error('Rules client disposed'));
  }
}

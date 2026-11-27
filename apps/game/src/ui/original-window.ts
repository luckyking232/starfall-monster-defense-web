import type { UiEvent, UiHostMessage, UiOp, UiReadyMessage } from '../../runtime/ui/protocol';
import { FguiRuntime } from '../fgui/display';
import { OriginalUiClient, type OriginalUiInitOptions } from './client';
import { toFguiChild } from './tree';

export class OriginalUiWindow {
  readonly runtime: FguiRuntime;
  private readonly unsubscribe: () => void;
  private chain = Promise.resolve();
  private disposed = false;
  private failure: Error | null = null;

  constructor(
    parent: HTMLElement,
    private readonly client: OriginalUiClient,
    private readonly onEvent: (event: UiEvent) => void,
    private readonly onError: (error: Error) => void,
    private readonly beforeShown?: (window: string) => Promise<void>,
    atlasProgress?: (fraction: number) => void,
  ) {
    this.runtime = new FguiRuntime(parent, (action) => {
      if (action.componentId === undefined || this.disposed) return;
      void this.client.click(action.componentId).catch((error: unknown) => this.fail(error));
    }, true, atlasProgress, true);
    this.unsubscribe = client.onMessage((message) => {
      this.chain = this.chain.then(() => this.receive(message));
    });
  }

  async init(options: OriginalUiInitOptions): Promise<UiReadyMessage> {
    const ready = await this.client.init(options);
    await this.idle();
    return ready;
  }

  async idle(): Promise<void> {
    await this.chain;
    if (this.failure) throw this.failure;
  }

  handlerCount(componentId: number): number {
    return this.runtime.clickHandlerCount(componentId);
  }

  setPaused(paused: boolean): void {
    this.runtime.setPaused(paused);
  }

  setTransitionTimeScale(scale: number): void {
    this.runtime.setTransitionTimeScale(scale);
  }

  private async receive(message: UiHostMessage): Promise<void> {
    if (this.disposed || this.failure) return;
    try {
      if (message.type === 'open') {
        await this.beforeShown?.(message.window);
        await this.runtime.showTree(message.window, message.tree);
        if (!this.disposed) void this.client.windowShown(message.rootId).catch((error: unknown) => this.fail(error));
      } else if (message.type === 'ops') {
        const assets = this.runtime.prepareOps(message.ops);
        if (assets) await assets;
        if (this.disposed) return;
        for (const op of message.ops) this.apply(op);
      } else if (message.type === 'close') this.runtime.close(message.window);
      else if (message.type === 'event') this.onEvent(message.event);
      else if (message.type === 'error') this.fail(new Error(`${message.code}: ${message.message}`));
    } catch (error) {
      this.fail(error);
    }
  }

  private apply(op: UiOp): void {
    if (op.op === 'child-add') {
      this.runtime.addChild(op.id, op.item);
      return;
    }
    if (op.op === 'child-remove') {
      this.runtime.removeChild(op.id);
      return;
    }
    if (op.op === 'transition-play') {
      const report = (label?: string) => {
        if (this.disposed || this.failure) return;
        void this.client.transition(op.playId, label).catch((error: unknown) => this.fail(error));
      };
      this.runtime.playTransition(op.id, op.name, {
        scaled: op.scaled === true,
        onLabel: (label) => { if (op.labels?.includes(label)) report(label); },
        onComplete: () => report(),
      });
      return;
    }
    if (op.op === 'transition-stop') {
      this.runtime.stopTransition(op.id, op.name);
      return;
    }
    const path = this.runtime.componentPath(op.id);
    if (op.op === 'click-handlers') {
      this.runtime.setClickable(path, op.count);
    } else if (op.op === 'controller') {
      this.runtime.setController(path, op.name, op.index);
    } else if (op.op === 'list-items') {
      this.runtime.clearList(path);
      for (const item of op.items) this.runtime.addListItem(path, toFguiChild(item));
    } else if (op.op === 'list-add') {
      this.runtime.addListItem(path, toFguiChild(op.item));
    } else if (op.op === 'list-clear') {
      this.runtime.clearList(path);
    } else if (op.op === 'list-trim') {
      this.runtime.trimList(path, op.count);
    } else if (op.op === 'center') {
      this.runtime.setPosition(path, op.x, op.y);
    } else if (op.op === 'scroll') {
      this.runtime.setScroll(path, op.x);
    } else if (op.op === 'set') {
      if (op.key === 'text') this.runtime.setText(path, String(op.value));
      else if (op.key === 'url') this.runtime.setUrl(path, String(op.value));
      else if (op.key === 'visible') this.runtime.setVisible(path, op.value === true);
      else if (op.key === 'touchable') this.runtime.setTouchable(path, op.value === true);
      else if (op.key === 'alpha') this.runtime.find(path).container.setAlpha(Number(op.value));
      else if (op.key === 'rotation') this.runtime.setRotation(path, Number(op.value));
      else if (op.key === 'scaleX') this.runtime.setScale(path, Number(op.value), this.runtime.find(path).container.scaleY);
      else if (op.key === 'scaleY') this.runtime.setScale(path, this.runtime.find(path).container.scaleX, Number(op.value));
      else if (op.key === 'x') this.runtime.setPosition(path, Number(op.value), this.runtime.find(path).y);
      else if (op.key === 'y') this.runtime.setPosition(path, this.runtime.find(path).x, Number(op.value));
      else if (op.key === 'width' || op.key === 'height') {
        const node = this.runtime.find(path);
        const width = op.key === 'width' ? Number(op.value) : node.width;
        const height = op.key === 'height' ? Number(op.value) : node.height;
        this.runtime.setSize(path, width, height);
      } else if (op.key === 'value') this.runtime.setProgress(path, Number(op.value));
      else throw new Error(`未支持的原组件属性：${op.key}`);
    }
  }

  private fail(error: unknown): void {
    if (this.failure || this.disposed) return;
    this.failure = error instanceof Error ? error : new Error(String(error));
    this.onError(this.failure);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.runtime.dispose();
    await this.client.dispose();
  }
}

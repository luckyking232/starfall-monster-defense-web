import { element } from '../scenes/dom';

type Task = { label:string; prepare:()=>Promise<void>; skip?:()=>void };

/** Shows only the resources that still prevent the original battle from starting. */
export class BattleWait {
  readonly root = element('div','battle-wait');
  private readonly list = element('div','battle-wait-list');
  private cancel = new AbortController();

  constructor() {
    this.root.hidden = true;
    this.root.setAttribute('aria-label','战斗资源加载');
    this.list.setAttribute('aria-live','polite');
    this.root.append(this.list);
  }

  open(): void {
    this.close();
    this.root.hidden = false;
  }

  async prepare(task: Task): Promise<void> {
    const signal = this.cancel.signal;
    const row = element('div','battle-wait-row');
    this.list.append(row);
    while (!signal.aborted) {
      row.textContent = '正在准备' + task.label + '…';
      try {
        await task.prepare();
        break;
      } catch (error) {
        if (signal.aborted) break;
        console.warn(task.label + '准备失败',error);
        const choice = await new Promise<'retry'|'skip'|'cancel'>(resolve => {
          const cancel = () => resolve('cancel');
          signal.addEventListener('abort', cancel, {once:true});
          row.textContent = task.label + '加载失败';
          const action = (label:string, value:'retry'|'skip') => {
            const button = element('button',undefined,label);
            button.onclick = () => { signal.removeEventListener('abort',cancel); resolve(value); };
            row.append(button);
          };
          action(task.skip ? '重试音乐' : '重试画面','retry');
          if (task.skip) action('无音乐进入','skip');
        });
        if (choice === 'retry') continue;
        if (choice === 'skip') task.skip?.();
        break;
      }
    }
    row.remove();
    if (!signal.aborted && !this.list.childElementCount) this.list.textContent = '正在进入战斗…';
  }

  nativeVisible(visible:boolean): void {
    this.root.classList.toggle('with-original',visible);
  }

  close(): void {
    this.cancel.abort();
    this.cancel = new AbortController();
    this.list.replaceChildren();
    this.root.hidden = true;
    this.nativeVisible(false);
  }
}

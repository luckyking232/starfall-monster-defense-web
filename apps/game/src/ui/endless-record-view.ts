import type { EndlessRecord, EndlessSnapshot } from '../platform/progress';
import type { FguiRuntime } from '../fgui/display';
import type { UiEvent } from '../../runtime/ui/protocol';
import { element } from '../scenes/dom';

type Result = Extract<UiEvent, { name: 'endless-record' }>;

export class EndlessRecordView {
  private readonly text = element('div', 'endless-record-accessible');
  private result: Result | undefined;

  constructor(parent: HTMLElement) {
    this.text.setAttribute('role', 'note');
    this.text.setAttribute('aria-label', '无尽纪录');
    this.text.hidden = true;
    parent.append(this.text);
  }

  setResult(result: Result | undefined): void {
    this.result = result;
  }

  sync(runtime: FguiRuntime, read: () => EndlessSnapshot): void {
    const chooser = runtime.topWindow === 'Activity17MiniGameChoice2Window';
    const result = runtime.topWindow === 'MiniGameBattleEndWindow' ? this.result : undefined;
    this.text.hidden = !chooser && !result;
    if (this.text.hidden) return;

    const records = read();
    const line = (title: string, record: EndlessRecord | null, source: EndlessRecord['source']) =>
      title + '　' + (record ? `击退 ${record.kills} · 到达第 ${record.wave} 波` : '暂无纪录') +
      (result?.newRecord && result.source === source && result.runId === record?.runId ? '　新纪录' : '');
    const value = [line('正式最佳', records.natural, 'natural'), line('练习最佳', records.practice, 'practice')].join('\n');
    if (this.text.textContent !== value) this.text.textContent = value;

    if (chooser) {
      const list = runtime.views.get('Activity17MiniGameChoice2Window')?.root.children.get('Main')?.children.get('TipsList');
      const endless = list?.list?.items[0]?.children.get('SpecialBtn');
      if (endless) runtime.setAnnotation(endless, value, endless.width / 2, endless.height + 1, 20);
    } else {
      const main = runtime.views.get('MiniGameBattleEndWindow')?.root.children.get('Main');
      if (main) runtime.setAnnotation(main, value, main.width / 2, 445, 23);
    }
  }
}

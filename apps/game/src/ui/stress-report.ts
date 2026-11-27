import type { StressConfig, StressCounts, StressMetrics, StressSecond } from '../presentation/stress-metrics';
import type { StressRunSummary } from '../presentation/stress-session';
import { element } from '../scenes/dom';
import '../styles/stress-report.css';

const NO_VALUE = '—';

function milliseconds(value: number | null): string {
  return value === null ? NO_VALUE : `${value.toFixed(1)} ms`;
}

function seconds(value: number): string {
  return `${(value / 1000).toFixed(2)} 秒`;
}

function fps(value: number | null, fractional = false): string {
  return value === null ? NO_VALUE : `${fractional ? value.toFixed(1) : value} FPS`;
}

function configText(config: StressConfig): string {
  const renderer = config.renderer === 'webgl' ? 'WebGL' : config.renderer === 'canvas' ? 'Canvas' : config.renderer;
  return `${renderer} · ${config.width} × ${config.height} · ${config.speed}×速`;
}

function values(entries: readonly (readonly [string, string | number])[]): HTMLDListElement {
  const list = element('dl', 'stress-values');
  for (const [label, value] of entries) {
    const item = element('div');
    item.append(element('dt', undefined, label), element('dd', undefined, String(value)));
    list.append(item);
  }
  return list;
}

function loadValues(counts: StressCounts, hurtLabel: string): HTMLDListElement {
  return values([
    ['怪物', counts.opponents], ['弹体', counts.projectiles],
    ['特效', counts.effects], [hurtLabel, counts.hurtNumbers],
  ]);
}

function windowDetails(sample: StressSecond): HTMLElement {
  const section = element('section', 'stress-window');
  section.append(element('h3', undefined, '最差一秒负载'),
    element('p', 'stress-meta', `有效时段 ${seconds(sample.startMs)} 至 ${seconds(sample.startMs + sample.durationMs)} · ${configText(sample.config)}`),
    loadValues(sample.counts, '新增飘字'),
    element('p', 'stress-meta', sample.frames === 0 ? '该秒没有出图。怪物、弹体和特效沿用卡顿前最后一帧的记录。' :
      '怪物、弹体和特效各取该秒出图时的峰值，飘字统计该秒新增数。'));
  return section;
}

export function renderStressDetails(summary: StressRunSummary): HTMLElement {
  const section = element('section', 'stress-report');
  section.setAttribute('aria-label', '压测统计');
  section.append(values([
    ['最差一秒', fps(summary.worstSecond?.fps ?? null)], ['有效计时', seconds(summary.activeMs)],
    ['游戏时间推进', `${summary.gameSeconds.toFixed(2)} 秒`],
    ['帧间隔 P95', milliseconds(summary.p95Ms)], ['帧间隔 P99', milliseconds(summary.p99Ms)],
    ['最长帧间隔', milliseconds(summary.maxGapMs)], ['帧间隔 > 100 ms', `${summary.gapsOver100Ms} 次`],
    ['帧间隔 > 1 秒', `${summary.stallsOver1s} 次`], ['帧间隔样本', summary.intervals],
  ]));
  if (summary.maxUnfinishedGapMs !== null && summary.maxUnfinishedGapMs > 100) {
    section.append(element('p', 'stress-meta', `中断前最长无出图 ${milliseconds(summary.maxUnfinishedGapMs)}，计入有效时长与每秒出图数。`));
  }
  if (summary.latestConfig) section.append(element('p', 'stress-meta', `最后出图 · ${configText(summary.latestConfig)}`));
  if (summary.worstSecond) section.append(windowDetails(summary.worstSecond));
  else section.append(element('p', 'stress-meta', '有效片段达到一秒后显示最差一秒和对应负载。'));
  if (summary.partialSecond) {
    const sample = summary.partialSecond;
    section.append(element('p', 'stress-meta', `末段采样 ${seconds(sample.durationMs)} · ${sample.frames} 帧 · 折算 ${fps(sample.fps, true)}`));
  }
  if (summary.latestCounts) {
    const latest = element('section', 'stress-window');
    latest.append(element('h3', undefined, '最后一帧负载'), loadValues(summary.latestCounts, '帧间新增飘字'));
    section.append(latest);
  }
  section.append(element('p', 'stress-meta stress-method',
    '按实际战场出图的墙钟间隔统计，有效片段从首帧起每秒取样。加载、暂停、切后台和设置期间停止计时。改变速度或画面配置后开始新片段。P95 和 P99 按全程样本估算。'));
  return section;
}

export class StressReport {
  private readonly overlay = element('div', 'stress-live', '压测 · 采样中');
  private nextUpdate = 0;

  constructor(root: HTMLElement) {
    this.overlay.hidden = true;
    root.append(this.overlay);
  }

  reset(): void {
    this.nextUpdate = 0;
    this.overlay.textContent = '压测 · 采样中';
  }

  setLive(visible: boolean): void {
    const hidden = !visible;
    if (this.overlay.hidden === hidden) return;
    this.overlay.hidden = hidden;
    this.nextUpdate = 0;
  }

  frame(time: number, metrics: StressMetrics): void {
    if (this.overlay.hidden || time < this.nextUpdate) return;
    this.nextUpdate = time + 500;
    const { latestSecond, worstSecond, partialSecond, latestCounts, p95Ms } = metrics.summary();
    const value = latestSecond ? fps(latestSecond.fps) : partialSecond ? `约 ${fps(partialSecond.fps, true)}` : '采样中';
    const text = `压测 · ${value}${worstSecond ? ` · 最差一秒 ${worstSecond.fps} FPS` : ''}` +
      (p95Ms === null ? '' : ` · P95 ${Math.round(p95Ms)} ms`) + (latestCounts ? ` · 怪 ${latestCounts.opponents}` : '');
    if (text !== this.overlay.textContent) this.overlay.textContent = text;
  }
}

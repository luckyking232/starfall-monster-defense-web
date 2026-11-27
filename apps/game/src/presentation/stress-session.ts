import { RULES_FPS, type RuleState } from '../engine/protocol';
import type { UiOp } from '../../runtime/ui/protocol';
import { StressMetrics, type StressConfig, type StressSummary } from './stress-metrics';

const damageTips = new Set(['NormalHitNumberTips','CritHitNumberTips','GreenHpNumberTips']);
export type StressRunSummary = StressSummary & { gameSeconds: number };

export class StressSession {
  metrics: StressMetrics | null = null;
  private previous: StressRunSummary | null = null;
  private lastRuleFrame: number | undefined;
  private advancedFrames = 0;
  private emitted = 0;

  begin(): void {
    this.metrics = new StressMetrics();
    this.previous = null;
    this.advancedFrames = 0;
    this.lastRuleFrame = undefined;
    this.emitted = 0;
  }

  observe(ops: readonly UiOp[]): void {
    if (!this.metrics) return;
    for (const op of ops) {
      if (op.op === 'child-add' && (damageTips.has(op.item.name) || damageTips.has(op.item.refName ?? ''))) this.emitted++;
    }
  }

  rendered(time: number, state: RuleState, config: StressConfig): void {
    if (!this.metrics) return;
    if (this.lastRuleFrame !== undefined) this.advancedFrames += Math.max(0, state.fixedFrame - this.lastRuleFrame);
    this.lastRuleFrame = state.fixedFrame;
    let opponents = 0;
    for (const unit of state.units) if (unit.camp === 2) opponents++; // Original BATTLE_CAMP_FLAG.RIGHT
    this.metrics.rendered(time,{opponents,projectiles:state.bullets?.length ?? 0,
      effects:state.effects?.length ?? 0,hurtNumbers:this.emitted},config);
    this.emitted = 0;
  }

  interrupt(at?: number): void {
    this.metrics?.interrupt(at);
    this.lastRuleFrame = undefined;
    this.emitted = 0;
  }

  summary(): StressRunSummary | null {
    return this.metrics ? {...this.metrics.summary(),gameSeconds:this.advancedFrames / RULES_FPS} : this.previous;
  }

  end(at?: number): void {
    if (this.metrics) {
      this.interrupt(at);
      this.previous = this.summary();
    }
    this.metrics = null;
    this.emitted = 0;
  }
}

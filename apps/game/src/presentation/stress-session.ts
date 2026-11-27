import type { RuleState } from '../engine/protocol';
import type { UiOp } from '../../runtime/ui/protocol';
import { StressMetrics, type StressConfig, type StressSummary } from './stress-metrics';

const damageTips = new Set(['NormalHitNumberTips','CritHitNumberTips','GreenHpNumberTips']);

export class StressSession {
  metrics: StressMetrics | null = null;
  private previous: StressSummary | null = null;
  private emitted = 0;

  begin(): void {
    this.metrics = new StressMetrics();
    this.previous = null;
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
    let opponents = 0;
    for (const unit of state.units) if (unit.camp === 2) opponents++; // Original BATTLE_CAMP_FLAG.RIGHT
    this.metrics.rendered(time,{opponents,projectiles:state.bullets?.length ?? 0,
      effects:state.effects?.length ?? 0,hurtNumbers:this.emitted},config);
    this.emitted = 0;
  }

  interrupt(at?: number): void {
    this.metrics?.interrupt(at);
    this.emitted = 0;
  }

  summary(): StressSummary | null {
    return this.metrics?.summary() ?? this.previous;
  }

  end(at?: number): void {
    if (this.metrics) {
      this.interrupt(at);
      this.previous = this.metrics.summary();
    }
    this.metrics = null;
    this.emitted = 0;
  }
}

/** Wall time between the last 120 actual battlefield submissions. */
export class WorldFrameTime {
  private readonly durations = new Float64Array(120);
  private last: number | undefined;
  private index = 0;
  private count = 0;

  reset(): void {
    this.last = undefined;
    this.index = this.count = 0;
  }

  rendered(time: number): void {
    if (this.last !== undefined && time > this.last) {
      this.durations[this.index] = time - this.last;
      this.index = (this.index + 1) % this.durations.length;
      this.count = Math.min(this.count + 1,this.durations.length);
    }
    this.last = time;
  }

  summary(): {fps:number; p95:number; slow:number} | null {
    if (!this.count) return null;
    const sample = this.durations.slice(0,this.count).sort();
    return { fps:Math.round(this.count * 1000 / sample.reduce((a,b) => a+b,0)),
      p95:Math.round(sample[Math.ceil(this.count * 0.95)-1]!), slow:sample.filter(x => x > 100).length };
  }
}

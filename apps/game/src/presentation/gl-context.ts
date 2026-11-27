export class GlContextLost extends Error {
  constructor() { super('The WebGL context was lost.'); }
}

export function glFailure(gl: WebGLRenderingContext, message: string, code?: number): Error {
  return (code === undefined ? gl.isContextLost() : code === gl.CONTEXT_LOST_WEBGL)
    ? new GlContextLost() : new Error(message);
}

/** Wait for the browser to restore the same canvas. */
export class GlContextRecovery {
  private pending: {ready: Promise<void>; resume: () => void} | undefined;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly gl: WebGLRenderingContext,
    private readonly invalidate: () => void, private readonly restore: () => void) {
    canvas.addEventListener('webglcontextlost', this.lost);
    canvas.addEventListener('webglcontextrestored', this.restored);
  }

  get waiting(): Promise<void> | undefined {
    if (this.gl.isContextLost()) this.suspend();
    return this.pending?.ready;
  }

  private suspend(): void {
    if (this.pending) return;
    let resume!: () => void;
    const ready = new Promise<void>(done => { resume = done; });
    this.pending = {ready, resume};
    this.invalidate();
  }

  private readonly lost = (event: Event) => {
    event.preventDefault();
    this.suspend();
  };

  private readonly restored = () => {
    const pending = this.pending;
    this.pending = undefined;
    try { this.restore(); }
    finally { pending?.resume(); }
  };

  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.lost);
    this.canvas.removeEventListener('webglcontextrestored', this.restored);
    this.pending?.resume();
    this.pending = undefined;
  }
}

import { MeshProjectiles } from './mesh-projectiles';

const model = {
  path:'assets/art/effects/prefab/ui_prefab/loading/fx_ui_loading.prefab',
  position:{x:0,y:0,z:0}, scale:{x:1,y:1,z:1}, order:0, time:0, age:0, instance:1,
};

export class LoadingEffect {
  readonly canvas = document.createElement('canvas');
  private readonly context: CanvasRenderingContext2D;
  private effects?: MeshProjectiles;
  private frame = 0;

  constructor(private readonly alpha: () => number, private readonly paused: () => boolean,
    private readonly fail: (reason: unknown) => void) {
    this.canvas.className = 'loading-art';
    this.canvas.setAttribute('aria-hidden','true');
    this.canvas.width = 1334;
    this.canvas.height = 750;
    this.canvas.hidden = true;
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('无法创建过场画布');
    this.context = context;
  }
  prepare(): Promise<void> {
    const effects = this.effects ??= new MeshProjectiles(this.canvas.width,this.canvas.height,'loading',{
      fail: reason => {
        if (this.effects !== effects) return;
        if (!this.canvas.hidden) this.fail(reason);
        else {
          effects.dispose();
          delete this.effects;
        }
      },
    });
    return effects.prepare().catch(error => {
      if (this.effects === effects) {
        effects.dispose();
        delete this.effects;
      }
      throw error;
    });
  }
  show(visible: boolean): void {
    if (visible === !this.canvas.hidden) return;
    this.canvas.hidden = !visible;
    cancelAnimationFrame(this.frame);
    this.context.clearRect(0,0,this.canvas.width,this.canvas.height);
    if (!visible || !this.effects) return;
    let last = performance.now(), age = 0;
    const paint = (now:number) => {
      if (!this.paused()) age += Math.min(0.1,(now-last)/1000);
      last = now;
      const effects = this.effects;
      if (effects?.drawable) {
        try {
          this.context.clearRect(0,0,this.canvas.width,this.canvas.height);
          this.context.globalAlpha = this.alpha();
          effects.draw(this.context,effects.layers([{...model,age,time:age}],age));
        } catch (error) {
          if (!effects.recoverFrom(error)) {
            this.fail(error);
            return;
          }
        }
      }
      this.frame = requestAnimationFrame(paint);
    };
    this.frame = requestAnimationFrame(paint);
  }
  dispose(): void {
    this.show(false);
    this.effects?.dispose();
  }
}

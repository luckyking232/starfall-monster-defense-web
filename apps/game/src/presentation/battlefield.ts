import Phaser from 'phaser';
import type { BattleContent, CardDefinition } from '../content/catalog';
import type { StageDefinition } from '../content/stages';
import type { RuleEvent, RuleReply, RuleUnitState } from '../engine/protocol';
import { asset } from '../scenes/dom';
import { unitFrameKeys } from './frames';
import { projectBattlePosition } from './projection';

interface AssetManifest {
  files: Record<string, { sha256: string }>;
}

interface Actor {
  image: Phaser.GameObjects.Image;
  frames: string[];
  scale: number;
  deadAt: number | null;
}

class BattlefieldScene extends Phaser.Scene {
  readonly failures: string[] = [];

  constructor(
    private readonly stage: StageDefinition,
    private readonly manifest: AssetManifest,
    private readonly created: (scene: BattlefieldScene) => void,
  ) {
    super('battlefield');
  }

  preload(): void {
    this.load.image('battle-map', asset(`maps/${this.stage.map}.png`));
    for (const path of Object.keys(this.manifest.files)) {
      if (path.startsWith('units/') || path === 'effects/MiniGame022_bullet1.png') this.load.image(path, asset(path));
    }
    this.load.on('loaderror', (file: Phaser.Loader.File) => this.failures.push(file.key));
  }

  create(): void {
    const scale = Math.max(1334 / 1668, 750 / 1004);
    this.add.image(667, 375, 'battle-map').setDisplaySize(1668 * scale, 1004 * scale).setDepth(-4000);
    this.created(this);
  }
}

export class Battlefield {
  readonly ready: Promise<void>;
  private readonly game: Phaser.Game;
  private scene: BattlefieldScene | null = null;
  private readonly actors = new Map<number, Actor>();
  private readonly wallParts: Phaser.GameObjects.Image[] = [];
  private readonly totals = new Map<number, number>();
  private latest: RuleReply | null = null;

  constructor(
    parent: HTMLElement,
    private readonly stage: StageDefinition,
    private readonly content: BattleContent,
    manifest: AssetManifest,
  ) {
    let complete!: () => void;
    let reject!: (error: Error) => void;
    this.ready = new Promise<void>((resolve, fail) => { complete = resolve; reject = fail; });
    const scene = new BattlefieldScene(stage, manifest, (created) => {
      if (scene.failures.length) {
        reject(new Error(`战斗素材加载失败：${scene.failures.join(', ')}`));
        return;
      }
      this.scene = created;
      if (this.latest) this.render(this.latest);
      complete();
    });
    this.game = new Phaser.Game({
      type: Phaser.AUTO,
      parent,
      width: 1334,
      height: 750,
      backgroundColor: '#111513',
      scene,
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      render: { pixelArt: true, antialias: false },
      audio: { noAudio: true },
    });
  }

  private frames(card: CardDefinition): string[] {
    return unitFrameKeys(card.spd, Object.keys(this.scene!.textures.list));
  }

  private createActor(unit: RuleUnitState): Actor {
    const card = this.content.cards.get(unit.cardId);
    if (!card) throw new Error(`缺少角色配置：${unit.cardId}`);
    const frames = this.frames(card);
    if (!frames.length) throw new Error(`缺少角色帧：${unit.cardId}`);
    const point = projectBattlePosition(unit);
    const scale = card.spd_scale / 10000;
    if (card.type === 5) {
      let image!: Phaser.GameObjects.Image;
      for (let index = 0; index < 8; index++) {
        const part = projectBattlePosition({ ...unit, y: unit.y + (index - 3.5) * 90 });
        const segment = this.scene!.add.image(part.x, part.y, frames[0]!).setDepth(-500 + index).setScale(scale);
        image ??= segment;
        this.wallParts.push(segment);
      }
      return { image, frames, scale, deadAt: null };
    }
    const image = this.scene!.add.image(point.x, point.y, frames[0]!)
      .setOrigin(0.5, 0.8)
      .setScale(scale)
      .setFlipX(unit.flipped);
    return { image, frames, scale, deadAt: null };
  }

  private effect(event: RuleEvent): void {
    const scene = this.scene;
    if (!scene) return;
    if (event.kind === 'bullet') {
      const skill = this.content.skills.get(Number(event.args[1]));
      const start = projectBattlePosition({ x: Number(event.args[3]), y: Number(event.args[4]), z: 0 });
      const end = projectBattlePosition({ x: Number(event.args[5]), y: Number(event.args[6]), z: 0 });
      const image = scene.add.image(start.x, start.y, 'effects/MiniGame022_bullet1.png').setDepth(1000).setScale(0.45);
      const speed = skill?.bullet_speed ?? 500;
      const distance = Math.hypot(end.x - start.x, end.y - start.y);
      scene.tweens.add({
        targets: image,
        x: end.x,
        y: end.y,
        duration: Math.max(30, distance / speed * 1000),
        onComplete: () => image.destroy(),
      });
    } else if (event.kind === 'hit') {
      const uid = Number(event.args[2]);
      const actor = this.actors.get(uid);
      const real = Number(event.args[4]);
      const attacker = Number(event.args[0]);
      this.totals.set(attacker, (this.totals.get(attacker) ?? 0) + real);
      if (actor) {
        if (Number(event.args[6]) <= 0) actor.deadAt = event.frame;
        const text = scene.add.text(actor.image.x, actor.image.y - 60, `${Math.round(real)}`, {
          fontFamily: 'SourceHanSans, Microsoft YaHei, sans-serif',
          fontSize: '24px',
          color: '#ffe08c',
          stroke: '#502a21',
          strokeThickness: 4,
        }).setOrigin(0.5).setDepth(1500);
        scene.tweens.add({ targets: text, y: text.y - 42, alpha: 0, duration: 550, onComplete: () => text.destroy() });
      }
    }
  }

  render(reply: RuleReply): void {
    this.latest = reply;
    const scene = this.scene;
    if (!scene) return;
    for (const event of reply.events) this.effect(event);
    if (reply.state.terminal) {
      scene.tweens.pauseAll();
      return;
    }
    const alive = new Set<number>();
    for (const unit of reply.state.units) {
      alive.add(unit.uid);
      let actor = this.actors.get(unit.uid);
      if (!actor) {
        actor = this.createActor(unit);
        this.actors.set(unit.uid, actor);
      }
      if (this.content.cards.get(unit.cardId)?.type !== 5) {
        const point = projectBattlePosition(unit);
        const frame = Math.floor(reply.state.fixedFrame / 3) % actor.frames.length;
        actor.image.setPosition(point.x, point.y).setDepth(-unit.y).setFlipX(unit.flipped);
        actor.image.setTexture(actor.frames[frame]!);
        if (unit.stateName === 'DEAD') actor.deadAt ??= reply.state.fixedFrame;
        actor.image.setAlpha(actor.deadAt === null ? 1 : Math.max(0, 1 - (reply.state.fixedFrame - actor.deadAt) / 15));
      }
    }
    for (const [uid, actor] of this.actors) {
      if (!alive.has(uid)) {
        actor.image.destroy();
        this.actors.delete(uid);
      }
    }
    if (reply.state.paused) scene.tweens.pauseAll();
    else {
      scene.tweens.timeScale = reply.state.speedIndex ?? 1;
      scene.tweens.resumeAll();
    }
  }

  damageTotal(cardId: number): number {
    return this.totals.get(cardId) ?? 0;
  }

  dispose(): void {
    this.wallParts.length = 0;
    this.actors.clear();
    this.scene = null;
    this.game.destroy(true);
  }
}

export async function loadBattleAssetManifest(signal?: AbortSignal): Promise<AssetManifest> {
  const response = await fetch(asset('battle-assets.json'), { signal: signal ?? null });
  if (!response.ok) throw new Error('战斗素材索引加载失败');
  return await response.json() as AssetManifest;
}

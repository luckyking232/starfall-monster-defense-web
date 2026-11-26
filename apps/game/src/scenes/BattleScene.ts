import type { GameFlow } from '../app/flow';
import { loadBattleContent, type BattleContent, type CardDefinition } from '../content/catalog';
import { getStage } from '../content/stages';
import { RulesClient } from '../engine/client';
import type { RuleChoiceState, RuleState } from '../engine/protocol';
import { createProductionRng } from '../engine/rng';
import { BattleSession, type BattleSnapshot } from '../engine/session';
import type { ProgressStore } from '../platform/progress';
import { Battlefield, loadBattleAssetManifest } from '../presentation/battlefield';
import { BattleUiCatalog, loadBattleUi } from './battle-ui';
import { element } from './dom';

function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

function timeText(frame: number): string {
  const seconds = Math.floor(frame / 30);
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}

export class BattleScene {
  private readonly client = new RulesClient(new URL('assets/runtime-worker.js', document.baseURI));
  private readonly session: BattleSession;
  private readonly screen = element('section', 'screen battle-screen');
  private readonly canvasHost = element('div', 'battle-canvas');
  private readonly hud = element('div', 'battle-hud');
  private readonly intro = element('div', 'battle-intro', '作战开始');
  private readonly abort = new AbortController();
  private renderer: Battlefield | null = null;
  private content: BattleContent | null = null;
  private ui: BattleUiCatalog | null = null;
  private frame = 0;
  private lastTime = 0;
  private introUntil = 0;
  private ticking = false;
  private disposed = false;
  private failed = false;
  private modal: HTMLElement | null = null;
  private modalKey = '';
  private selectedSkill: number | null = null;
  private speedButton: HTMLButtonElement | null = null;
  private pauseButton: HTMLButtonElement | null = null;
  private confirmed = false;
  private visibility = () => {
    this.lastTime = performance.now();
    const transition = document.hidden ? this.session.background() : this.session.foreground();
    void transition.then(() => this.sync(this.session.snapshot)).catch((error: unknown) => this.showError(error));
  };

  constructor(
    private readonly stageId: number,
    private readonly flow: GameFlow,
    private readonly progress: ProgressStore,
    private readonly onExit: () => void,
  ) {
    this.session = new BattleSession(this.client, stageId, () => createProductionRng(stageId));
  }

  render(root: HTMLElement): this {
    this.screen.setAttribute('aria-label', '魔物抵御战战场');
    this.screen.append(this.canvasHost, this.hud);
    const loading = element('div', 'loading-status', '正在进入战斗…');
    this.hud.append(loading);
    root.append(this.screen);
    document.addEventListener('visibilitychange', this.visibility);
    void this.open();
    return this;
  }

  private async open(): Promise<void> {
    try {
      const [content, ui, manifest] = await Promise.all([
        loadBattleContent(this.abort.signal),
        loadBattleUi(this.abort.signal),
        loadBattleAssetManifest(this.abort.signal),
      ]);
      if (this.disposed) return;
      this.content = content;
      this.ui = ui;
      this.renderer = new Battlefield(this.canvasHost, getStage(this.stageId), content, manifest);
      this.buildHud();
      await Promise.all([this.renderer.ready, this.session.start()]);
      if (this.disposed || this.failed) return;
      this.flow.battleReady();
      this.introUntil = performance.now() + 1000;
      this.screen.append(this.intro);
      this.sync(this.session.snapshot);
      this.lastTime = performance.now();
      this.frame = requestAnimationFrame((time) => this.tick(time));
    } catch (error) {
      if (!this.disposed) this.showError(error);
    }
  }

  private async tick(time: number): Promise<void> {
    if (this.disposed || this.failed || this.ticking) return;
    this.ticking = true;
    const elapsed = time - this.lastTime;
    this.lastTime = time;
    try {
      await this.session.advance(elapsed);
      if (this.disposed) return;
      const snapshot = this.session.snapshot;
      if (snapshot.reply) this.renderer?.render(snapshot.reply);
      if (this.intro.isConnected && time >= this.introUntil) this.intro.remove();
      this.sync(snapshot);
    } catch (error) {
      this.showError(error);
    } finally {
      this.ticking = false;
      if (!this.disposed && !this.failed) this.frame = requestAnimationFrame((next) => this.tick(next));
    }
  }

  private buildHud(): void {
    const ui = this.ui!;
    const content = this.content!;
    this.hud.replaceChildren();
    const top = element('div', 'hud-top');
    const navigation = element('div', 'hud-navigation');
    const exit = element('button', 'icon-button', undefined);
    exit.type = 'button';
    exit.setAttribute('aria-label', '退出战斗');
    exit.append(ui.image('退出图标'));
    exit.addEventListener('click', () => this.showExitConfirmation());
    this.pauseButton = element('button', 'icon-button', undefined);
    this.pauseButton.type = 'button';
    this.pauseButton.setAttribute('aria-label', '暂停战斗');
    this.pauseButton.append(ui.image('暂停图标'));
    this.pauseButton.addEventListener('click', () => void this.pause());
    this.speedButton = element('button', 'speed-button', undefined);
    this.speedButton.type = 'button';
    this.speedButton.setAttribute('aria-label', '1倍速');
    this.speedButton.append(ui.image('加速图标'), element('span', undefined, 'x1'));
    this.speedButton.addEventListener('click', () => void this.changeSpeed());
    navigation.append(exit, this.pauseButton, this.speedButton);
    const level = element('div', 'level-progress');
    level.append(element('span', 'level-label', 'Lv.0'));
    const expTrack = element('div', 'exp-track');
    expTrack.append(element('span', 'exp-fill'));
    level.append(expTrack, element('span', 'exp-label', '0/30'));
    const status = element('div', 'battle-status');
    status.append(element('span', 'battle-time', '00:00'), element('span', 'battle-wave', '1-1'));
    top.append(navigation, level, status);
    const kills = element('div', 'kill-counter', '击退：0');
    const wall = element('div', 'wall-status');
    const wallTitle = element('div', 'wall-title');
    wallTitle.append(ui.image('建筑图标'), element('span', undefined, '防御工事'), element('span', 'wall-hp-text', '5000/5000'));
    const wallTrack = element('div', 'wall-track');
    wallTrack.append(ui.image('路障血条'), element('span', 'wall-hp-fill'));
    wall.append(wallTitle, wallTrack);
    const bottom = element('div', 'battle-bottom');
    const damage = element('div', 'damage-panel');
    damage.setAttribute('aria-label', '伤害统计');
    const cards = element('div', 'card-panel');
    for (const card of content.cards.values()) {
      if (card.type !== 1) continue;
      const row = element('div', 'damage-row');
      row.dataset['cardId'] = String(card.id);
      row.append(ui.image(card.head_icon_ui.split(':')[1]!), element('span', 'damage-track'), element('span', 'damage-number', '0'));
      damage.append(row);
      cards.append(this.cardSlot(card));
    }
    bottom.append(damage, cards);
    this.hud.append(top, kills, wall, bottom);
    this.sync(this.session.snapshot);
  }

  private cardSlot(card: CardDefinition): HTMLElement {
    const ui = this.ui!;
    const slot = element('div', 'card-slot');
    slot.setAttribute('aria-label', card.name);
    slot.append(ui.image('人物栏位（已拥有）', 'card-frame'), ui.image(card.head_icon.split(':')[1]!, 'card-portrait'));
    const skills = element('div', 'card-skills');
    for (const id of [card.normal_skill, card.special_skill, card.talent_skill]) {
      const skill = this.content!.skills.get(id ?? 0);
      if (skill) skills.append(ui.image(skill.icon.split(':')[1]!));
    }
    slot.append(skills);
    return slot;
  }

  private sync(snapshot: BattleSnapshot): void {
    if (this.failed || this.disposed || !this.content) return;
    if (snapshot.phase === 'error') {
      this.showError(snapshot.error);
      return;
    }
    if (snapshot.reply) this.updateHud(snapshot.reply.state);
    if (snapshot.phase === 'settled' && snapshot.reply?.state.terminal) {
      this.showSettlement(snapshot.reply.state.terminal.win);
    } else if (snapshot.resumeRequired || snapshot.backgrounded || snapshot.phase === 'paused') {
      if (this.modalKey !== 'exit') this.showPause(snapshot.backgrounded);
    } else if (snapshot.phase === 'choice' && snapshot.reply?.state.choice) {
      if (this.modalKey !== 'exit') this.showChoice(snapshot.reply.state.choice, snapshot.selecting);
    } else if (this.modalKey !== 'exit') {
      this.clearModal();
    }
    const running = snapshot.phase === 'running' && !snapshot.backgrounded;
    if (this.pauseButton) this.pauseButton.disabled = !running;
    if (this.speedButton) this.speedButton.disabled = !running;
  }

  private updateHud(state: RuleState): void {
    const level = state.curLevel ?? 0;
    const exp = state.curExp ?? 0;
    const thresholds = this.content!.stages.get(this.stageId)?.level_time ?? [30];
    const next = thresholds[Math.min(level, thresholds.length - 1)] ?? 30;
    setText(this.hud.querySelector('.level-label')!, `Lv.${level}`);
    setText(this.hud.querySelector('.exp-label')!, `${exp}/${next}`);
    this.hud.querySelector<HTMLElement>('.exp-fill')!.style.width = `${Math.min(100, exp / next * 100)}%`;
    setText(this.hud.querySelector('.battle-time')!, timeText(state.fixedFrame));
    setText(this.hud.querySelector('.battle-wave')!, `${getStage(this.stageId).monsterGroup}-${state.curMonsterWave}`);
    setText(this.hud.querySelector('.kill-counter')!, `击退：${state.killEnemyCount}`);
    const hp = state.selfHp ?? 0;
    const maxHp = state.selfMaxHp ?? 1;
    setText(this.hud.querySelector('.wall-hp-text')!, `${hp}/${maxHp}`);
    this.hud.querySelector<HTMLElement>('.wall-hp-fill')!.style.width = `${Math.max(0, hp / maxHp * 100)}%`;
    let maxDamage = 1;
    for (const card of this.content!.cards.values()) {
      if (card.type === 1) maxDamage = Math.max(maxDamage, this.renderer?.damageTotal(card.id) ?? 0);
    }
    for (const row of this.hud.querySelectorAll<HTMLElement>('.damage-row')) {
      const value = this.renderer?.damageTotal(Number(row.dataset['cardId'])) ?? 0;
      row.querySelector<HTMLElement>('.damage-track')!.style.setProperty('--damage-width', `${value / maxDamage * 100}%`);
      setText(row.querySelector('.damage-number')!, String(Math.round(value)));
    }
  }

  private setModal(key: string, panel: HTMLElement, className: string): void {
    if (this.modalKey === key) return;
    this.clearModal();
    this.modalKey = key;
    const layer = element('div', `modal-layer ${className}`);
    layer.append(panel);
    this.modal = layer;
    this.screen.append(layer);
  }

  private clearModal(): void {
    this.modal?.remove();
    this.modal = null;
    this.modalKey = '';
  }

  private showChoice(choice: RuleChoiceState, selecting: boolean): void {
    const key = `choice:${choice.windowId}:${choice.generation}`;
    if (this.modalKey !== key) {
      this.selectedSkill = null;
      const panel = element('section', 'choice-panel');
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      panel.setAttribute('aria-label', '选择强化');
      panel.append(element('h2', undefined, '选择强化'), element('p', 'choice-help', '选择一项强化，确认后继续战斗'));
      const options = element('div', 'skill-options');
      choice.offerIds.forEach((id, index) => {
        const skill = this.content!.skills.get(id);
        if (!skill) throw new Error(`缺少技能配置：${id}`);
        const button = element('button', 'skill-option');
        button.type = 'button';
        button.dataset['skillId'] = String(id);
        button.setAttribute('aria-label', `${skill.name}：${skill.des}`);
        button.setAttribute('aria-pressed', 'false');
        button.append(this.ui!.image('底框', 'skill-frame'), this.ui!.image(skill.icon.split(':')[1]!, 'skill-icon'));
        button.append(element('h3', undefined, skill.name), element('p', 'skill-description', skill.des.replaceAll('%%', '%')));
        button.addEventListener('click', () => void this.chooseSkill(id, false));
        button.disabled = !choice.visible[index] || !choice.touchable;
        options.append(button);
      });
      const confirm = element('button', 'confirm-skill-button', '确认强化');
      confirm.type = 'button';
      confirm.setAttribute('aria-label', '确认强化');
      confirm.addEventListener('click', () => {
        if (this.selectedSkill !== null) void this.chooseSkill(this.selectedSkill, true);
      });
      panel.append(options, confirm, element('span', 'choice-countdown'));
      this.setModal(key, panel, 'choice-layer');
    }
    const panel = this.modal!.querySelector('.choice-panel')!;
    panel.querySelectorAll<HTMLButtonElement>('.skill-option').forEach((button, index) => {
      const id = Number(button.dataset['skillId']);
      button.disabled = selecting || !choice.touchable || !choice.visible[index];
      button.setAttribute('aria-pressed', String(this.selectedSkill === id));
      button.classList.toggle('selected', this.selectedSkill === id);
    });
    const confirm = panel.querySelector<HTMLButtonElement>('.confirm-skill-button')!;
    confirm.disabled = selecting || this.selectedSkill === null || !choice.touchable;
    setText(panel.querySelector('.choice-countdown')!, `确认选择(${Math.ceil(choice.remainingMs / 1000)}s)`);
  }

  private async chooseSkill(skillId: number, confirm: boolean): Promise<void> {
    try {
      if (!confirm) this.selectedSkill = skillId;
      await this.session.select(skillId, confirm);
      if (!this.disposed) this.sync(this.session.snapshot);
    } catch (error) {
      if (!this.disposed) this.showError(error);
    }
  }

  private async pause(): Promise<void> {
    try {
      await this.session.pause();
      this.sync(this.session.snapshot);
    } catch (error) {
      this.showError(error);
    }
  }

  private showPause(backgrounded: boolean): void {
    const panel = element('section', 'pause-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', '战斗暂停');
    panel.append(this.ui!.image('暂停底板', 'pause-decoration'), element('h2', undefined, '战斗暂停'));
    panel.append(element('p', undefined, backgrounded ? '游戏已暂停，回到页面后请手动继续。' : '点击继续，回到本次战斗。'));
    const resume = element('button', 'primary-button', '继续战斗');
    resume.type = 'button';
    resume.disabled = backgrounded;
    resume.addEventListener('click', () => void this.session.resume().then(() => this.sync(this.session.snapshot)).catch((error: unknown) => this.showError(error)));
    const exit = element('button', 'secondary-button', '退出战斗');
    exit.type = 'button';
    exit.addEventListener('click', () => this.showExitConfirmation());
    panel.append(resume, exit);
    this.setModal('pause', panel, 'pause-layer');
  }

  private showExitConfirmation(): void {
    const panel = element('section', 'confirm-panel');
    panel.setAttribute('role', 'alertdialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', '退出确认');
    panel.append(element('h2', undefined, '退出战斗'), element('p', undefined, '确定要退出本次战斗吗？'));
    panel.append(element('p', 'confirm-note', '未完成的战斗不会保存。'));
    const actions = element('div', 'modal-actions');
    const cancel = element('button', 'secondary-button', '取消');
    cancel.type = 'button';
    cancel.addEventListener('click', () => {
      this.clearModal();
      this.sync(this.session.snapshot);
    });
    const confirm = element('button', 'primary-button', '确认退出');
    confirm.type = 'button';
    confirm.addEventListener('click', () => this.leave());
    actions.append(cancel, confirm);
    panel.append(actions);
    this.setModal('exit', panel, 'confirm-layer');
  }

  private showSettlement(win: boolean): void {
    const terminal = this.session.snapshot.reply!.state.terminal!;
    const panel = element('section', 'settlement-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', '战斗结算');
    panel.append(this.ui!.image('结束面板', 'settlement-background'));
    panel.append(element('h2', undefined, win ? '胜利' : '失败'), element('p', 'settlement-label', '战斗结束'));
    const result = element('div', 'settlement-result');
    result.append(element('span', undefined, `本次波数 ${terminal.curMonsterWave}`), element('span', undefined, `本次击杀 ${terminal.killEnemyCount}`));
    const confirm = element('button', 'primary-button', '确定');
    confirm.type = 'button';
    confirm.setAttribute('aria-label', '确认结算');
    confirm.addEventListener('click', () => {
      if (this.confirmed) return;
      this.confirmed = true;
      if (win) this.progress.commitClear(this.stageId);
      this.leave();
    });
    panel.append(result, confirm);
    this.setModal('settlement', panel, 'settlement-layer');
  }

  private async changeSpeed(): Promise<void> {
    if (this.session.snapshot.phase !== 'running' || this.session.snapshot.backgrounded) return;
    const speed = this.session.snapshot.reply?.state.speedIndex === 2 ? 1 : 2;
    try {
      await this.session.speed(speed);
      if (this.speedButton) {
        this.speedButton.setAttribute('aria-label', `${speed}倍速`);
        setText(this.speedButton.querySelector('span')!, `x${speed}`);
      }
    } catch (error) {
      this.showError(error);
    }
  }

  private showError(error: unknown): void {
    if (this.disposed || this.failed) return;
    this.failed = true;
    console.error('Battle failed', error);
    cancelAnimationFrame(this.frame);
    this.abort.abort();
    const panel = element('section', 'fatal-panel');
    panel.setAttribute('role', 'alert');
    panel.append(element('h2', undefined, '战斗暂时无法继续'));
    panel.append(element('p', undefined, error instanceof Error && error.message.startsWith('缺少') ? '部分原版资源尚未准备好，请返回选关后重试。' : '加载或运行出现异常，请返回选关后重试。'));
    const exit = element('button', 'primary-button', '返回选关');
    exit.type = 'button';
    exit.addEventListener('click', () => this.leave());
    panel.append(exit);
    this.setModal('error', panel, 'confirm-layer');
  }

  private leave(): void {
    if (this.disposed) return;
    this.dispose();
    this.onExit();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.abort.abort();
    document.removeEventListener('visibilitychange', this.visibility);
    this.renderer?.dispose();
    this.renderer = null;
    void this.session.close().catch(() => this.client.dispose());
  }
}

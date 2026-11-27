import type { UiLevelUpResult, UiStressLoadoutReport } from '../../runtime/ui/protocol';
import { ProgressStore } from '../platform/progress';
import { isTestSite } from '../platform/channel';
import { editSaveIndex, exportSaves, importSaves, MAX_BACKUP_BYTES } from '../platform/save-transfer';
import { readPreferences, savePreferences, type Preferences } from '../platform/preferences';
import { createFullscreenButton } from '../platform/fullscreen';
import { renderStressDetails } from './stress-report';
import { STRESS_STAGE, stressMonsterTarget } from '../content/stress-stage';
import { RULES_FPS } from '../engine/protocol';
import type { StressRunSummary } from '../presentation/stress-session';
import { element } from '../scenes/dom';
import '../styles/web-settings.css';

interface WebControls {
  applyVolume(music: number, effects: number): void;
  applyEconomy(enabled: boolean): void;
  getFps(): number;
  battleFrameTime(): {fps:number; p95:number; slow:number} | null;
  inBattle(): boolean;
  canLevel(): boolean;
  levelUp(): Promise<UiLevelUpResult>;
  canStartStress(): boolean;
  startStress(renderer: 'canvas' | 'webgl'): Promise<void>;
  canFinishStress(): boolean;
  finishStress(): Promise<void>;
  stressSummary(): StressRunSummary | null;
  stressLoadout(): UiStressLoadoutReport | null;
  modalChanged(open: boolean): void;
}

function button(title: string, action: () => void): HTMLButtonElement {
  const control = element('button', undefined, title);
  control.type = 'button';
  control.onclick = action;
  return control;
}

export class WebSettings {
  private readonly launcher = button('⚙', () => this.showSettings());
  private readonly fps = element('span', 'web-fps');
  private readonly backdrop = element('div', 'web-backdrop');
  private readonly panel = element('div', 'web-panel');
  private readonly body = element('div', 'web-body');
  private readonly feedback = element('p', 'web-feedback');
  private readonly prefs: Preferences;
  private readonly fullscreen: HTMLButtonElement | null;
  private fpsTimer = 0;
  private selected = '';
  private readonly slotId: string;
  private previousFocus: HTMLElement | null = null;
  private stressRenderer: 'canvas' | 'webgl' = new URLSearchParams(location.search).get('world') === 'webgl' ? 'webgl' : 'canvas';
  private startingStress = false;

  constructor(root: HTMLElement, private readonly storage: Storage | null, private readonly progress: ProgressStore,
    private readonly controls: WebControls) {
    this.slotId = progress.listSlots().activeSlotId;
    this.prefs = readPreferences(storage);
    this.fullscreen = createFullscreenButton(root.ownerDocument, message => { this.feedback.textContent = message; });
    this.launcher.className = 'web-gear';
    this.launcher.title = '网页设置';
    this.launcher.setAttribute('aria-label', '网页设置');
    this.launcher.setAttribute('aria-haspopup', 'dialog');
    this.backdrop.hidden = true;
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-modal', 'true');
    this.panel.setAttribute('aria-labelledby', 'web-title');
    this.feedback.setAttribute('aria-live', 'polite');
    this.backdrop.append(this.panel);
    this.backdrop.onclick = event => { if (event.target === this.backdrop) this.close(); };
    this.panel.onkeydown = event => {
      if (event.key === 'Escape') { event.preventDefault(); this.close(); }
      if (event.key !== 'Tab') return;
      const list = [...this.panel.querySelectorAll<HTMLElement>('button:enabled, input:enabled, select:enabled')];
      const first = list[0], last = list.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    root.append(this.fps, this.launcher);
    root.ownerDocument.body.append(this.backdrop);
    this.controls.applyVolume(this.prefs.music, this.prefs.effects);
    this.controls.applyEconomy(this.prefs.economy);
    this.updateFps();
  }

  private open(title: string): void {
    if (this.backdrop.hidden) {
      this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      this.controls.modalChanged(true);
    }
    this.backdrop.hidden = false;
    this.launcher.hidden = true;
    const head = element('header');
    const heading = element('h2', undefined, title);
    heading.id = 'web-title';
    const close = button('关闭', () => this.close());
    head.append(heading, close);
    this.body.replaceChildren();
    this.feedback.textContent = '';
    this.panel.replaceChildren(head, this.body, this.feedback);
    close.focus({preventScroll:true});
  }

  private close(): void {
    if (this.backdrop.hidden) return;
    this.backdrop.hidden = true;
    this.launcher.hidden = false;
    this.controls.modalChanged(false);
    (this.previousFocus?.isConnected && this.previousFocus !== document.body ? this.previousFocus : this.launcher).focus({preventScroll:true});
  }

  private showSettings(tab = 0): void {
    this.open(isTestSite() ? '网页设置 · 测试版' : '网页设置');
    const nav = element('nav');
    nav.setAttribute('aria-label','设置分类');
    const tabs = [['设置', () => this.preferences()], ['存档', () => this.saves()], ['调试', () => this.debug()], ['压测', () => this.stress()]] as const;
    const activate = (index: number) => {
      for (const [i, item] of [...nav.children].entries()) item.setAttribute('aria-pressed', String(i === index));
      this.feedback.textContent = '';
      this.body.replaceChildren();
      tabs[index]![1]();
    };
    tabs.forEach(([title], index) => nav.append(button(title, () => activate(index))));
    this.panel.insertBefore(nav, this.body);
    activate(tab);
  }

  private stress(): void {
    this.body.append(element('h3',undefined,'全技能怪海压测'));
    const summary = this.controls.stressSummary();
    if (this.controls.canStartStress()) {
      this.body.append(element('p','web-meta','五名角色开场解锁全部技能，每人分配 27 次强化。达到词条上限的次数转给本角色其他可升级词条。'));
      const tierSeconds = STRESS_STAGE.tierFrames / RULES_FPS;
      this.body.append(element('p','web-meta',`开场 ${STRESS_STAGE.initialSpeed}×。在场活怪目标每 ${tierSeconds} 个游戏秒由 ${STRESS_STAGE.initialMonsters} 升至 ${stressMonsterTarget(STRESS_STAGE.tierFrames)}、${STRESS_STAGE.maxMonsters}，持续补怪。城墙可恢复，全程免选卡，压测成绩单独统计。`));
      const row = element('label','web-stress-backend');
      const select = element('select');
      select.setAttribute('aria-label','压测渲染方式');
      for (const [value,text] of [['canvas','Canvas（默认）'],['webgl','合并 WebGL（实验）']] as const) {
        const option = element('option',undefined,text);
        option.value = value;
        select.append(option);
      }
      select.value = this.stressRenderer;
      select.onchange = () => { this.stressRenderer = select.value === 'webgl' ? 'webgl' : 'canvas'; };
      row.append('渲染方式 ',select);
      const start = button('开始怪海压测',async () => {
        if (this.startingStress || !this.controls.canStartStress()) return;
        this.startingStress = true;
        start.disabled = true;
        this.close();
        try { await this.controls.startStress(this.stressRenderer); }
        catch (error) {
          this.showSettings(3);
          this.feedback.textContent = error instanceof Error ? error.message : String(error);
        } finally { this.startingStress = false; }
      });
      const actions = element('div','web-actions');
      actions.append(start);
      this.body.append(row,actions);
    } else if (this.controls.canFinishStress()) {
      const finish = button('结束压测',async () => {
        finish.disabled = true;
        try {
          await this.controls.finishStress();
          this.showSettings(3);
        } catch (error) {
          this.feedback.textContent = error instanceof Error ? error.message : String(error);
          finish.disabled = false;
        }
      });
      this.body.append(finish);
    } else if (!summary) {
      this.body.append(element('p','web-meta','回到活动主页或选关界面后可开始压测。'));
    }
    if (!summary) return;
    const loadout = this.controls.stressLoadout();
    if (loadout) this.body.append(this.stressBuild(loadout));
    this.body.append(element('h3',undefined,this.controls.canFinishStress() ? '本次采样' : '上次采样'));
    const details = renderStressDetails(summary);
    this.body.append(details,button('复制压测结果',async () => {
      const preset = loadout ? `${loadout.cards.length} 名角色 · ${loadout.upgrades} 次强化` : '';
      const revision = document.querySelector<HTMLMetaElement>('meta[name="game-build"]')?.content;
      const report = [`全技能怪海压测 · 活怪目标 ${STRESS_STAGE.maxMonsters}`, revision && `构建 ${revision}`,
        preset, navigator.userAgent, details.innerText].filter(Boolean).join('\n');
      try {
        await navigator.clipboard.writeText(report);
        this.feedback.textContent = '压测结果已复制';
      } catch {
        const text = element('textarea');
        text.value = report;
        text.readOnly = true;
        text.setAttribute('aria-label','压测结果文本');
        this.feedback.replaceChildren(text);
        text.select();
      }
    }));
  }

  private stressBuild(report: UiStressLoadoutReport): HTMLDetailsElement {
    const details = element('details');
    details.className = 'web-stress-build';
    const skills = report.cards.reduce((n,card)=>n+card.skills.filter(skill=>skill.unlocked).length,0);
    details.append(element('summary',undefined,`实际配置 · ${skills} 项技能 · ${report.upgrades} 次强化`));
    const names: Record<number,string> = {78000101:'安妮斯',78000102:'蒂娜',78000103:'尼莉莎',78000104:'菲尼斯',78000105:'列蒂西雅'};
    const table = element('table');
    const head = table.createTHead().insertRow();
    for (const title of ['角色','普攻','特殊','天赋']) head.append(element('th',undefined,title));
    const body = table.createTBody();
    for (const card of report.cards) {
      const row = body.insertRow();
      row.append(element('th',undefined,names[card.id] ?? String(card.id)));
      for (const skill of card.skills) row.insertCell().textContent = skill.options.map(option=>option.level).join(' / ');
    }
    details.append(table);
    return details;
  }

  private persist(): void {
    if (!savePreferences(this.storage, this.prefs)) this.feedback.textContent = '浏览器无法保存设置，本页内仍会生效。';
  }

  private updateFps(): void {
    window.clearInterval(this.fpsTimer);
    this.fps.hidden = !this.prefs.fps;
    if (!this.prefs.fps) return;
    const paint = () => {
      const sample = this.controls.battleFrameTime();
      if (sample) {
        this.fps.textContent = `战场 ${sample.fps} FPS · P95 ${sample.p95} ms · >100 ms ${sample.slow} 帧`;
      } else {
        const fps = Math.round(this.controls.getFps());
        this.fps.textContent = fps > 0 ? '界面 ' + fps + ' FPS' : '… FPS';
      }
    };
    paint();
    this.fpsTimer = window.setInterval(paint, 600);
  }

  private preferences(): void {
    for (const [key, title] of [['effects','音效音量'],['music','音乐音量']] as const) {
      const label = element('label','web-volume');
      const slider = element('input');
      slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.value = String(this.prefs[key]);
      slider.setAttribute('aria-label',title);
      const value = element('span', undefined, slider.value + '%');
      slider.oninput = () => {
        this.prefs[key] = slider.valueAsNumber;
        value.textContent = slider.value + '%';
        this.controls.applyVolume(this.prefs.music, this.prefs.effects);
        this.persist();
      };
      label.append(element('span',undefined,title), slider, value);
      this.body.append(label);
    }
    const row = element('label','web-check');
    const toggle = element('input');
    toggle.type = 'checkbox'; toggle.checked = this.prefs.fps;
    toggle.onchange = () => { this.prefs.fps = toggle.checked; this.updateFps(); this.persist(); };
    row.append(toggle, '显示帧率');
    this.body.append(row);
    const quality = element('label','web-check');
    const economy = element('input');
    economy.type = 'checkbox';
    economy.checked = this.prefs.economy;
    economy.onchange = () => {
      this.prefs.economy = economy.checked;
      this.controls.applyEconomy(economy.checked);
      this.persist();
    };
    quality.append(economy,'省电画质（降低战场分辨率）');
    this.body.append(quality);
    if (this.fullscreen) {
      const actions = element('div','web-actions');
      actions.append(this.fullscreen);
      this.body.append(actions);
    }
  }

  private saves(): void {
    const state = this.progress.listSlots();
    const snap = this.progress.load(this.slotId);
    const current = state.slots.find(slot => slot.id === this.slotId);
    if (!current) {
      this.body.replaceChildren(element('p','web-meta','本页存档已从另一个标签页删除。'),
        button('打开现用存档',() => location.reload()));
      return;
    }
    if (!state.slots.some(slot => slot.id === this.selected)) this.selected = current.id;
    const inBattle = this.controls.inBattle();
    const visibleNames = inBattle ? current.name : state.slots.map(slot => slot.name).join(' ');
    // Request the faces matching visible names without depending on layout of a native select.
    void this.body.ownerDocument.fonts.load('16px SourceHanSans', visibleNames).catch(() => {});
    const passed = snap.clearedStageIds.length + snap.assistedStageIds.length;
    this.body.replaceChildren(element('p', 'web-current', '当前存档 · ' + current.name),
      element('p', 'web-meta', '已通关 ' + passed + ' 关'));
    if (snap.assistedStageIds.length) this.body.append(element('p', 'web-meta', '其中 ' + snap.assistedStageIds.length + ' 关为辅助通关'));
    if (snap.allUnlocked) this.body.append(element('p', 'web-meta', '已启用全解锁'));
    if (!state.persistent || state.unreadable || snap.unreadable) this.body.append(element('p','web-meta','浏览器存储不可用或有记录无法读取。'));
    if (inBattle) {
      this.body.append(element('p','web-meta','返回活动主页或选关后可以管理存档。'));
      return;
    }
    const select = element('select');
    select.setAttribute('aria-label','选择存档');
    for (const slot of state.slots) {
      const option = element('option',undefined,slot.name);
      option.value = slot.id; select.append(option);
    }
    select.value = this.selected;
    const name = element('input');
    name.type = 'text'; name.maxLength = 40; name.placeholder = '新档名或新名称'; name.setAttribute('aria-label','存档名称');
    const attempt = async (action: () => void) => {
      try { await editSaveIndex(action); } catch (error) { this.feedback.textContent = error instanceof Error ? error.message : String(error); }
    };
    const actions = element('div', 'web-actions');
    const change = button('切换存档', () => attempt(() => { this.progress.switchSlot(select.value); location.reload(); }));
    const del = button('删除存档', () => {
      const target = state.slots.find(slot => slot.id === select.value)!;
      const confirm = button('确认删除', () => attempt(() => {
        this.progress.deleteSlot(target.id);
        if (target.id === current.id) location.reload();
        else { this.selected = current.id; this.feedback.textContent = '存档已删除'; this.saves(); }
      }));
      const prompt = '永久删除「' + target.name + '」的本地进度？' + (state.slots.length === 1 ? '删除后将启用一个空白存档。' : '');
      this.body.replaceChildren(element('p',undefined,prompt), confirm, button('取消',() => this.saves()));
      this.body.lastElementChild?.scrollIntoView({block:'nearest'});
      (this.body.lastElementChild as HTMLButtonElement).focus();
    });
    const updateSelection = () => {
      this.selected = select.value;
      name.value = '';
      change.disabled = select.value === current.id;

    };
    select.onchange = updateSelection;
    updateSelection();
    let serial = 1;
    while (state.slots.some(slot => slot.name === '存档 ' + serial)) serial++;
    actions.append(button('新建并切换', () => attempt(() => {
      this.progress.createSlot(name.value.trim() || '存档 ' + serial);
      location.reload();
    })),
      change, button('重命名', () => attempt(() => { this.progress.renameSlot(select.value,name.value); this.saves(); })), del);
    this.body.append(select,name,actions);
    const download = (store: ProgressStore) => {
      const url = URL.createObjectURL(new Blob([exportSaves(store)], {type:'application/json'}));
      const anchor = element('a');
      anchor.href = url;
      anchor.download = '魔物抵御战-本地存档.json';
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url),30000);
    };
    const file = element('input');
    file.type = 'file';
    file.accept = '.json,application/json';
    file.hidden = true;
    file.onchange = async () => {
      try {
        const chosen = file.files?.[0];
        if (!chosen) return;
        if (!this.storage || chosen.size > MAX_BACKUP_BYTES) throw new Error('无法导入，请选择 1 MB 以内的备份。');
        const json = await chosen.text();
        const destination = this.storage;
        await editSaveIndex(() => importSaves(destination,json));
        location.reload();
      } catch (error) {
        this.feedback.textContent = error instanceof Error ? error.message : String(error);
        file.value = '';
      }
    };
    const transfer = element('div','web-actions');
    transfer.append(button('导出全部存档',() => attempt(() => download(this.progress))),
      button('导入到新存档',() => file.click()),file);
    this.body.append(transfer);
    if (isTestSite()) {
      this.body.append(element('p','web-meta','这里是测试站。旧版 Pages 存档可导出，再到 fallstar.online 导入。'),
        button('导出旧版 Pages 存档',() => attempt(() => download(new ProgressStore(window.localStorage)))));
    }
  }

  private debug(): void {
    const code = element('input');
    code.placeholder = 'ALLSTAGES / LEVELUP'; code.setAttribute('aria-label','调试码');
    let levelUpPending = false;
    const run = async (raw: string) => {
      try {
        switch (raw.trim().toUpperCase()) {
          case 'ALLSTAGES': case '全解锁':
            if (this.controls.inBattle()) { this.feedback.textContent = '返回选关或主页后可全解锁当前存档。'; return; }
            this.progress.unlockAll(this.slotId);
            await editSaveIndex(() => {
              if (this.progress.listSlots().activeSlotId !== this.slotId) this.progress.switchSlot(this.slotId);
            });
            location.reload(); return;
          case 'LEVELUP': case '升一级': {
            if (levelUpPending) return;
            if (!this.controls.canLevel()) { this.feedback.textContent = '请在战斗进行中使用。'; return; }
            levelUpPending = true;
            try {
              const result = await this.controls.levelUp();
              if (code.isConnected && !this.backdrop.hidden) {
                if (result.applied) this.close();
                else this.feedback.textContent = result.text;
              }
            } finally {
              levelUpPending = false;
            }
            return;
          }
          default: this.feedback.textContent = '未识别的调试码';
        }
      } catch (error) { this.feedback.textContent = error instanceof Error ? error.message : String(error); }
    };
    code.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); void run(code.value); } };
    const actions = element('div','web-actions');
    actions.append(button('全解锁',() => void run('ALLSTAGES')),button('升一级',() => void run('LEVELUP')));
    this.body.append(code,button('执行',() => void run(code.value)), element('p','web-meta','ALLSTAGES 开放当前档的关卡与随关角色。LEVELUP 在战斗中升一级，普通关胜利后记为辅助通关，无尽成绩计入练习纪录。'),actions);
  }

  souvenir(kind: 'gift' | 'task' | 'return'): void {
    if (kind === 'return') {
      this.open('城外的路牌');
      const note = element('p','web-letter','城门外立着一块木牌，上面画了一支指向远方的箭。');
      const flip = button('翻到背面', () => {
        note.textContent = '背面也画着一支箭，正好指回营地。木牌底下压着一行小字：「晚饭给你留着呢。」';
        flip.replaceWith(button('回营', () => this.close()));
        this.body.querySelector('button')?.focus();
      });
      this.body.append(note, flip);
      return;
    }
    this.open(kind === 'gift' ? '前线补给箱' : '今天由你守夜');
    if (kind === 'gift') {
      const notes = ['箱盖上画着一块巨石。翻到背面，小字写着「这面朝敌」。','一只纸折的小蝙蝠飞了出来，绕营地一圈，又落回你的手心。','箱底只剩一张借条：「补给拿去垫城墙了，守住就还。」'];
      let i = Math.floor(Math.random() * notes.length);
      const note = element('p','web-letter','铜扣松开了一半，箱子里传出窸窸窣窣的声音。');
      const draw = button('打开补给箱',() => { note.textContent = notes[i]!; i = (i+1) % notes.length; draw.textContent = '再翻一层'; });
      this.body.append(note,draw);
    } else {
      let bells = 0;
      const note = element('p','web-letter','城楼上留着一面小铜锣。守夜人交代，连敲三下就有人应声。');
      const replies = ['咚。远处亮起一盏灯。','咚。城墙另一头也亮了。','咚！两短一长的锣声从营地传回来。今晚有人和你一起守。'];
      const ring = button('敲锣',() => { note.textContent = replies[bells++]!; if (bells === replies.length) { ring.textContent = '已交班'; ring.disabled = true; } });
      this.body.append(note,ring);
    }
  }
}

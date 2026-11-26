import type { GameFlow } from '../app/flow';
import { STAGES, type StageDefinition } from '../content/stages';
import { background, element } from './dom';

const TOP_ROW_X = [50, 430, 810, 1190, 1570, 1950, 2330, 2710, 3090, 3470];
const BOTTOM_ROW_X = [240, 620, 1000, 1380, 1760, 2140, 2520, 2900, 3280, 3660];
const MAP_WIDTH = 4180;

export class StageSelectScene {
  constructor(private readonly flow: GameFlow, private readonly onChange: () => void) {}

  private stageButton(stage: StageDefinition, index: number): HTMLButtonElement {
    const unlocked = this.flow.snapshot.unlockedStageIds.includes(stage.id);
    const special = stage.endless === true;
    const topRow = index % 2 === 0;
    const x = special ? 3942 : topRow ? TOP_ROW_X[Math.floor(index / 2)]! : BOTTOM_ROW_X[Math.floor(index / 2)]!;
    const y = special ? 303 : topRow ? 212 : 362;
    const width = special ? 132 : 190;
    const height = special ? 130 : 164;
    const button = element('button', `stage-button${special ? ' special' : ''}${topRow ? ' top-row' : ' bottom-row'}`);
    button.type = 'button';
    button.disabled = !unlocked;
    button.setAttribute('aria-label', `第${index + 1}关`);
    if (!unlocked) button.title = '尚未解锁';
    button.style.left = `${(x / MAP_WIDTH) * 100}%`;
    button.style.top = `${(y / 750) * 100}%`;
    button.style.width = `${(width / MAP_WIDTH) * 100}%`;
    button.style.height = `${(height / 750) * 100}%`;

    const art = element('img', 'stage-art');
    const family = special ? (unlocked ? 'infinite' : 'infinite-lock') : unlocked ? 'unlocked' : 'locked';
    const row = special ? '' : topRow ? '-top' : '-bottom';
    art.src = `assets/ui/stage-${family}${row}.png`;
    art.alt = '';
    art.draggable = false;

    const label = element('span', 'stage-label', special ? '无限' : `第${index + 1}关`);
    button.append(art, label);
    if (!unlocked) {
      const lock = element('img', 'stage-lock-icon');
      lock.src = 'assets/ui/stage-lock.png';
      lock.alt = '';
      lock.draggable = false;
      button.append(lock);
    }
    if (unlocked) button.addEventListener('click', () => {
      this.flow.selectStage(stage.id);
      this.onChange();
    });
    return button;
  }

  render(root: HTMLElement): void {
    const snapshot = this.flow.snapshot;
    const screen = element('section', 'screen stage-select-screen');
    screen.setAttribute('aria-label', '选择关卡');
    screen.append(background('ui/home-background.png'));

    const scroll = element('div', 'stage-scroll');
    scroll.setAttribute('aria-label', '关卡地图，可横向滚动');
    const map = element('div', 'stage-map');
    STAGES.forEach((stage, index) => map.append(this.stageButton(stage, index)));
    scroll.append(map);

    if (!snapshot.progressPersistent || snapshot.progressUnreadable) {
      const notice = element('p', 'progress-notice', snapshot.progressUnreadable
        ? '部分本地记录无法读取，已保留可验证的进度。'
        : '当前无法持久保存，通关记录仅保留在本次会话。');
      screen.append(notice);
    }
    screen.append(scroll);
    root.append(screen);
  }
}

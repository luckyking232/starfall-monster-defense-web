import { getStage } from '../content/stages';
import { background, element } from './dom';

export class StageLoadingScene {
  constructor(private readonly stageId: number) {}

  render(root: HTMLElement): void {
    const stage = getStage(this.stageId);
    const screen = element('section', 'screen stage-loading-screen');
    screen.setAttribute('aria-label', `第${stage.monsterGroup}关加载中`);
    screen.append(background(`maps/${stage.map}.png`));
    const status = element('div', 'loading-status');
    status.append(element('span', 'loading-indicator'), element('span', undefined, '正在进入战斗…'));
    screen.append(status);
    root.append(screen);
  }
}

import type { GameFlow } from '../app/flow';
import { background, element } from './dom';

export class HomeScene {
  constructor(private readonly flow: GameFlow, private readonly onChange: () => void) {}

  render(root: HTMLElement): void {
    const screen = element('section', 'screen home-screen');
    screen.setAttribute('aria-label', '魔物抵御战开始页');
    screen.append(background('ui/home-background.png'));

    const title = element('h1', 'home-title', '魔物抵御战');
    const actions = element('div', 'home-actions');
    const start = element('button', 'primary-button', '开始');
    start.type = 'button';
    start.addEventListener('click', () => {
      this.flow.startGame();
      this.onChange();
    });
    actions.append(start);
    screen.append(title, actions);
    root.append(screen);
  }
}

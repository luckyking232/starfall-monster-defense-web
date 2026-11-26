import { failStartup, showStartup } from './app/startup';

showStartup(1, '正在载入游戏程序');
void import('./main').then(({ startGame }) => startGame()).catch(failStartup);

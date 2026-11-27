import { failStartup, showStartup } from './app/startup';
import { isTestSite } from './platform/channel';

if (isTestSite()) {
  document.title = '魔物抵御战 · 测试版';
  const title = document.getElementById('startup-title');
  if (title) title.textContent = document.title;
}

showStartup(1, '正在载入游戏程序');
void import('./main').then(({ startGame }) => startGame()).catch(failStartup);

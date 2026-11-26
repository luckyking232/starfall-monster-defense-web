import { ACTIVITY_START_STAMP, getStage } from './content/stages';
import { ProgressStore } from './platform/progress';
import { installViewportTracking } from './platform/viewport';
import { NativeBattlefield } from './presentation/native-world';
import { BattleAudio } from './presentation/battle-audio';
import { LoadingEffect } from './presentation/loading-effect';
import { OriginalUiClient } from './ui/client';
import { OriginalUiWindow } from './ui/original-window';
import { element } from './scenes/dom';
import { WebSettings } from './ui/web-settings';
import { BattleWait } from './ui/battle-wait';
import type { UiEvent } from '../runtime/ui/protocol';
import { showStartup, finishStartup, failStartup } from './app/startup';
import './styles/main.css';

const names: Record<string,string> = {
  Activity17MiniGame2MainWindow: '魔物抵御战活动主页',
  Activity17MiniGameChoice2Window: '选择关卡',
  MiniGameBattleUIWindow: '魔物抵御战战场',
  MiniGameSkillChoiceWindow: '选择强化',
  MiniGameBattlePauseWindow: '战斗暂停',
  MiniGameBattleExitWindow: '确认退出战斗',
  MiniGameBattleEndWindow: '战斗结算',
  BattleLoadingWindow: '战斗加载中',
};

async function bootstrap(root: HTMLElement): Promise<void> {
  root.className = 'game-frame';
  installViewportTracking();
  showStartup(3,'正在读取资源目录');
  const worldLayer = element('div','screen');
  const uiLayer = element('section','screen');
  const notice = element('output','game-notice');
  notice.setAttribute('role','status');
  root.replaceChildren(worldLayer,uiLayer,notice);
  let storage = null;
  try { storage = window.localStorage; } catch { /* Private browsing can disable storage. */ }
  const progress = new ProgressStore(storage);
  const client = new OriginalUiClient(undefined,progress);
  const audio = new BattleAudio();
  const battleWait = new BattleWait();
  root.append(battleWait.root);
  worldLayer.hidden = true;
  let world: NativeBattlefield | null = null;
  let generation = 0;
  let running = false;
  let entering = false;
  let musicSkipped = false;
  let queuedMusic: Extract<UiEvent,{name:'audio-play'}> | undefined;
  let modalOpen = false;
  let scheduled = 0;
  let clockEpoch = 0;
  let last = 0;
  let noticeTimer = 0;
  let stopped = false;
  let activeKey = '';
  let waitingForWorld: Promise<void> = Promise.resolve();
  let waitingForCurtain: Promise<void> = Promise.resolve();
  function prepareWorld(): Promise<void> {
    const prepared = world ??= new NativeBattlefield(worldLayer);
    return prepared.ready.catch(error => {
      if (world === prepared) {
        prepared.dispose();
        world = null;
      }
      throw error;
    });
  }

  function prefetchBattle(): void {
    // A failed speculative request is retried by the foreground loading screen.
    void Promise.allSettled([
      Promise.resolve().then(() => loading.prepare()),
      Promise.resolve().then(prepareWorld),
      Promise.resolve().then(() => audio.prepareMusic()),
    ]);
  }
  function fail(reason: unknown): void {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(scheduled);
    battleWait.close();
    world?.dispose();
    loading.dispose();
    audio.dispose();
    void view.dispose().catch(() => {});
    if (document.getElementById('startup')) { failStartup(reason); return; }
    const panel = element('section','fatal-panel');
    const retry = element('button','primary-button','重新加载');
    retry.onclick = () => location.reload();
    panel.setAttribute('role','alert');
    panel.append(element('h1',undefined,'游戏加载失败'),element('p',undefined,reason instanceof Error ? reason.message : String(reason)),retry);
    root.replaceChildren(panel);
  }
  function syncLayers(): void {
    const windows = [...view.runtime.views];
    const previousKey = activeKey;
    activeKey = view.runtime.topWindow ?? '';
    const loadingVisible = view.runtime.views.has('BattleLoadingWindow');
    loading.show(loadingVisible);
    battleWait.nativeVisible(loadingVisible);
    if (running && loadingVisible) battleWait.close();
    if (activeKey === 'Activity17MiniGameChoice2Window' && previousKey !== activeKey) prefetchBattle();
    const fighting = windows.some(([key]) => key.startsWith('MiniGameBattle') || key === 'MiniGameSkillChoiceWindow');
    const currentMenu = windows.filter(([key]) => key.startsWith('Activity')).at(-1)?.[0];
    for (const [key,window] of windows) {
      window.root.container.visible = key.startsWith('Activity') ? !fighting && key === currentMenu : true;
    }
    if (activeKey) uiLayer.setAttribute('aria-label',names[activeKey] ?? activeKey);
    else uiLayer.removeAttribute('aria-label');
  }
  async function tick(now: number): Promise<void> {
    if (!running || stopped || document.hidden || modalOpen) return;
    const epoch = clockEpoch;
    const elapsed = Math.min(250,Math.max(0,now-last));
    last = now;
    try {
      await client.tick(elapsed);
      await view.idle();
      if (running && epoch === clockEpoch && !document.hidden && !modalOpen && !stopped) scheduled = requestAnimationFrame(tick);
    } catch (error) { fail(error); }
  }
  const view = new OriginalUiWindow(uiLayer,client,(event) => {
    if (event.name === 'audio-play' && event.kind === 'bgm' && entering && !running) queuedMusic = event;
    else if (!(event.name === 'audio-play' && event.kind === 'bgm' && musicSkipped)) audio.handle(event);
    if (event.name === 'souvenir') {
      settings.souvenir(event.kind);
    } else if (event.name === 'warn-tips' || event.name === 'progress-save-failed') {
      notice.textContent = event.name === 'warn-tips' ? event.text : '本次通关已生效，但浏览器未能保存进度。';
      clearTimeout(noticeTimer);
      noticeTimer = window.setTimeout(() => { notice.textContent = ''; },2200);
    } else if (event.name === 'start-battle') {
      root.ownerDocument.body.dataset['map'] = getStage(event.stageId).map;
      const id = ++generation;
      notice.textContent = '';
      entering = true;
      musicSkipped = false;
      queuedMusic = undefined;
      battleWait.open();
      waitingForCurtain = battleWait.prepare({label:'过场画面',prepare:() => loading.prepare()});
      waitingForWorld = Promise.all([
        waitingForCurtain,
        battleWait.prepare({label:'战场画面',prepare:prepareWorld}),
        battleWait.prepare({label:'战斗音乐',prepare:() => audio.prepareMusic(),skip:() => { musicSkipped = true; }}),
      ]).then(() => {
        if (id !== generation || stopped) return;
        worldLayer.hidden = false;
        running = true;
        if (queuedMusic && !musicSkipped) audio.handle(queuedMusic);
        queuedMusic = undefined;
        if (view.runtime.views.has('BattleLoadingWindow')) battleWait.close();
        last = performance.now();
        if (!document.hidden && !modalOpen) scheduled = requestAnimationFrame(tick);
      }).catch(fail);
    } else if (event.name === 'world') {
      view.setTransitionTimeScale(event.state.paused ? 0 : event.state.speedIndex ?? 1);
      world?.render(event.state);
    } else if (event.name === 'battle-close') {
      delete root.ownerDocument.body.dataset['map'];
      ++generation;
      ++clockEpoch;
      running = false;
      entering = false;
      queuedMusic = undefined;
      musicSkipped = false;
      battleWait.close();
      cancelAnimationFrame(scheduled);
      worldLayer.hidden = true;
      world?.reset();
      audio.clear();
    }
  },fail,async (key) => {
    if (key === 'BattleLoadingWindow') await waitingForCurtain;
    if (key === 'MiniGameBattleUIWindow') await waitingForWorld;
  }, fraction => showStartup(75 + fraction * 24, '正在装配界面图集'));
  const loading = new LoadingEffect(
    () => view.runtime.views.get('BattleLoadingWindow')?.root.children.get('EffectAni')?.container.alpha ?? 0,
    () => modalOpen || document.hidden);
  root.insertBefore(loading.canvas,notice);
  const settings = new WebSettings(root,storage,progress,{
    applyVolume: (music,effects) => audio.setVolumes(music,effects),
    getFps: () => view.runtime.renderFps,
    inBattle: () => entering || activeKey === 'BattleLoadingWindow',
    canLevel: () => running && activeKey === 'MiniGameBattleUIWindow',
    levelUp: () => client.levelUp(),
    modalChanged(open) {
      modalOpen = open;
      uiLayer.inert = open;
      worldLayer.inert = open;
      clockEpoch++;
      cancelAnimationFrame(scheduled);
      view.setPaused(open || document.hidden);
      if (!open && running && !document.hidden && !stopped) {
        last = performance.now();
        scheduled = requestAnimationFrame(tick);
      }
    },
  });
  // The original Lua opens BattleLoadingWindow in UILayer.Loading, above the HUD.
  view.runtime.setWindowLayer('BattleLoadingWindow', 1);
  client.onMessage((message) => {
    if (message.type === 'startup') showStartup(message.percent,message.phase);
    if (message.type !== 'open' && message.type !== 'close') return;
    void view.idle().then(syncLayers).catch(fail);
  });
  document.addEventListener('visibilitychange',() => {
    if (stopped) return;
    clockEpoch++;
    view.setPaused(document.hidden || modalOpen);
    cancelAnimationFrame(scheduled);
    if (!running) return;
    if (document.hidden) { void client.background().catch(fail); return; }
    if (modalOpen) return;
    last = performance.now();
    scheduled = requestAnimationFrame(tick);
  });
  await view.init({gameplay:true,activityStartStamp:ACTIVITY_START_STAMP,serverNowStamp:Math.floor(Date.now()/1000)}).catch(fail);
  await waitingForWorld;
  if (!stopped) finishStartup();
}
export async function startGame(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) throw new Error('Missing #app');
  await bootstrap(root);
}

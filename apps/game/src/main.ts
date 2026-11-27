import { ACTIVITY_START_STAMP, getStage, isStageUnlocked, STAGES } from './content/stages';
import { ProgressStore } from './platform/progress';
import { scopedStorage } from './platform/channel';
import { installViewportTracking } from './platform/viewport';
import { NativeBattlefield } from './presentation/native-world';
import { WorldFrameTime } from './presentation/world-frame-time';
import { StressSession } from './presentation/stress-session';
import { StressReport } from './ui/stress-report';
import type { RuleState } from './engine/protocol';
import { BattleAudio } from './presentation/battle-audio';
import { LoadingEffect } from './presentation/loading-effect';
import { OriginalUiClient } from './ui/client';
import { OriginalUiWindow } from './ui/original-window';
import { element } from './scenes/dom';
import { WebSettings } from './ui/web-settings';
import { BattleWait } from './ui/battle-wait';
import { EndlessRecordView } from './ui/endless-record-view';
import type { UiEvent, UiStressLoadoutReport } from '../runtime/ui/protocol';
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

const loadingWindow = [['Loading', 'BattleLoadingWindow']] as const;
const battleWindows = [
  ['ActivityDungeon1017Battle', 'BattleUIWindow'],
  ['ActivityDungeon1017Battle', 'SkillChoiceWindow'],
] as const;

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
  try { storage = scopedStorage(window.localStorage); } catch { /* Private browsing can disable storage. */ }
  const progress = new ProgressStore(storage);
  const progressSlotId = progress.listSlots().activeSlotId;
  const client = new OriginalUiClient(undefined,progress);
  const audio = new BattleAudio();
  const frameTime = new WorldFrameTime();
  const stress = new StressSession();
  const stressReport = new StressReport(root);
  let stressRenderer: 'webgl' | 'canvas' = 'canvas';
  let loadout: UiStressLoadoutReport | null = null;
  const battleWait = new BattleWait();
  const endlessRecords = new EndlessRecordView(root);
  root.append(battleWait.root);
  worldLayer.hidden = true;
  let world: NativeBattlefield | null = null;
  const normalRenderer = new URLSearchParams(location.search).get('world') === 'webgl' ? 'webgl' : 'canvas';
  let worldRenderer = normalRenderer;
  let economy = false;
  let generation = 0;
  let running = false;
  let entering = false;
  let musicSkipped = false;
  let queuedMusic: Extract<UiEvent,{name:'audio-play'}> | undefined;
  let modalOpen = false;
  let scheduled = 0;
  let worldFrame = 0;
  let pendingWorld: RuleState | undefined;
  let clockEpoch = 0;
  let last = 0;
  let noticeTimer = 0;
  let stopped = false;
  let activeKey = '';
  let waitingForWorld: Promise<void> = Promise.resolve();
  let waitingForCurtain: Promise<void> = Promise.resolve();
  function prepareWorld(stageId: number): Promise<void> {
    const preparedGeneration = generation;
    const renderer = stress.metrics ? stressRenderer : normalRenderer;
    if (world && worldRenderer !== renderer) {
      world.dispose();
      world = null;
    }
    worldRenderer = renderer;
    const prepared = world ??= new NativeBattlefield(worldLayer,renderer === 'webgl');
    prepared.setEconomy(economy);
    return prepared.prepareStage(stageId).catch(error => {
      if (world === prepared && generation === preparedGeneration) {
        prepared.dispose();
        world = null;
      }
      throw error;
    });
  }

  async function prepareCurtain(): Promise<void> {
    await Promise.all([loading.prepare(), view.runtime.prepareWindows(loadingWindow)]);
  }

  function prefetchBattle(): void {
    // A failed speculative request is retried by the foreground loading screen.
    const save = progress.load(progressSlotId);
    const completed = [...save.clearedStageIds, ...save.assistedStageIds];
    const next = STAGES.find(stage => stage.endless || !completed.includes(stage.id))!;
    const previous = STAGES.find(stage => stage.id === next.pre);
    const suggested = save.allUnlocked || isStageUnlocked(next, completed, Date.now() / 1000) ? next : previous;
    void Promise.allSettled([
      Promise.resolve().then(prepareCurtain),
      suggested ? NativeBattlefield.prefetch(suggested.id) : undefined,
      Promise.resolve().then(() => view.runtime.prepareWindows(battleWindows)),
      Promise.resolve().then(() => audio.prepareMusic()),
    ]);
  }
  function fail(reason: unknown): void {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(scheduled);
    cancelAnimationFrame(worldFrame);
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
    if (stress.metrics && activeKey !== 'MiniGameBattleUIWindow') {
      stress.interrupt(performance.now());
      stressReport.setLive(false);
    }
    syncEndlessRecords();
  }
  function syncEndlessRecords(): void {
    endlessRecords.sync(view.runtime, () => client.endlessRecords());
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
  function scheduleWorldFrame(): void {
    if (worldFrame || !pendingWorld || !running || stopped || document.hidden || modalOpen) return;
    worldFrame = requestAnimationFrame(() => {
      worldFrame = 0;
      const state = pendingWorld;
      pendingWorld = undefined;
      if (!state || !running || stopped || document.hidden || modalOpen) return;
      try {
        world?.render(state);
        if (state.paused) frameTime.reset();
        else frameTime.rendered(performance.now());
        if (stress.metrics) {
          if (state.paused || state.fixedFrame <= 0 || activeKey !== 'MiniGameBattleUIWindow') {
            stress.interrupt(performance.now());
            stressReport.setLive(false);
          } else {
            const canvas = worldLayer.firstElementChild as HTMLCanvasElement | null;
            if (canvas) {
              const now = performance.now();
              stress.rendered(now,state,{renderer:canvas.dataset['renderer'] ?? 'canvas',
                width:canvas.width,height:canvas.height,speed:state.speedIndex ?? 1});
              stressReport.setLive(true);
              stressReport.frame(now,stress.metrics);
            }
          }
        }
      }
      catch (error) { fail(error); }
    });
  }
  function stopWorldFrame(): void {
    frameTime.reset();
    if (stress.metrics) {
      stress.interrupt(performance.now());
      stressReport.setLive(false);
    }
    cancelAnimationFrame(worldFrame);
    worldFrame = 0;
  }
  const view = new OriginalUiWindow(uiLayer,client,(event) => {
    if (event.name === 'audio-play' && event.kind === 'bgm' && entering && !running) queuedMusic = event;
    else if (!(event.name === 'audio-play' && event.kind === 'bgm' && musicSkipped)) audio.handle(event);
    if (event.name === 'souvenir') {
      settings.souvenir(event.kind);
    } else if (event.name === 'stress-loadout') {
      loadout = event.report;
    } else if (event.name === 'endless-record') {
      endlessRecords.setResult(event);
      syncEndlessRecords();
    } else if (event.name === 'endless-record-change') {
      syncEndlessRecords();
    } else if (event.name === 'warn-tips' || event.name === 'progress-save-failed') {
      notice.textContent = event.name === 'warn-tips' ? event.text :
        event.endless ? '浏览器未能保存本次无尽纪录。' : '本次通关已生效，但浏览器未能保存进度。';
      clearTimeout(noticeTimer);
      noticeTimer = window.setTimeout(() => { notice.textContent = ''; },2200);
    } else if (event.name === 'start-battle') {
      if (event.stress) {
        loadout = null;
        stress.begin();
        stressReport.reset();
        root.dataset['stressActive'] = 'true';
      }
      endlessRecords.setResult(undefined);
      root.ownerDocument.body.dataset['map'] = getStage(event.stageId).map;
      const id = ++generation;
      notice.textContent = '';
      entering = true;
      musicSkipped = false;
      queuedMusic = undefined;
      battleWait.open();
      waitingForCurtain = battleWait.prepare({label:'过场画面',prepare:prepareCurtain});
      waitingForWorld = Promise.all([
        waitingForCurtain,
        battleWait.prepare({label:'战场画面',prepare:() => prepareWorld(event.stageId)}),
        battleWait.prepare({label:'战斗界面',prepare:() => view.runtime.prepareWindows(battleWindows)}),
        battleWait.prepare({label:'战斗音乐',prepare:() => audio.prepareMusic(),skip:() => { musicSkipped = true; }}),
      ]).then(() => {
        if (id !== generation || stopped) return;
        worldLayer.hidden = false;
        running = true;
        if (queuedMusic && !musicSkipped) audio.handle(queuedMusic);
        queuedMusic = undefined;
        if (view.runtime.views.has('BattleLoadingWindow')) battleWait.close();
        last = performance.now();
        scheduleWorldFrame();
        if (!document.hidden && !modalOpen) scheduled = requestAnimationFrame(tick);
      }).catch(fail);
    } else if (event.name === 'world') {
      view.setTransitionTimeScale(event.state.paused ? 0 : event.state.speedIndex ?? 1);
      pendingWorld = event.state;
      scheduleWorldFrame();
    } else if (event.name === 'battle-close') {
      const finishedStress = stress.metrics !== null;
      if (finishedStress) {
        stress.end(performance.now());
        stressReport.setLive(false);
        delete root.dataset['stressActive'];
        notice.textContent = '压测已结束，可在网页设置的「压测」中查看结果。';
        clearTimeout(noticeTimer);
        noticeTimer = window.setTimeout(() => { notice.textContent = ''; },3500);
      }
      endlessRecords.setResult(undefined);
      delete root.ownerDocument.body.dataset['map'];
      ++generation;
      ++clockEpoch;
      running = false;
      entering = false;
      queuedMusic = undefined;
      musicSkipped = false;
      battleWait.close();
      cancelAnimationFrame(scheduled);
      stopWorldFrame();
      pendingWorld = undefined;
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
    applyEconomy: enabled => { economy = enabled; world?.setEconomy(enabled); },
    getFps: () => view.runtime.renderFps,
    battleFrameTime: () => running ? frameTime.summary() : null,
    inBattle: () => entering || activeKey === 'BattleLoadingWindow',
    canLevel: () => !stress.metrics && running && activeKey === 'MiniGameBattleUIWindow',
    levelUp: () => client.levelUp(),
    canStartStress: () => !entering && !stopped &&
      (activeKey === 'Activity17MiniGame2MainWindow' || activeKey === 'Activity17MiniGameChoice2Window'),
    startStress: renderer => {
      stressRenderer = renderer;
      return client.startStress();
    },
    canFinishStress: () => stress.metrics !== null && running && !stopped &&
      ['MiniGameBattleUIWindow','MiniGameBattlePauseWindow','MiniGameBattleExitWindow'].includes(activeKey),
    finishStress: async () => {
      await client.finishStress();
      await view.idle();
      syncLayers();
    },
    stressLoadout: () => loadout,
    stressSummary: () => stress.summary(),
    modalChanged(open) {
      modalOpen = open;
      uiLayer.inert = open;
      worldLayer.inert = open;
      clockEpoch++;
      cancelAnimationFrame(scheduled);
      stopWorldFrame();
      view.setPaused(open || document.hidden);
      if (!open && running && !document.hidden && !stopped) {
        last = performance.now();
        scheduleWorldFrame();
        scheduled = requestAnimationFrame(tick);
      }
    },
  });
  // The original Lua opens BattleLoadingWindow in UILayer.Loading, above the HUD.
  view.runtime.setWindowLayer('BattleLoadingWindow', 1);
  client.onMessage((message) => {
    if (stress.metrics && running && !document.hidden && !modalOpen && activeKey === 'MiniGameBattleUIWindow' && message.type === 'ops') {
      stress.observe(message.ops);
    }
    if (message.type === 'startup') showStartup(message.percent,message.phase);
    if (message.type === 'ops' && activeKey === 'Activity17MiniGameChoice2Window' &&
        message.ops.some(op => op.op === 'list-items')) void view.idle().then(syncEndlessRecords).catch(fail);
    if (message.type !== 'open' && message.type !== 'close') return;
    void view.idle().then(syncLayers).catch(fail);
  });
  document.addEventListener('visibilitychange',() => {
    if (stopped) return;
    clockEpoch++;
    view.setPaused(document.hidden || modalOpen);
    cancelAnimationFrame(scheduled);
    stopWorldFrame();
    if (!running) return;
    if (document.hidden) { void client.background().catch(fail); return; }
    if (modalOpen) return;
    last = performance.now();
    scheduleWorldFrame();
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

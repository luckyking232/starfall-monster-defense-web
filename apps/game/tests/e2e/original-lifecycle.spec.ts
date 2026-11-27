import { expect, test, type Page } from '@playwright/test';
import type { UiClientRequest, UiHostMessage } from '../../runtime/ui/protocol';
import { openChooser, originalClick } from './navigation';

interface BattleObservation {
  loadingId?: number;
  outStarted: boolean;
  loadingClosed: boolean;
  shieldPointer?: { outStarted: boolean; loadingClosed: boolean };
  clicks: number;
  tickRequests: number;
  backgroundRequests: number;
  frame: number;
  paused: boolean;
}

async function observeBattle(page: Page, holdLoadingOut: boolean): Promise<void> {
  await page.addInitScript((holdOutCompletion) => {
    const state: BattleObservation = {
      outStarted: false, loadingClosed: false, clicks: 0, tickRequests: 0, backgroundRequests: 0, frame: 0, paused: false,
    };
    let outWorker: Worker | undefined;
    let outPlayId: number | undefined;
    let pendingOutCompletion: (() => void) | undefined;
    let releaseOutCompletion = !holdOutCompletion;
    Object.assign(window, {
      originalBattleObservation: state,
      releaseOriginalLoadingOut: () => {
        releaseOutCompletion = true;
        const forward = pendingOutCompletion;
        pendingOutCompletion = undefined;
        forward?.();
      },
    });
    document.addEventListener('pointerup', (event) => {
      if (event.isTrusted && state.outStarted && !releaseOutCompletion) {
        state.shieldPointer = { outStarted: state.outStarted, loadingClosed: state.loadingClosed };
      }
    }, { capture: true });
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('message', ({ data }: MessageEvent<UiHostMessage>) => {
          if (data.type === 'open' && data.window === 'BattleLoadingWindow') state.loadingId = data.rootId;
          if (data.type === 'close' && data.window === 'BattleLoadingWindow') state.loadingClosed = true;
          if (data.type === 'ops') {
            const playback = data.ops.find((op) => op.op === 'transition-play' && op.id === state.loadingId && op.name === 'out1');
            if (playback?.op === 'transition-play') {
              state.outStarted = true;
              outWorker = this;
              outPlayId = playback.playId;
            }
          }
          if (data.type === 'event' && data.event.name === 'world') {
            state.frame = data.event.state.fixedFrame;
            state.paused = data.event.state.paused === true;
          }
        });
      }

      override postMessage(message: UiClientRequest, options?: StructuredSerializeOptions | Transferable[]): void {
        if (message.type === 'click') state.clicks++;
        if (message.type === 'presentation' && message.signal.kind === 'tick') state.tickRequests++;
        if (message.type === 'presentation' && message.signal.kind === 'background') state.backgroundRequests++;
        // Let FGUI play the authored transition. Hold its final acknowledgement
        // until the trusted click has hit the loading window's input shield.
        if (!releaseOutCompletion && this === outWorker && message.type === 'presentation' &&
            message.signal.kind === 'transition' && message.signal.playId === outPlayId && message.signal.label === undefined) {
          pendingOutCompletion = () => super.postMessage(message, options as StructuredSerializeOptions);
          return;
        }
        super.postMessage(message, options as StructuredSerializeOptions);
      }
    };
  }, holdLoadingOut);
}

async function observed(page: Page): Promise<BattleObservation> {
  return page.evaluate(() => (window as Window & { originalBattleObservation?: BattleObservation }).originalBattleObservation!);
}

async function openFirstBattle(page: Page, holdLoadingOut = false): Promise<void> {
  await observeBattle(page, holdLoadingOut);
  await page.goto('./');
  await openChooser(page);
  await originalClick(page, 145, 274);
}

test('the real Loading out1 stays above the HUD and shields its input until it closes', async ({ page }) => {
  test.setTimeout(60000);
  await openFirstBattle(page, true);
  await expect.poll(async () => (await observed(page)).outStarted, { intervals: [50], timeout: 30000 }).toBe(true);
  await expect(page.getByRole('region', { name: '战斗加载中' })).toBeVisible();
  const clicks = (await observed(page)).clicks;
  try {
    await originalClick(page, 163, 47);
    expect(await observed(page)).toMatchObject({
      clicks, loadingClosed: false, shieldPointer: { outStarted: true, loadingClosed: false },
    });
  } finally {
    await page.evaluate(() => (window as Window & { releaseOriginalLoadingOut?: () => void }).releaseOriginalLoadingOut!());
  }
  await expect.poll(async () => (await observed(page)).loadingClosed).toBe(true);
  await expect(page.getByRole('region', { name: '魔物抵御战战场' })).toBeVisible();
  await expect.poll(async () => (await observed(page)).frame).toBeGreaterThan(0);
  await originalClick(page, 163, 47);
  await expect(page.getByRole('region', { name: '战斗暂停' })).toBeVisible();
});

test('visibilitychange handler opens the original pause and prevents catch-up frames', async ({ page }) => {
  test.setTimeout(60000);
  await openFirstBattle(page);
  await expect.poll(async () => (await observed(page)).frame, { timeout: 30000 }).toBeGreaterThan(0);

  // Headless Edge keeps document.visibilityState visible even after a second tab is raised.
  // Exercise the browser event handler by injecting only the visibility reading.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByRole('region', { name: '战斗暂停' })).toBeVisible();
  const paused = await observed(page);
  expect(paused.backgroundRequests).toBe(1);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect((await observed(page)).tickRequests).toBe(paused.tickRequests);

  await page.evaluate(() => {
    Reflect.deleteProperty(document, 'hidden');
    Reflect.deleteProperty(document, 'visibilityState');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(async () => (await observed(page)).tickRequests).toBeGreaterThan(paused.tickRequests + 1);
  const foreground = await observed(page);
  expect(foreground.paused).toBe(true);
  expect(foreground.frame).toBe(paused.frame);
  await originalClick(page, 660, 380);
  await expect(page.getByRole('region', { name: '魔物抵御战战场' })).toBeVisible();
  await expect.poll(async () => (await observed(page)).frame).toBeGreaterThan(foreground.frame);
});

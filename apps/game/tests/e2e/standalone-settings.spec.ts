import { expect, test } from '@playwright/test';
import type { UiClientRequest, UiHostMessage } from '../../runtime/ui/protocol';
import { originalClick, openChooser } from './navigation';

test('网页设置记住音量和帧率，新旧档独立并能删除', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('./');
  const settings = page.getByRole('button', { name: '网页设置' });
  await settings.click();
  const effects = page.getByRole('slider', { name: '音效音量' });
  await expect(effects).toHaveValue('100');
  await page.screenshot({path:test.info().outputPath('settings.png')});
  await effects.focus();
  await effects.press('Home');
  for (let i=0;i<22;i++) await effects.press('ArrowRight');
  await page.getByLabel('显示帧率').check();
  await page.getByRole('button', {name:'关闭',exact:true}).click();
  await expect(page.locator('.web-fps')).toHaveText(/\d+ FPS/);
  await page.reload();
  await settings.click();
  await expect(effects).toHaveValue('22');
  await page.getByRole('button',{name:'存档',exact:true}).click();
  await page.getByLabel('存档名称').fill('测试营地');
  await page.getByRole('button',{name:'新建并切换'}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await settings.click();
  await page.getByRole('button',{name:'调试',exact:true}).click();
  await page.getByRole('button',{name:'全解锁',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await settings.click();
  await page.getByRole('button',{name:'存档',exact:true}).click();
  await expect(page.getByText('已启用全解锁')).toBeVisible();
  await page.getByLabel('存档名称').fill('夜巡');
  await page.getByRole('button',{name:'重命名'}).click();
  await expect(page.getByText('当前存档 · 夜巡')).toBeVisible();
  await page.getByLabel('选择存档').selectOption({label:'默认存档'});
  await page.getByRole('button',{name:'切换存档'}).click();
  await settings.click();
  await page.getByRole('button',{name:'存档',exact:true}).click();
  await expect(page.getByText('当前存档 · 默认存档')).toBeVisible();
  await page.getByLabel('选择存档').selectOption({label:'夜巡'});
  await page.getByRole('button',{name:'切换存档'}).click();
  await settings.click();
  await page.getByRole('button',{name:'存档',exact:true}).click();
  await expect(page.getByText('已启用全解锁')).toBeVisible();
  await page.getByRole('button',{name:'删除存档'}).click();
  await page.getByRole('button',{name:'确认删除'}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await settings.click();
  await page.getByRole('button',{name:'存档',exact:true}).click();
  await expect(page.getByText('已启用全解锁')).toHaveCount(0);
});

test.describe('竖屏网页设置', () => {
  test.use({ viewport:{width:360,height:640}, hasTouch:true, isMobile:true });
  test('触摸齿轮可以管理存档并返回选关', async ({page}) => {
    await page.goto('./');
    await openChooser(page,'touch');
    await page.getByRole('button',{name:'网页设置'}).tap();
    await page.getByRole('button',{name:'存档',exact:true}).tap();
    await expect(page.getByRole('button',{name:'新建并切换'})).toBeInViewport();
    await page.screenshot({path:test.info().outputPath('portrait-slots.png')});
    await page.getByRole('button',{name:'关闭',exact:true}).tap();
    await expect(page.getByRole('region',{name:'选择关卡'})).toBeVisible();
  });
});

test('原主页礼包和参与任务按钮打开不同彩蛋', async ({page}) => {
  await page.goto('./');
  await expect(page.getByRole('region',{name:'魔物抵御战活动主页'})).toBeVisible();
  await originalClick(page,45,679);
  await expect(page.getByRole('dialog',{name:'前线补给箱'})).toBeVisible();
  await page.getByRole('button',{name:'打开补给箱'}).click();
  await expect(page.getByRole('button',{name:'再翻一层'})).toBeVisible();
  await page.getByRole('button',{name:'关闭'}).click();
  await originalClick(page,435,680);
  const ring = page.getByRole('button',{name:'敲锣'});
  for (let i=0;i<3;i++) await ring.click();
  await expect(page.getByRole('button',{name:'已交班'})).toBeDisabled();
});

interface LevelupObservation {
  frame: number;
  paused: boolean;
  choices: number;
  releaseIntro?: () => void;
}

test('战斗调试开场及暂停时保留提示，开始推进后升一级进入原版选卡', async ({ page }) => {
  test.setTimeout(90000);
  await page.addInitScript(() => {
    const state: LevelupObservation = { frame: 0, paused: false, choices: 0 };
    Object.assign(window, { levelupObservation: state });
    const NativeWorker = window.Worker;
    let introTransition: number | undefined;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('message', ({ data }: MessageEvent<UiHostMessage>) => {
          if (data.type === 'ops') {
            const intro = data.ops.find(op => op.op === 'transition-play' && op.name === 'up');
            if (intro?.op === 'transition-play') introTransition = intro.playId;
          }
          if (data.type === 'event' && data.event.name === 'world') {
            state.frame = data.event.state.fixedFrame;
            state.paused = data.event.state.paused === true;
          }
          if (data.type === 'open' && data.window === 'MiniGameSkillChoiceWindow') state.choices++;
        });
      }

      override postMessage(message: UiClientRequest, options?: StructuredSerializeOptions | Transferable[]): void {
        const signal = message.type === 'presentation' ? message.signal : undefined;
        if (signal?.kind === 'transition' && signal.playId === introTransition && signal.label === undefined) {
          // Hold the real HUD entrance callback while settings is used at rule frame zero.
          state.releaseIntro = () => super.postMessage(message, options as StructuredSerializeOptions);
          return;
        }
        super.postMessage(message, options as StructuredSerializeOptions);
      }
    };
  });
  const observed = () => page.evaluate(() => {
    const { frame, paused, choices, releaseIntro } = (window as Window & { levelupObservation?: LevelupObservation }).levelupObservation!;
    return { frame, paused, choices, introHeld: Boolean(releaseIntro) };
  });
  const hud = page.getByRole('region', { name: '魔物抵御战战场' });
  const choice = page.getByRole('region', { name: '选择强化' });
  const dialog = page.getByRole('dialog');
  const debugLevel = async () => {
    await page.getByRole('button', { name: '网页设置' }).click();
    await page.getByRole('button', { name: '调试', exact: true }).click();
    await page.getByLabel('调试码').fill('levelup');
    await page.getByRole('button', { name: '执行' }).click();
  };
  const expectBlocked = async () => {
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('请在战斗进行中使用')).toBeVisible();
    await expect(choice).toHaveCount(0);
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  };

  await page.goto('./');
  await openChooser(page);
  await originalClick(page, 145, 274);
  await expect(hud).toBeVisible({ timeout: 30000 });
  await expect.poll(observed, { timeout: 15000 }).toMatchObject({ introHeld: true, frame: 0 });
  await debugLevel();
  await expectBlocked();
  await page.evaluate(() => (window as Window & { levelupObservation?: LevelupObservation }).levelupObservation!.releaseIntro!());
  await expect.poll(async () => {
    const state = await observed();
    return state.paused ? 0 : state.frame;
  }, { timeout: 15000 }).toBeGreaterThan(0);
  expect((await observed()).choices).toBe(0);

  await originalClick(page, 163, 47);
  await expect(page.getByRole('region', { name: '战斗暂停' })).toBeVisible();
  await expect.poll(async () => (await observed()).paused).toBe(true);
  await debugLevel();
  await expectBlocked();
  const pausedFrame = (await observed()).frame;
  await originalClick(page, 660, 380);
  await expect(hud).toBeVisible();
  await expect.poll(async () => {
    const state = await observed();
    return state.paused ? pausedFrame : state.frame;
  }, { timeout: 15000 }).toBeGreaterThan(pausedFrame);
  expect((await observed()).choices).toBe(0);

  await debugLevel();
  await expect(dialog).toHaveCount(0);
  await expect(choice).toBeVisible({ timeout: 15000 });
  expect((await observed()).choices).toBe(1);
});

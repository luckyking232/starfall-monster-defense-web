import {test,expect} from '@playwright/test';
import {openChooser,originalClick} from './navigation';

test.use({hasTouch:true});

for (const input of ['mouse', 'touch'] as const) {
  test.describe(`synthetic ${input} input`, () => {
    test.use({ hasTouch: input === 'touch' });
    test('uses the configured canvas input even when maxTouchPoints disagrees', async ({ page }) => {
      await page.setContent('<main id="app"><canvas width="400" height="225"></canvas></main>');
      await page.evaluate((device) => {
        Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: device === 'mouse' ? 2 : 0 });
        const canvas = document.querySelector('canvas')!;
        canvas.addEventListener('pointerup', (event) => { canvas.dataset['pointer'] = event.pointerType; });
      }, input);
      if (input === 'mouse') await originalClick(page, 667, 375);
      else await originalClick(page, 667, 375, input);
      await expect(page.locator('canvas')).toHaveAttribute('data-pointer', input);
    });
  });
}

for(const viewport of [{width:390,height:844},{width:360,height:640}]){
  test('portrait device frame opens and plays with real taps '+viewport.width,async({page})=>{
    test.setTimeout(60000);
    await page.setViewportSize(viewport);
    await page.goto('./');
    await openChooser(page, 'touch');
    await originalClick(page,525,274,'touch');
    await expect(page.getByRole('status')).toHaveText('前置关卡未通过');
    await originalClick(page,145,274,'touch');
    await expect(page.getByRole('region',{name:'魔物抵御战战场'})).toBeVisible({timeout:20000});
    await expect(async()=>{
      await originalClick(page,163,47,'touch');
      await expect(page.getByRole('region',{name:'战斗暂停'})).toBeVisible({timeout:750});
    }).toPass({timeout:15000});
    await page.screenshot({path:test.info().outputPath('portrait-pause.png')});
  });
}

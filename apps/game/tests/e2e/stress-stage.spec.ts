import {expect,test} from '@playwright/test';
import type {UiClientRequest,UiHostMessage} from '../../runtime/ui/protocol';
import {openChooser,originalClick} from './navigation';

test('从空档设置进入全技能怪海，报告最慢时段并保留原存档',async({page},info)=>{
  test.setTimeout(120000);
  await page.addInitScript(()=>{
    const seen={starts:0,frame:0,opponents:0,heroes:[] as number[],choiceWindows:0,clicks:0};
    Object.assign(window,{stressObservation:seen});
    const Base=window.Worker;
    window.Worker=class extends Base {
      override postMessage(message:UiClientRequest,options?:StructuredSerializeOptions|Transferable[]) {
        if(message.type==='click') seen.clicks++;
        super.postMessage(message,options as StructuredSerializeOptions);
      }
      constructor(url:string|URL,options?:WorkerOptions){
        super(url,options);
        this.addEventListener('message',({data}:MessageEvent<UiHostMessage>)=>{
          if(data.type==='event' && data.event.name==='start-battle') { seen.starts++; seen.frame=0; }
          if(data.type==='open' && data.window==='MiniGameSkillChoiceWindow') seen.choiceWindows++;
          if(data.type==='event' && data.event.name==='world'){
            const s=data.event.state;
            seen.frame=s.fixedFrame;
            seen.opponents=Math.max(seen.opponents,s.units.filter(u=>u.camp===2).length);
            seen.heroes=[...new Set(s.units.filter(u=>u.cardId>=78000101&&u.cardId<=78000105).map(u=>u.cardId))];
          }
        });
      }
    };
  });
  const observation=()=>page.evaluate(()=>(window as Window & {stressObservation?:{starts:number;frame:number;opponents:number;heroes:number[];choiceWindows:number;clicks:number}}).stressObservation!);
  async function pressHudOnce(x:number,expectedWindow:string) {
    const before=(await observation()).clicks;
    // An input before the authored transition is ready may be ignored. Once sent, let
    // the busy worker handle it. A second tap on the original pause screen resumes play.
    await expect(async()=>{
      if((await observation()).clicks===before) await originalClick(page,x,47);
      expect((await observation()).clicks).toBeGreaterThan(before);
    }).toPass({timeout:15000});
    await expect(page.getByRole('region',{name:expectedWindow})).toBeVisible({timeout:25000});
    expect((await observation()).clicks).toBe(before+1);
  }
  const openTab=async()=>{
    await page.getByRole('button',{name:'网页设置'}).click();
    await page.getByRole('button',{name:'压测',exact:true}).click();
  };
  const saveKeys=()=>page.evaluate(()=>Object.keys(localStorage).filter(k=>k.includes('progress')).sort().map(k=>[k,localStorage.getItem(k)]));
  await page.goto('./');
  await expect(page.getByRole('region',{name:'魔物抵御战活动主页'})).toBeVisible({timeout:45000});
  await expect(page.locator('#startup')).toHaveCount(0);
  const before=await saveKeys();
  await openTab();
  await page.getByRole('button',{name:'开始怪海压测'}).click();
  await expect(page.getByRole('region',{name:'魔物抵御战战场'})).toBeVisible({timeout:45000});
  await expect.poll(async()=>(await observation()).opponents,{timeout:25000}).toBeGreaterThanOrEqual(60);
  await expect.poll(async()=>(await observation()).frame,{timeout:20000}).toBeGreaterThan(125);
  expect((await observation()).heroes).toHaveLength(5);
  await pressHudOnce(163,'战斗暂停');
  await openTab();
  await expect(page.getByRole('dialog')).toContainText('P99');
  const report = page.getByRole('region',{name:'压测统计'});
  await expect(report.getByText('最差一秒',{exact:true}).locator('..').locator('dd')).toHaveText(/^\d+ FPS$/);
  await expect(report.getByText('帧间隔 P99',{exact:true}).locator('..').locator('dd')).toHaveText(/\d+\.\d ms/);
  const simulated = await report.getByText('游戏时间推进',{exact:true}).locator('..').locator('dd').innerText();
  expect(parseFloat(simulated)).toBeGreaterThan(0);
  await expect(page.getByText('实际配置 · 15 项技能 · 135 次强化')).toBeVisible();
  await page.getByText('实际配置 · 15 项技能 · 135 次强化').click();
  await expect(page.getByRole('cell',{name:'16 / 2 / 1'})).toHaveCount(5);
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{
    configurable:true,value:{writeText:async(value:string)=>{document.documentElement.dataset['copiedReport']=value;}},
  }));
  await page.getByRole('button',{name:'复制压测结果'}).click();
  const copied=await page.locator('html').getAttribute('data-copied-report');
  expect(copied).toContain('游戏时间推进');
  expect(copied).toContain(simulated);
  expect(copied).toContain(await page.locator('meta[name="game-build"]').getAttribute('content'));
  await page.screenshot({path:info.outputPath('stress-report.png')});
  await page.getByRole('button',{name:'结束压测',exact:true}).click();
  await expect(page.getByRole('button',{name:'开始怪海压测'})).toBeEnabled();
  await expect(page.getByRole('dialog')).toContainText('上次采样');
  expect(await saveKeys()).toEqual(before);
  await page.getByRole('button',{name:'关闭',exact:true}).click();
  await openChooser(page);
  await openTab();
  await page.getByLabel('压测渲染方式').selectOption('webgl');
  await page.getByRole('button',{name:'开始怪海压测'}).click();
  await expect(page.getByRole('region',{name:'魔物抵御战战场'})).toBeVisible({timeout:45000});
  await expect.poll(async()=>(await observation()).frame,{timeout:20000}).toBeGreaterThan(100);
  const surface = page.locator('canvas[aria-label="战场画面"]');
  const renderer = await surface.getAttribute('data-renderer');
  expect(['canvas','webgl']).toContain(renderer);
  await openTab();
  await expect(report).toContainText(renderer === 'webgl' ? 'WebGL' : 'Canvas');
  await expect(report.getByText('最差一秒',{exact:true}).locator('..').locator('dd')).toHaveText(/^\d+ FPS$/);
  await page.getByRole('button',{name:'关闭',exact:true}).click();
  await pressHudOnce(79,'确认退出战斗');
  await originalClick(page,977,575);
  await expect(page.getByRole('region',{name:'选择关卡',exact:true})).toBeVisible({timeout:15000});
  await openTab();
  await expect(page.getByRole('button',{name:'开始怪海压测'})).toBeEnabled();
  await expect(page.getByRole('dialog')).toContainText('P99');
  expect((await observation()).choiceWindows).toBe(0);
  expect((await observation()).starts).toBe(2);
  expect(await saveKeys()).toEqual(before);
});

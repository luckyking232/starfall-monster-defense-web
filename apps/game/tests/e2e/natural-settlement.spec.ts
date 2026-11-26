import { test,expect } from '@playwright/test';
import { openChooser,originalClick } from './navigation';
import type { UiHostMessage } from '../../runtime/ui/protocol';

const routes = [
  { stage: 1, startY: 274, nextY: 444, frame: 4181, kills: 205, picks: [0,0,0,1,0,1,1,1,1,1,1] },
  { stage: 2, startY: 444, nextY: 294, frame: 3693, kills: 183, picks: Array<number>(11).fill(0) },
];

for (const routeConfig of routes) test(`stage ${routeConfig.stage} victory saves and opens stage ${routeConfig.stage + 1} from the original chooser`,async({page, context})=>{
  test.skip(process.env['STARFALL_PLAYER_RUN']!=='1','Long foreground player run');
  test.setTimeout(420000);
  // Match the winning original-rule replay in ui-host.test.ts. Only RNG is fixed.
  const originalSeed = "  math.randomseed(__HostCall('rng.seed'),args.stageId)\n  originalInit(args)";
  await page.route('**/assets/ui-host-worker.js', async (route) => {
    const response = await route.fetch();
    const source = await response.text();
    expect(source).toContain(originalSeed);
    const stageOneSeed = `
  math.randomseed(70441022,args.stageId)
  local random, draws=math.random,0
  math.random=function(a,b)
    if draws<50 then assert(a==1 and b==10000);draws=draws+1;return 5000 end
    return random(a,b)
  end
  originalInit(args)
  math.random=random`;
    const replacement = routeConfig.stage === 1 ? stageOneSeed : '  math.randomseed(70441022,args.stageId)\n  originalInit(args)';
    await route.fulfill({ response, body: source.replace(originalSeed, replacement) });
  });
  if (routeConfig.stage === 2) await page.addInitScript(() => {
    const key = 'starfall.monster-defense.progress/2/default/clear/78000001';
    localStorage.setItem(key, '1');
  });
  // Observe the traffic. All commands in this test go through the player-facing canvas.
  await page.addInitScript(()=>{
    const audioEvidence = { starts: 0, loopStarts: 0, maxBufferSamples: 0 };
    Object.assign(window, { audioEvidence });
    const startSource = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      startSource.apply(this, args);
      if (!this.buffer) return;
      audioEvidence.starts++;
      if (this.loop) audioEvidence.loopStarts++;
      audioEvidence.maxBufferSamples = Math.max(audioEvidence.maxBufferSamples, this.buffer.length);
    };
    const OriginalWorker=Worker;
    const observed={frame:0,speed:1,choiceListId:0,cards:[] as {id:number;shown:boolean}[], chooserListId:0, chooserScroll:0, starts:[] as number[],
      result:null as null | {win:boolean;frame:number;wave:number;kills:number},errors:[] as string[]};
    Object.assign(window,{observedRun:observed});
    window.Worker=class extends OriginalWorker {
      constructor(url:string|URL,options?:WorkerOptions){
        super(url,options);
        this.addEventListener('message',({data}:{data:UiHostMessage})=>{
          if (data.type === 'open' && data.window === 'Activity17MiniGameChoice2Window') {
            observed.chooserListId = data.tree.children.find((node) => node.name === 'Main')?.children.find((node) => node.name === 'TipsList')?.id ?? 0;
          }
          if (data.type === 'open' && data.window === 'MiniGameSkillChoiceWindow') {
            observed.choiceListId = data.tree.children.find((node) => node.name === 'Main')?.children.find((node) => node.name === 'TipsList')?.id ?? 0;
            observed.cards = [];
          }
          if (data.type === 'close' && data.window === 'MiniGameSkillChoiceWindow') observed.cards = [];
          if (data.type === 'ops') for (const op of data.ops) {
            if (op.op === 'scroll' && op.id === observed.chooserListId) observed.chooserScroll = op.x;
            if (op.op === 'list-clear' && op.id === observed.choiceListId) observed.cards = [];
            if (op.op === 'list-add' && op.id === observed.choiceListId) observed.cards.push({ id: op.item.id, shown: false });
            if (op.op === 'transition-play' && op.name === 'up') {
              const card = observed.cards.find((item) => item.id === op.id);
              if (card) card.shown = true;
            }
          }
          if(data.type==='error') observed.errors.push(data.message);
          if(data.type==='event' && data.event.name==='world'){
            observed.frame=data.event.state.fixedFrame;
            observed.speed=data.event.state.speedIndex ?? 1;
          }
          if(data.type==='event' && data.event.name==='settlement') observed.result=data.event;
          if(data.type==='event' && data.event.name==='start-battle') observed.starts.push(data.event.stageId);
        });
      }
    };
  });
  await page.goto('./');
  await openChooser(page);
  await originalClick(page,145,routeConfig.startY);
  const run=()=>page.evaluate(()=>(window as unknown as {observedRun:{frame:number;speed:number;cards:{shown:boolean}[];chooserScroll:number;starts:number[];result:null|{win:boolean;frame:number;wave:number;kills:number};errors:string[]}}).observedRun);
  await expect.poll(async()=>(await run()).starts).toEqual([78000000 + routeConfig.stage]);
  await expect.poll(async()=>(await run()).frame,{timeout:30000}).toBeGreaterThan(0);
  await originalClick(page,247,47);
  await expect.poll(async()=>(await run()).speed).toBe(2);
  await expect.poll(async()=>(await run()).frame,{timeout:30000}).toBeGreaterThan(80);
  await page.screenshot({path:test.info().outputPath('battlefield.png')});
  let choice=0;
  const winningPicks = routeConfig.picks;
  while(!(await run()).result){
    await expect(page.getByRole('alert')).toHaveCount(0);
    const modal=page.getByRole('region',{name:'选择强化'});
    const { cards } = await run();
    if(await modal.isVisible() && cards.length && cards.every((card) => card.shown)){
      const width = cards.length * 280 + (cards.length - 1) * 40;
      const cardX = 207 + Math.floor((920 - width) / 2) + 140 + winningPicks[choice]! * 320;
      await originalClick(page,cardX,355);
      await originalClick(page,667,654);
      await expect(modal).toHaveCount(0);
      choice++;
    } else await page.waitForTimeout(150);
  }
  const completed=await run();
  expect(completed.errors).toEqual([]);
  expect(completed.result).toMatchObject({ win: true, frame: routeConfig.frame, wave: 2, kills: routeConfig.kills });
  expect(choice).toBe(winningPicks.length);
  await expect(page.getByRole('region',{name:'战斗结算'})).toBeVisible();
  await page.screenshot({path:test.info().outputPath('settlement.png')});
  const nextStageId = 78000001 + routeConfig.stage;
  const saved=()=>page.evaluate((stage) => localStorage.getItem('starfall.monster-defense.progress/2/default/clear/' + (78000000 + stage)), routeConfig.stage);
  expect(await saved()).toBe('1');
  // A second page opens the save while the first still shows the settlement button.
  const reopened = await context.newPage();
  await reopened.goto('./');
  await openChooser(reopened);
  await originalClick(reopened, 145, routeConfig.nextY);
  await expect(reopened.getByRole('region', { name: '魔物抵御战战场' })).toBeVisible({ timeout: 30000 });
  await reopened.close();
  await originalClick(page,667,575);
  await expect(page.getByRole('region',{name:'选择关卡'})).toBeVisible();
  expect(await saved()).toBe('1');
  const audio = await page.evaluate(() =>
    (window as unknown as { audioEvidence: { starts:number; loopStarts:number; maxBufferSamples:number } }).audioEvidence);
  expect(audio.loopStarts).toBeGreaterThan(0);
  expect(audio.starts).toBeGreaterThan(audio.loopStarts);
  expect(audio.maxBufferSamples).toBeGreaterThan(0);
  const report = JSON.stringify({ ...completed, audio, choicesConfirmed: choice, saved: await saved() }, null, 2);
  const { writeFile } = await import('node:fs/promises');
  await writeFile(test.info().outputPath('result.json'), report);
  await test.info().attach('result',{body:report,contentType:'application/json'});
  await expect.poll(async()=>(await run()).chooserScroll).toBe(-190 * routeConfig.stage);
  await page.screenshot({path:test.info().outputPath('next-stage.png')});
  await originalClick(page, 145, routeConfig.nextY);
  await expect.poll(async()=>(await run()).starts).toContain(nextStageId);
  await expect(page.getByRole('region', { name: '魔物抵御战战场' })).toBeVisible({ timeout: 30000 });
  await page.reload();
  await openChooser(page);
  await originalClick(page, 145, routeConfig.nextY);
  await expect.poll(async()=>(await run()).starts).toEqual([nextStageId]);
  await expect(page.getByRole('region', { name: '魔物抵御战战场' })).toBeVisible({ timeout: 30000 });
});

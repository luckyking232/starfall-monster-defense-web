import { expect, test } from '@playwright/test';
import type { UiHostMessage } from '../../runtime/ui/protocol';
import { openChooser, originalClick } from './navigation';

const musicTrack = /\/assets\/audio\/02_B02-O\.(wav|flac)$/;

test('选关预载音乐，慢请求期间显示原过场，开战前音乐已完成解码', async ({page}) => {
  test.setTimeout(90000);
  let allow!: () => void, requests = 0;
  const gate = new Promise<void>(done => { allow=done; });
  await page.route(musicTrack, async route => { requests++; await gate; await route.continue(); });
  await page.addInitScript(() => {
    const observed = { frame:0, musicStarts:0, decodedMusic:0, decodedAtFirstFrame:0 };
    Object.assign(window,{ battlePreparation:observed });
    const priorDecode = AudioContext.prototype.decodeAudioData;
    AudioContext.prototype.decodeAudioData = function (...args) {
      const result = priorDecode.apply(this,args);
      void result.then(buffer=>{ if (buffer.duration>30) observed.decodedMusic++; }).catch(()=>{});
      return result;
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      if (this.buffer && this.buffer.duration>30) observed.musicStarts++;
      return start.apply(this,args);
    };
    const WorkerClass = window.Worker;
    window.Worker = class extends WorkerClass {
      constructor(url:string|URL,options?:WorkerOptions) {
        super(url,options);
        this.addEventListener('message',({data}:MessageEvent<UiHostMessage>)=>{
          if(data.type==='event' && data.event.name==='world' && data.event.state.fixedFrame>0) {
            if (!observed.frame) observed.decodedAtFirstFrame = observed.decodedMusic;
            observed.frame = data.event.state.fixedFrame;
          }
        });
      }
    };
  });
  const observe = () => page.evaluate(()=>(window as unknown as {battlePreparation:{frame:number;musicStarts:number;decodedAtFirstFrame:number}}).battlePreparation);
  try {
    await page.goto('./');
    await openChooser(page);
    await expect.poll(()=>requests,{timeout:10000}).toBe(1);
    await originalClick(page,145,274);
    await expect(page.locator('.battle-wait')).toContainText('战斗音乐');
    await expect(page.locator('.loading-art')).toBeVisible({timeout:10000});
    expect(await observe()).toMatchObject({frame:0,musicStarts:0});
  } finally { allow(); }
  await expect.poll(async()=>(await observe()).frame,{timeout:30000}).toBeGreaterThan(0);
  await expect.poll(async()=>(await observe()).musicStarts).toBeGreaterThanOrEqual(2);
  expect((await observe()).decodedAtFirstFrame).toBeGreaterThanOrEqual(2);
  await expect(page.locator('.battle-wait')).toBeHidden();
  expect(requests).toBe(1);
});

test('音乐不可用时可重试，也能选择无音乐进入', async({page})=>{
  test.setTimeout(75000);
  let failures=0;
  await page.route(musicTrack, async route=>{failures++; await route.abort();});
  await page.goto('./');
  await openChooser(page);
  await originalClick(page,145,274);
  const retry = page.getByRole('button',{name:'重试音乐'});
  await expect(retry).toBeVisible({timeout:20000});
  const previous=failures;
  await retry.click();
  await expect.poll(()=>failures).toBeGreaterThan(previous);
  await page.getByRole('button',{name:'无音乐进入'}).click();
  await expect(page.getByRole('region',{name:'魔物抵御战战场'})).toBeVisible({timeout:30000});
  await expect(page.locator('.battle-wait')).toBeHidden();
});

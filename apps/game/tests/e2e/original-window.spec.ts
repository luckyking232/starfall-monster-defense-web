import { expect, test } from '@playwright/test';

// 显式测试时间（仅测试用，不代表产品排期）：活动开始于 2023-11-14T22:13:20Z，
// “服务器现在”为 2025-11-25T09:20:00Z，全部 unlock_day(0..10) 相对开始时间已到期。
const TEST_ACTIVITY_START = 1_700_000_000;
const TEST_SERVER_NOW = 1_764_000_000;



interface Evidence {
  entryPoint: string;
  session: string;
  mainRootName: string;
  startBtnClickHandlers: number;
  startBtnText: string;
  integralWord: string;
  choiceRootName: string;
  stageButtonCount: number;
  stage1Lock: number;
  stage2Lock: number;
  stage1NumberText: string;
  headCount: number;
  headLocks: number[];
  head1Url: string;
  lockedWarn: string;
  battleEventsAfterLocked: number;
  battleStageId: number;
  secondSession: string;
  mainOpenCount: number;
  disposeError: string;
  pageErrors: string[];
}

test('original Lua windows really execute inside a browser worker', async ({ page }) => {
  test.setTimeout(180000);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await (await import('./fixture')).openFixture(page);

  const evidence = await page.evaluate(
    async ({ activityStart, serverNow }) => {
      const clientBundleUrl = new URL('assets/ui-client.js', document.baseURI).href;
      const { OriginalUiClient } = await import(clientBundleUrl);
      const client = new OriginalUiClient(new URL('assets/ui-host-worker.js', document.baseURI).href);
      const messages: any[] = [];
      client.onMessage((message: any) => messages.push(message));

      const opens = () => messages.filter((m) => m.type === 'open');
      const ops = () => messages.filter((m) => m.type === 'ops').flatMap((m) => m.ops);
      const events = () => messages.filter((m) => m.type === 'event').map((m) => m.event);
      const errors = () => messages.filter((m) => m.type === 'error');
      const child = (node: any, name: string) => {
        const found = node.children.find((entry: any) => entry.name === name);
        if (!found) throw new Error(`missing child ${name} under ${node.name}`);
        return found;
      };
      const lastListItems = (listId: number) => {
        const matches = ops().filter((op: any) => op.op === 'list-items' && op.id === listId);
        if (matches.length === 0) throw new Error(`no list-items for ${listId}`);
        return matches[matches.length - 1].items;
      };
      const setValues = (id: number) =>
        ops()
          .filter((op: any) => op.op === 'set' && op.id === id)
          .map((op: any) => op.value);
      const controllerValues = (id: number, name: string) =>
        ops()
          .filter((op: any) => op.op === 'controller' && op.id === id && op.name === name)
          .map((op: any) => op.index);

      const ready = await client.init({ activityStartStamp: activityStart, serverNowStamp: serverNow });
      const session = client.sessionId;

      const mainOpen = opens().find((m) => m.window === 'Activity17MiniGame2MainWindow');
      const main = child(mainOpen.tree, 'Main');
      const startBtn = child(main, 'StartBtn');
      const startWord = child(startBtn, 'WordTxt');
      const integral = child(child(main, 'Top'), 'Integral');
      const startBtnClickHandlers = ops().filter((op: any) => op.op === 'click-handlers' && op.id === startBtn.id).length;

      await client.click(startBtn.id);

      const choiceOpen = opens().find((m) => m.window === 'Activity17MiniGameChoice2Window');
      const choiceMain = child(choiceOpen.tree, 'Main');
      const tipsList = child(choiceMain, 'TipsList');
      const map = lastListItems(tipsList.id)[0];
      const stageButtons = [];
      for (let index = 1; index <= 20; index += 1) stageButtons.push(child(map, `Tips${index}Btn`));
      stageButtons.push(child(map, 'SpecialBtn'));
      const headList = child(child(choiceMain, 'CardRegion'), 'HeadList');
      const heads = lastListItems(headList.id);

      const battlesBefore = events().filter((event: any) => event.name === 'start-battle').length;
      await client.click(stageButtons[1].id);
      const lockedWarn = events()
        .filter((event: any) => event.name === 'warn-tips')
        .map((event: any) => event.text)
        .pop();
      const battleEventsAfterLocked = events().filter((event: any) => event.name === 'start-battle').length - battlesBefore;

      await client.click(stageButtons[0].id);
      const battleStageId = events()
        .filter((event: any) => event.name === 'start-battle')
        .map((event: any) => event.stageId)
        .pop();

      const ready2 = await client.init({ activityStartStamp: activityStart, serverNowStamp: serverNow });
      let disposeError = '';
      await client.dispose();
      try {
        await client.click(1);
      } catch (error) {
        disposeError = String(error);
      }

      return {
        entryPoint: ready.entryPoint,
        session,
        mainRootName: mainOpen.tree.name,
        startBtnClickHandlers,
        startBtnText: setValues(startWord.id).pop() ?? '',
        integralWord: setValues(child(integral, 'WordTxt').id).pop() ?? '',
        choiceRootName: choiceOpen.tree.name,
        stageButtonCount: stageButtons.length,
        stage1Lock: controllerValues(stageButtons[0].id, 'lock').pop() ?? -1,
        stage2Lock: controllerValues(stageButtons[1].id, 'lock').pop() ?? -1,
        stage1NumberText: setValues(child(stageButtons[0], 'NumberTxt').id).pop() ?? '',
        headCount: heads.length,
        headLocks: heads.map((head: any) => controllerValues(head.id, 'lock').pop() ?? -1),
        head1Url: setValues(child(child(heads[0], 'Bg'), 'PicLoader').id).pop() ?? '',
        lockedWarn: lockedWarn ?? '',
        battleEventsAfterLocked,
        battleStageId: battleStageId ?? 0,
        secondSession: ready2.session,
        mainOpenCount: opens().filter((m) => m.window === 'Activity17MiniGame2MainWindow').length,
        disposeError,
        taskFailures: errors().filter((m) => m.code === 'task-failed').length,
      };
    },
    { activityStart: TEST_ACTIVITY_START, serverNow: TEST_SERVER_NOW },
  );

  const result: Evidence & { taskFailures: number } = { ...evidence, pageErrors };
  expect(result.entryPoint).toBe('Activity17MiniGame2MainWindow');
  expect(result.session).not.toBe('');
  expect(result.mainRootName).toBe('MiniGame2Window');
  expect(result.startBtnClickHandlers).toBeGreaterThanOrEqual(1);
  expect(result.startBtnText).toBe('前往'); // T(11918) 经原 BaseWord_cn
  expect(result.integralWord).toBe('最高关卡数'); // T(1981)
  expect(result.choiceRootName).toBe('MiniGameChoice2Window');
  expect(result.stageButtonCount).toBe(21);
  expect(result.stage1Lock).toBe(0);
  expect(result.stage2Lock).toBe(1);
  expect(result.stage1NumberText).toBe('第1关'); // T(11917, 1)
  expect(result.headCount).toBe(5);
  expect(result.headLocks).toEqual([0, 0, 1, 1, 1]);
  expect(result.head1Url).toBe('ui://aonql508spxeid');
  expect(result.lockedWarn).toBe('前置关卡未通过'); // T(11926)
  expect(result.battleEventsAfterLocked).toBe(0);
  expect(result.battleStageId).toBe(78000001);
  expect(result.secondSession).not.toBe(result.session);
  expect(result.mainOpenCount).toBe(2);
  expect(result.disposeError).toMatch(/disposed|closed/);
  expect(result.taskFailures).toBe(0);
  expect(result.pageErrors).toEqual([]);
});

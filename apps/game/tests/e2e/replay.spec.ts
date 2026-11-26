import { expect, test } from '@playwright/test';

test('the original Lua worker completes the exact stage-one baseline', async ({ page }) => {
  await (await import('./fixture')).openFixture(page);
  const result = await page.evaluate(async () => {
    const entry = new URL('assets/engine-public.js', document.baseURI).href;
    const { RulesClient, runStage1Baseline } = await import(/* @vite-ignore */ entry);
    const client = new RulesClient(new URL('assets/runtime-worker.js', document.baseURI).href);
    try {
      return await runStage1Baseline(client);
    } finally {
      client.dispose();
    }
  });
  expect(result.state.fixedFrame).toBe(4181);
  expect(result.state.curMonsterWave).toBe(2);
  expect(result.state.killEnemyCount).toBe(205);
  expect(result.state.terminal?.win).toBe(true);
  expect(result.choices).toHaveLength(11);
});

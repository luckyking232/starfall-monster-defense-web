import type { RulesClient } from './client';
import type { RuleChoiceState, RuleState } from './protocol';

const PICKS = [0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1];

function requireBaseline(state: RuleState): void {
  if (state.fixedFrame !== 4181 || state.curMonsterWave !== 2 || state.killEnemyCount !== 205 || state.terminal?.win !== true) {
    throw new Error(`Unexpected baseline: frame=${state.fixedFrame}, wave=${state.curMonsterWave}, kills=${state.killEnemyCount}, terminal=${JSON.stringify(state.terminal)}`);
  }
}

export async function runStage1Baseline(client: RulesClient): Promise<{ state: RuleState; choices: [number, number][] }> {
  const choices: [number, number][] = [];
  await client.start(78000001, { tape: Array(50).fill(5000), globalRngSeeds: [70441022, 78000001] });
  try {
    await client.speed(2);
    let state = (await client.snapshot()).state as RuleState;
    for (let iteration = 0; iteration < 300 && !state.terminal; iteration++) {
      if (state.choice) {
        let choice: RuleChoiceState = state.choice;
        if (choice.visible.some((visible) => !visible)) {
          await client.advanceUnscaled(701);
          choice = (await client.snapshot()).state.choice!;
        }
        const pick = PICKS[choices.length];
        if (pick === undefined) throw new Error('Unexpected extra choice');
        const skillId = choice.offerIds[pick];
        if (skillId === undefined) throw new Error(`Invalid choice index ${pick}`);
        await client.select(choice.windowId, choice.generation, skillId, true);
        choices.push([state.fixedFrame, skillId]);
      } else {
        await client.stepFixed(40);
      }
      state = (await client.snapshot()).state as RuleState;
    }
    requireBaseline(state);
    const expected = [344, 654, 1052, 1660, 1842, 2022, 2308, 2645, 3042, 3423, 3822];
    if (JSON.stringify(choices.map(([frame]) => frame)) !== JSON.stringify(expected)) {
      throw new Error(`Unexpected choices: ${JSON.stringify(choices)}`);
    }
    return { state, choices };
  } finally {
    await client.close();
  }
}

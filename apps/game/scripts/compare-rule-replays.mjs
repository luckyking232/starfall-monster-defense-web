// Run with Node 22+ and --experimental-strip-types. Inputs may be worktrees or apps/game directories.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, createReadStream, createWriteStream, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { createGunzip, createGzip } from 'node:zlib';
import { rolldown } from 'rolldown';
import { replayRules } from './lib/rule-replay.mjs';
import { createPresentationEvidence } from './lib/presentation-evidence.ts';
import { compareRuleRecord, firstRuleDifference } from './lib/rule-trace-diff.ts';

const [referenceRoot, candidateRoot, outputDir, scenarioSelection] = process.argv.slice(2);
if (!referenceRoot || !candidateRoot || !outputDir) {
  throw new Error('Usage: node --experimental-strip-types scripts/compare-rule-replays.mjs <reference> <candidate> <output-directory> [stage1,stage2,stage18,endless,stress]');
}
const scenarios = {
  stage1: { stage: 1 },
  stage2: { stage: 2, lastFrame: 3693, watch: 'settlement' },
  stage18: { stage: 18 },
  endless: { stage: 21, lastFrame: 6586, watch: 'settlement' },
  stress: { stage: 'stress' },
};
const names = scenarioSelection?.split(',') ?? Object.keys(scenarios);
if (names.some(name => !Object.hasOwn(scenarios, name))) throw new Error(`Unknown replay case in ${names.join(',')}`);
const candidateStepBudget = process.env.STARFALL_RULE_CANDIDATE_STEP_BUDGET === undefined
  ? undefined : Number(process.env.STARFALL_RULE_CANDIDATE_STEP_BUDGET);
if (candidateStepBudget !== undefined && (!Number.isSafeInteger(candidateStepBudget) || candidateStepBudget < 1)) {
  throw new Error('STARFALL_RULE_CANDIDATE_STEP_BUDGET must be a positive integer');
}
const evidence = path.resolve(outputDir);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const writeJson = (name, data) => writeFileSync(path.join(evidence, name), JSON.stringify(data, null, 2) + '\n');
mkdirSync(evidence, { recursive: true });

async function buildHost(root, label) {
  const app = path.resolve(root, existsSync(path.join(root, 'runtime/ui/host.ts')) ? '' : 'apps/game');
  const destination = path.join(evidence, label + '-host.mjs');
  const bundle = await rolldown({ input: path.join(app, 'runtime/ui/host.ts'), platform: 'node' });
  try {
    await bundle.write({ file: destination, format: 'esm' });
  } finally {
    await bundle.close();
  }
  const git = (...args) => execFileSync('git', ['-C', app, ...args], { encoding: 'utf8' }).trim();
  const metadata = {
    source: app,
    commit: git('rev-parse', 'HEAD'),
    tree: git('rev-parse', 'HEAD^{tree}'),
    worktree: git('status', '--porcelain'),
    hostBundleSha256: sha256(readFileSync(destination)),
    diagnosticsSha256: sha256(readFileSync(new URL('./lib/rule-trace.lua', import.meta.url))),
    presentationDiagnosticsSha256: sha256(readFileSync(new URL('./lib/presentation-evidence.ts', import.meta.url))),
  };
  writeJson(label + '-build.json', metadata);
  return { createHost: (await import(pathToFileURL(destination).href)).createOriginalUiHost, publicDir: path.join(app, 'public') };
}

async function capture(label, name, host, scenario) {
  const filename = path.join(evidence, `${label}-${name}.ndjson`);
  const fd = openSync(filename, 'w');
  const result = { trace: filename + '.gz', scenario };
  const presentation = createPresentationEvidence(name === 'stress');
  try {
    const { seedCalls, inputs, summary } = await replayRules({
      ...host, seed: 70441022, ...scenario, writeRecord: raw => writeSync(fd, raw + '\n'), observeEvent: presentation.observe,
    });
    Object.assign(result, { seedCalls, inputs, summary });
  } catch (error) {
    result.error = error.stack;
  } finally {
    closeSync(fd);
    await pipeline(createReadStream(filename), createGzip(), createWriteStream(result.trace));
    unlinkSync(filename);
  }
  result.traceSha256 = sha256(readFileSync(result.trace));
  const appearance = presentation.frames();
  let effects = [];
  if (name === 'stress') {
    const manifest = JSON.parse(readFileSync(path.join(host.publicDir, 'assets/effects/manifest.json'), 'utf8'));
    const lifetimes = new Map(Object.entries(manifest.lifetimes).map(([file, lifetime]) => [path.basename(file), lifetime]));
    effects = presentation.effects().map(effect => ({ ...effect, originalLifetime: lifetimes.get(effect.asset) }));
  }
  const presentationFile = `${label}-${name}-presentation.json`;
  writeJson(presentationFile, { audioCues: presentation.audio, snapshots: appearance, effects });
  result.presentation = { file: presentationFile, sha256: sha256(readFileSync(path.join(evidence, presentationFile))) };
  writeJson(`${label}-${name}.json`, result);
  return { ...result, audio: presentation.audio, appearance, effects };
}

async function compareFiles(reference, candidate) {
  const opened = [reference, candidate].map(file => {
    const input = createReadStream(file).pipe(createGunzip());
    return { input, lines: createInterface({ input, crlfDelay: Infinity }) };
  });
  const [a, b] = opened.map(source => source.lines[Symbol.asyncIterator]());
  let records = 0, fixedFrames = 0;
  try {
    while (true) {
      const [first, second] = await Promise.all([a.next(), b.next()]);
      if (first.done && second.done) return { records, fixedFrames, difference: null };
      if (first.value !== second.value) {
        const difference = compareRuleRecord(first.done ? undefined : JSON.parse(first.value),
          second.done ? undefined : JSON.parse(second.value));
        if (difference) return { records, fixedFrames, difference };
      }
      records += 1;
      if (first.value.includes('"kind":"fixed"')) fixedFrames += 1;
    }
  } finally {
    for (const source of opened) {
      source.lines.close();
      source.input.destroy();
    }
  }
}

const reference = await buildHost(referenceRoot, 'reference');
const candidate = await buildHost(candidateRoot, 'candidate');
const report = {};
for (const name of names) {
  const scenario = scenarios[name];
  const first = await capture('reference', name, reference, scenario);
  const second = await capture('candidate', name, candidate, { ...scenario, stepBudget: candidateStepBudget });
  const comparison = await compareFiles(first.trace, second.trace);
  const audioDifference = firstRuleDifference(first.audio, second.audio);
  const visualDifference = firstRuleDifference(first.appearance, second.appearance);
  const battleSfx = first.audio.filter(({ event }) => event.kind === 'sfx' && event.frame > 0).length;
  report[name] = { ...comparison, reference: first.summary, candidate: second.summary,
    presentation: {
      audioCues: first.audio.length, battleSfx, audioDifference, sampledVisualFrames: first.appearance.length, visualDifference,
      referenceFile: first.presentation.file, candidateFile: second.presentation.file,
    },
    referenceError: first.error, candidateError: second.error };
  console.log(name, JSON.stringify(report[name]));
  const files = new Set([...Object.keys(first.inputs ?? {}), ...Object.keys(second.inputs ?? {})]);
  const differingInput = [...files].find(file => first.inputs?.[file]?.payloadSha256 !== second.inputs?.[file]?.payloadSha256);
  if (differingInput) {
    report[name].firstDifferentOriginalInput = differingInput;
    process.exitCode = 1;
  }
  if (comparison.difference || audioDifference || visualDifference || battleSfx === 0 || first.error || second.error) {
    process.exitCode = 1;
  }
  if (name === 'stress') {
    report[name].presentation.effectPaths = first.effects.filter(effect => effect.frames > 0);
    const missingEffectPaths = first.effects.filter(effect => effect.frames === 0).map(effect => effect.asset);
    if (missingEffectPaths.length) {
      report[name].presentation.missingEffectPaths = missingEffectPaths;
      console.error('Missing representative effect paths', missingEffectPaths);
      process.exitCode = 1;
    }
  }
  if (name === 'stage18' && !first.error) {
    const changed = await capture('negative-control', name, reference, { ...scenario, lastFrame: 12, extraRandomFrame: 8 });
    const negative = await compareFiles(first.trace, changed.trace);
    report[name].extraRandomNegativeControl = negative;
    console.log('stage18 negative control', JSON.stringify(negative));
    if (changed.error || negative.difference?.frame !== 8 || negative.difference.object !== 'battle-rng') process.exitCode = 1;
  }
  writeJson('rule-parity.json', report);
}

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { checkLocalInputs } from '../scripts/check_local_inputs.mjs';

async function tempApp(t) {
  const app = await mkdtemp(join(tmpdir(), 'dev-input-check-'));
  t.after(() => rm(app, { recursive: true, force: true }));
  return app;
}

async function put(app, path, body) {
  const output = join(app, path);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, typeof body === 'string' ? body : JSON.stringify(body));
}

test('a clean input tree reports every missing inventory without creating it', async (t) => {
  const app = await tempApp(t);
  const result = await checkLocalInputs(app);
  const paths = result.issues.map((issue) => issue.path);
  assert.equal(result.checked, 0);
  assert.ok(paths.includes('runtime-input.lock.json'));
  assert.ok(paths.includes('public/assets/runtime/ui/manifest.json'));
  assert.ok(paths.includes('public/assets/fgui/fgui-manifest.json'));
  assert.ok(paths.includes('public/assets/native/manifest.json'));
  assert.ok(paths.includes('public/assets/content/stages.json'));
  assert.deepEqual(await readdir(app), []);
});

test('checks generated inputs, compares the runtime lock, and rejects bad paths and changed bytes', async (t) => {
  const app = await tempApp(t);
  const payload = 'synthetic bytes';
  const name = 'sample.bin';
  const sha256 = createHash('sha256').update(payload).digest('hex');
  const digest = { sha256, bytes: payload.length };
  const file = { file: name, ...digest };
  const runtime = { files: { [name]: digest } };
  const assets = 'public/assets';
  await Promise.all([
    put(app, 'runtime-input.lock.json', runtime),
    put(app, `${assets}/runtime/manifest.json`, runtime),
    put(app, `${assets}/runtime/ui/manifest.json`, { files: { mock: file }, platformModules: {} }),
    put(app, `${assets}/effects/manifest.json`, { files: { [name]: digest } }),
    put(app, `${assets}/manifest.json`, { files: { [name]: digest } }),
    put(app, `${assets}/battle-assets.json`, { files: { [name]: digest } }),
    put(app, `${assets}/battle-ui.json`, { files: { [name]: digest } }),
    put(app, `${assets}/fgui/fgui-manifest.json`, { packages: [{
      json: name, jsonSha256: sha256, fui: name, fuiSha256: sha256, atlases: [file],
    }] }),
    put(app, `${assets}/native/manifest.json`, { prefabs: [{ json: name, jsonSha256: sha256 }], frames: { mock: file } }),
    ...['content/stages.json', 'content/cards.json', 'content/skills.json', 'content/monster-groups.json']
      .map((path) => put(app, `${assets}/${path}`, [{ id: 'fixture' }])),
    ...['runtime', 'runtime/ui', 'fgui', 'native', 'effects', 'ui/battle', '']
      .map((directory) => put(app, join(assets, directory, name), payload)),
  ]);

  const ready = await checkLocalInputs(app);
  assert.deepEqual(ready.issues, []);
  assert.equal(ready.checked, 7);

  await put(app, `${assets}/runtime/${name}`, payload.replace('bytes', 'wrong'));
  await put(app, `${assets}/runtime/manifest.json`, { files: { other: digest } });
  await put(app, `${assets}/runtime/ui/manifest.json`, { files: { mock: { ...file, file: '../../../outside' } } });
  const changed = await checkLocalInputs(app);
  assert.ok(changed.issues.some((issue) => issue.problem.includes('runtime-input.lock.json')));
  assert.ok(changed.issues.some((issue) => issue.problem.includes('unsafe relative path')));

  await put(app, `${assets}/runtime/manifest.json`, runtime);
  const mismatched = await checkLocalInputs(app);
  assert.ok(mismatched.issues.some((issue) => issue.path.endsWith(name) && issue.problem.includes('SHA-256')));
});

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { promisify } from 'node:util';

const run = promisify(execFile);
const script = fileURLToPath(new URL('../scripts/hosted-release.mjs', import.meta.url));
const inventory = 'asset-inventory.json';
const oldRelease = 'assets/release-aaaaaaaaaaaaaaaaaaaaaaaa';
const newRelease = 'assets/release-bbbbbbbbbbbbbbbbbbbbbbbb';

async function put(root, name, bytes) {
  const path = join(root, name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

async function buildFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'starfall-retention-'));
  const oldSite = join(root, 'old');
  const nextSite = join(root, 'next');
  await put(oldSite, `${oldRelease}/media.png`, 'unchanged');
  await put(oldSite, `${oldRelease}/manifest.json`, 'old');
  await put(oldSite, 'assets/main-Previous.js', 'previous player');
  await put(nextSite, `${newRelease}/media.png`, 'unchanged');
  await put(nextSite, `${newRelease}/manifest.json`, 'new');
  await put(nextSite, 'assets/main-CurrentApp.js', 'new player');
  const requested = [];
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    requested.push(path);
    try {
      assert(path.startsWith('/play/'));
      response.end(await readFile(join(oldSite, path.slice('/play/'.length) || 'index.html')));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.close();
    server.closeAllConnections();
    await rm(root, { recursive: true, force: true });
  });
  function seal(site) {
    return run(process.execPath, [script, 'inventory', site]);
  }
  const previous = `http://127.0.0.1:${server.address().port}/play/`;
  const retain = () => run(process.execPath, [script, 'retain', nextSite, previous]);
  await seal(oldSite);
  await seal(nextSite);
  return { oldSite, nextSite, requested, retain };
}

test('retains the previous release URLs and downloads only bytes missing from the new release', async t => {
  const { nextSite, requested, retain } = await buildFixture(t);
  await retain();
  assert.equal(await readFile(join(nextSite, oldRelease, 'media.png'), 'utf8'), 'unchanged');
  assert.equal(await readFile(join(nextSite, oldRelease, 'manifest.json'), 'utf8'), 'old');
  assert.equal(await readFile(join(nextSite, 'assets/main-Previous.js'), 'utf8'), 'previous player');
  assert.deepEqual(requested.filter(path => !path.endsWith(inventory)).sort(), [
    '/play/assets/main-Previous.js', `/play/${oldRelease}/manifest.json`,
  ]);
  const current = JSON.parse(await readFile(join(nextSite, inventory), 'utf8'));
  assert.deepEqual(Object.keys(current.files).sort(), [
    'assets/main-CurrentApp.js', `${newRelease}/manifest.json`, `${newRelease}/media.png`,
  ]);
});

test('checks retrieved content before serving a previous immutable URL', async t => {
  const { oldSite, nextSite, retain } = await buildFixture(t);
  await put(oldSite, `${oldRelease}/manifest.json`, 'bad');
  await assert.rejects(retain, /Digest mismatch.*manifest\.json/);
  await assert.rejects(readFile(join(nextSite, oldRelease, 'manifest.json')), { code: 'ENOENT' });
});

test('rejects previous metadata that refers outside the immutable assets directory', async t => {
  const { oldSite, retain } = await buildFixture(t);
  await put(oldSite, inventory, JSON.stringify({ schema: 1, files: {
    'assets/../index.html': '0'.repeat(64),
  } }));
  await assert.rejects(retain, /Invalid asset inventory/);
});

test('rejects an inventory HTTP fallback on a site using fingerprinted assets', async t => {
  const { oldSite, retain } = await buildFixture(t);
  await put(oldSite, 'index.html', '<meta name="starfall-asset-inventory" content="asset-inventory.json">');
  await unlink(join(oldSite, inventory));
  await assert.rejects(retain, /expected a valid asset-inventory\.json/);
});

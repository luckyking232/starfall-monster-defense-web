import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const inventoryName = 'asset-inventory.json';
const inventoryVersion = 1;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const releasePath = /^assets\/release-[a-f\d]{24}\/(?:[\w.-]+\/)*[\w.-]+$/;
const vitePath = /^assets\/[\w.-]+-[\w-]{8,}\.[\w]+$/;
const originalAssets = fileURLToPath(new URL('../public/assets/', import.meta.url));
const legacyManifest = 'fgui/fgui-manifest.json';
const legacyManifestSha = 'de15e7e527574d04c31e66dd83f54216ba8c807c0a50945527d95cea477638ac';
const legacyTreeSha = '5ad4114bae2cbb83a80e3105c49c13f64e39a0003f84d24931e8f65218aa1ea7';

function immutableAsset(path) {
  return (releasePath.test(path) || vitePath.test(path)) &&
    !path.split('/').some(segment => segment === '.' || segment === '..') && !path.endsWith('.map');
}

async function* filesUnder(directory, prefix = '') {
  for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) yield* filesUnder(directory, path);
    else if (entry.isFile()) yield path;
    else throw new Error(`Unexpected file type in release directory: ${path}`);
  }
}

async function inventory(directory) {
  const files = [];
  for await (const path of filesUnder(directory, 'assets')) {
    if (!immutableAsset(path)) throw new Error(`Unexpected asset path in a fresh player build: ${path}`);
    files.push([path, digest(await readFile(join(directory, path)))]);
  }
  if (!files.length) throw new Error('No immutable player assets were built');
  files.sort(([left], [right]) => left < right ? -1 : Number(left > right));
  await writeFile(join(directory, inventoryName), JSON.stringify({ schema: inventoryVersion, files: Object.fromEntries(files) }));
}

function parseInventory(bytes, description) {
  try {
    const data = JSON.parse(bytes.toString());
    if (data?.schema === inventoryVersion && data.files && typeof data.files === 'object' && !Array.isArray(data.files)) {
      const entries = Object.entries(data.files);
      if (entries.length && entries.every(([path, hash]) => immutableAsset(path) && typeof hash === 'string' && /^[a-f\d]{64}$/.test(hash))) {
        return new Map(entries);
      }
    }
  } catch {
    // Preserve the source in the error whether the response was malformed JSON or another format.
  }
  throw new Error(`Invalid asset inventory from ${description}`);
}

async function get(site, path) {
  const url = new URL(path, site);
  if (path === inventoryName || path === '') url.searchParams.set('deployment-check', randomUUID());
  try {
    return await fetch(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30000) });
  } catch (error) {
    throw new Error(`Cannot read ${path || 'entry page'} from the previous site ${site}`, { cause: error });
  }
}

async function verifiedDownload(site, path, expected) {
  const response = await get(site, path);
  if (!response.ok) throw new Error(`Previous release asset ${path}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (digest(bytes) !== expected) throw new Error(`Digest mismatch for previous release asset ${path}`);
  return bytes;
}

async function retainLegacy(directory, site) {
  // Old builds issued unhashed URLs. Confirm the original FGUI catalog before
  // treating a missing inventory (or a host's HTML fallback) as this transition.
  const index = await get(site, '');
  if (!index.ok || (await index.text()).includes('name="starfall-asset-inventory"')) {
    throw new Error(`Could not verify legacy release at ${site}; expected a valid ${inventoryName}`);
  }
  await verifiedDownload(site, `assets/${legacyManifest}`, legacyManifestSha);
  // These are the presentation assets an original page can still request after
  // boot. The old page already has its JS, Worker, Wasm and Lua at the home screen.
  const paths = [];
  for (const category of ['audio', 'effects', 'fgui', 'fonts', 'native']) {
    for await (const path of filesUnder(originalAssets, category)) paths.push(path);
  }
  const tree = createHash('sha256');
  for (const path of paths.sort()) {
    const bytes = await readFile(join(originalAssets, path));
    tree.update(`${path} ${digest(bytes)}\n`);
    const target = join(directory, 'assets', path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  if (tree.digest('hex') !== legacyTreeSha) {
    throw new Error('Legacy presentation assets do not match the v1.0.1 release');
  }
  console.log(`Retained ${paths.length} original presentation URLs for open legacy tabs`);
}

async function retain(directory, previousSite) {
  const site = new URL(previousSite);
  if (!['https:', 'http:'].includes(site.protocol) || site.username || site.password || site.search || site.hash) {
    throw new Error('Previous site must be an HTTP(S) game URL without credentials, query or fragment');
  }
  if (!site.pathname.endsWith('/')) site.pathname += '/';

  const current = parseInventory(await readFile(join(directory, inventoryName)), directory);
  const response = await get(site, inventoryName);
  if (response.status === 404 || (response.ok && response.headers.get('content-type')?.includes('text/html'))) {
    await response.body?.cancel();
    await retainLegacy(directory, site);
    return;
  }
  if (!response.ok) throw new Error(`Previous asset inventory: HTTP ${response.status} from ${site}`);
  const previousBytes = Buffer.from(await response.arrayBuffer());
  const previous = parseInventory(previousBytes, site);
  const currentByDigest = new Map([...current].map(([path, hash]) => [hash, path]));
  const missing = [];
  for (const [path, hash] of previous) {
    if (current.has(path)) {
      if (current.get(path) !== hash) throw new Error(`Immutable URL changed content: ${path}`);
    } else {
      missing.push([path, hash]);
    }
  }

  let reused = 0;
  let downloaded = 0;
  let downloadedBytes = 0;
  for (let offset = 0; offset < missing.length; offset += 6) {
    await Promise.all(missing.slice(offset, offset + 6).map(async ([path, hash]) => {
      const target = join(directory, path);
      await mkdir(dirname(target), { recursive: true });
      const existingPath = currentByDigest.get(hash);
      if (existingPath) {
        await copyFile(join(directory, existingPath), target);
        reused++;
      } else {
        const bytes = await verifiedDownload(site, path, hash);
        await writeFile(target, bytes);
        downloaded++;
        downloadedBytes += bytes.length;
      }
    }));
  }

  const check = await get(site, inventoryName);
  if (!check.ok || digest(Buffer.from(await check.arrayBuffer())) !== digest(previousBytes)) {
    throw new Error(`Previous release changed during build at ${site}; rerun before deploying`);
  }
  console.log(`Retained previous release: reused ${reused} files, downloaded ${downloaded} files (${downloadedBytes} bytes)`);
}

const [command, directory, previousSite] = process.argv.slice(2);
if (command === 'inventory' && directory) {
  await inventory(resolve(directory));
} else if (command === 'retain' && directory && previousSite) {
  await retain(resolve(directory), previousSite);
} else {
  throw new Error('Usage: hosted-release.mjs inventory <build> | retain <build> <previousSite>');
}

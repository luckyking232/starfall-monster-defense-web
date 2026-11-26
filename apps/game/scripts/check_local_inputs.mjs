import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const app = fileURLToPath(new URL('../', import.meta.url));
const assets = 'public/assets';
const runtimeManifest = `${assets}/runtime/manifest.json`;
const runtimeLock = 'runtime-input.lock.json';

function fileRecords(files) {
  return Object.entries(files).map(([name, record]) => ({ ...record, file: record.file ?? name }));
}

const inventories = [
  [runtimeManifest, `${assets}/runtime`, (item) => fileRecords(item.files)],
  [`${assets}/runtime/ui/manifest.json`, `${assets}/runtime/ui`, (item) => [
    ...fileRecords(item.files), ...fileRecords(item.platformModules ?? {}),
  ]],
  [`${assets}/fgui/fgui-manifest.json`, `${assets}/fgui`, (item) => item.packages.flatMap((pkg) => [
    { file: pkg.json, sha256: pkg.jsonSha256 }, { file: pkg.fui, sha256: pkg.fuiSha256 }, ...pkg.atlases,
  ])],
  [`${assets}/native/manifest.json`, `${assets}/native`, (item) => [
    ...item.prefabs.map((prefab) => ({ file: prefab.json, sha256: prefab.jsonSha256 })),
    ...Object.values(item.frames),
  ]],
  [`${assets}/effects/manifest.json`, `${assets}/effects`, (item) => fileRecords(item.files)],
  [`${assets}/manifest.json`, assets, (item) => fileRecords(item.files)],
  [`${assets}/battle-assets.json`, assets, (item) => fileRecords(item.files)],
  [`${assets}/battle-ui.json`, `${assets}/ui/battle`, (item) => fileRecords(item.files)],
];

export async function checkLocalInputs(directory = app) {
  const root = await realpath(directory);
  const issues = [];
  const expected = new Map();
  let checked = 0;
  const report = (path, problem) => issues.push({ path, problem });

  async function read(path) {
    const target = await realpath(resolve(root, path));
    const child = relative(root, target);
    if (isAbsolute(child) || child === '..' || child.startsWith(`..${sep}`)) {
      throw new Error('resolved path is outside the app directory');
    }
    return readFile(target);
  }

  async function json(path) {
    try {
      return JSON.parse(await read(path));
    } catch (error) {
      report(path, error.code === 'ENOENT' ? 'missing local input' : error.message);
      return undefined;
    }
  }

  const lock = await json(runtimeLock);
  for (const [path, base, records] of inventories) {
    const generated = await json(path);
    if (generated === undefined) continue;
    if (path === runtimeManifest && lock !== undefined && !isDeepStrictEqual(lock, generated)) {
      report(path, `runtime manifest differs from ${runtimeLock}`);
    }

    try {
      const items = records(path === runtimeManifest ? lock ?? generated : generated);
      if (items.length === 0) report(path, 'empty file inventory');
      for (const { file, sha256, bytes } of items) {
        if (typeof file !== 'string' || /[\\:]/.test(file) || file.split('/').some((part) => !part || part === '.' || part === '..')) {
          report(path, `unsafe relative path ${JSON.stringify(file)}`);
          continue;
        }
        const location = `${base}/${file}`;
        if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(sha256)) {
          report(location, 'missing or invalid SHA-256');
          continue;
        }
        const hash = sha256.toLowerCase();
        const previous = expected.get(location);
        if (previous && (previous.sha256 !== hash || (previous.bytes !== undefined && bytes !== undefined && previous.bytes !== bytes))) {
          report(location, 'conflicting inventory entries');
        } else {
          expected.set(location, { sha256: hash, bytes: previous?.bytes ?? bytes });
        }
      }
    } catch (error) {
      report(path, `invalid file inventory (${error.message})`);
    }
  }

  for (const name of ['stages', 'cards', 'skills', 'monster-groups']) {
    const path = `${assets}/content/${name}.json`;
    const content = await json(path);
    if (content !== undefined && (!Array.isArray(content) || content.length === 0)) {
      report(path, 'expected a nonempty content table');
    }
  }

  for (const [path, expectedFile] of expected) {
    try {
      const payload = await read(path);
      const sha256 = createHash('sha256').update(payload).digest('hex');
      if (sha256 !== expectedFile.sha256) report(path, 'SHA-256 mismatch');
      else if (expectedFile.bytes !== undefined && expectedFile.bytes !== payload.length) report(path, 'byte count mismatch');
      else checked++;
    } catch (error) {
      report(path, error.code === 'ENOENT' ? 'missing inventory file' : error.message);
    }
  }

  return { checked, issues };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await checkLocalInputs();
  if (result.issues.length) {
    for (const { path, problem } of result.issues.slice(0, 25)) console.error(`${path} — ${problem}`);
    if (result.issues.length > 25) console.error(`… ${result.issues.length - 25} more input issues`);
    console.error('See the app README for the required local input inventories.');
    process.exitCode = 1;
  } else {
    console.log(`Verified ${result.checked} local files against SHA-256 inventories.`);
  }
}

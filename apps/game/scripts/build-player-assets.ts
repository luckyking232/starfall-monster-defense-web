import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { rolldown } from 'rolldown';
import type { Plugin } from 'vite';
import { buildBaseWord } from './build-base-word.ts';
import { readNativeModelMetadata } from '../runtime/ui/native-model-metadata.ts';

const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

interface AtlasManifest {
  packages: {json: string; atlases: {file: string; sha256: string}[]}[];
  atlasFormats?: Record<string, string>;
}

interface UiManifest {
  files: Record<string, {file: string; sha256: string; gzipFile?: string; rawFile?: string; payloadSha256?: string}>;
  platformModules: Record<string, {file: string; sha256: string}>;
}

interface NativeManifest {
  prefabs: {container: string; json: string; jsonSha256: string}[];
}

export async function playerAssets(qa: boolean): Promise<{ directory: string; plugin: Plugin }> {
  const files = new Map<string, Buffer>();
  const read = (path: string) => readFile(join('public/assets', path));
  async function copy(path: string) { files.set(path, await read(path)); }
  async function copyTree(directory: string) {
    for (const entry of await readdir(join('public/assets', directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await copyTree(path);
      else if (entry.isFile()) await copy(path);
    }
  }

  const fgui = JSON.parse((await read('fgui/fgui-manifest.json')).toString()) as AtlasManifest;
  const verification = JSON.parse(await readFile('release-assets/atlases.json', 'utf8')) as Record<string, {original: string; converted: string}>;
  fgui.atlasFormats = {};
  for (const entry of fgui.packages) {
    if (!qa) await copy('fgui/' + entry.json);
    for (const atlas of entry.atlases) {
      const variant = atlas.file.replace(/\.png$/, '.webp');
      const bytes = await readFile(`release-assets/fgui/${variant}`);
      const evidence = verification[atlas.file];
      if (evidence?.original !== atlas.sha256 || evidence.converted !== sha256(bytes)) {
        throw new Error(`Run prepare_player_media.py atlases to verify ${atlas.file}`);
      }
      files.set(`fgui/${variant}`, bytes);
      fgui.atlasFormats[atlas.file] = variant;
    }
  }
  files.set('fgui/fgui-manifest.json', Buffer.from(JSON.stringify(fgui)));

  const ui = JSON.parse((await read('runtime/ui/manifest.json')).toString()) as UiManifest;
  const words = ui.files['BaseWord_cn.lua']!;
  const raw = await read(`runtime/ui/${words.file}`);
  if (sha256(raw) !== words.sha256) throw new Error('BaseWord source changed');
  const uiInputs = Object.values({ ...ui.files, ...ui.platformModules }).filter(({ file }) => file !== words.file)
    .map(({ file }) => `runtime/ui/${file}`);
  const runtimeManifest = JSON.parse((await read('runtime/manifest.json')).toString()) as {
    files: Record<string, unknown>;
    fileCount: number;
    nativeModels?: {file: string; sha256: string};
  };
  // The rules-only browser and replay harness get their assets in the QA build.
  const playerRuntimeFiles = Object.fromEntries(Object.entries(runtimeManifest.files).filter(([path]) =>
    /^core-worker\/(?:inputs\/(?:lua\/|vendor\/(?:index\.js|glue\.wasm)$)|combat-prefix\/inputs\/(?!native-prefabs\.lua$)|skill-choice\/inputs\/choice-original-helpers\.lua$)/.test(path)));
  const runtimeInputs = Object.keys(playerRuntimeFiles).map(path => `runtime/${path}`);
  const wordInputs = [...uiInputs, ...runtimeInputs.filter(path => path.endsWith('.lua'))];
  const scripts = await Promise.all(wordInputs.map(async path => (await read(path)).toString('utf8')));
  for (const path of (await readdir('runtime/ui')).filter(path => path.endsWith('.ts'))) {
    let script = await readFile(`runtime/ui/${path}`, 'utf8');
    if (path === 'prelude.ts') {
      // The translator itself is the only approved table consumer. Changes to its
      // definition or other direct consumers trip the conservative fallback.
      script = script.replace(/^\/\/ proxies, Net, UIMgr, T, TableData.*$/m, '')
        .replace(/^function T\(id, \.\.\.\)\r?\n  local row = BaseWord_cn\[id\]$/m, '')
        .replace("error('T: missing word id: ' .. tostring(id))", '')
        .replace("error('T: word id has no text: ' .. tostring(id))", '');
    }
    scripts.push(script);
  }
  const compact = buildBaseWord(raw.toString('utf8'), scripts);
  const payload = Buffer.from(compact.payload);
  words.gzipFile = words.file + '.gz';
  words.rawFile = words.file.replace(/\.lua$/, '.player.lua');
  words.payloadSha256 = sha256(payload);
  files.set(`runtime/ui/${words.gzipFile}`, gzipSync(payload, { level: 9 }));
  files.set(`runtime/ui/${words.rawFile}`, payload);
  const wordClosure = { mode: compact.mode, rows: compact.rows, missingInOriginal: compact.missing };
  files.set('runtime/ui/manifest.json', Buffer.from(JSON.stringify({ ...ui, wordClosure })));
  console.log(`BaseWord: ${wordClosure.mode}, ${wordClosure.rows} rows, ${payload.length} uncompressed bytes`);

  if (!qa) {
    await Promise.all(['audio', 'effects', 'native', 'licenses'].map(copyTree));
    await Promise.all([...uiInputs, ...runtimeInputs].map(copy));
    runtimeManifest.files = playerRuntimeFiles;
    runtimeManifest.fileCount = Object.keys(playerRuntimeFiles).length;
  }

  // The Worker needs only sockets and animation timing before the chooser. The
  // display still reads the full original descriptors by itself before battle.
  const native = JSON.parse((await read('native/manifest.json')).toString()) as NativeManifest;
  const models = await Promise.all(native.prefabs.map(async (entry) => {
    const raw = await read(`native/${entry.json}`);
    if (sha256(raw) !== entry.jsonSha256) throw new Error(`Invalid native descriptor: ${entry.json}`);
    return [entry.container.toLowerCase(), readNativeModelMetadata(JSON.parse(raw.toString()))];
  }));
  const modelPayload = Buffer.from(JSON.stringify(Object.fromEntries(models)));
  const modelFile = 'native/player-models.json';
  files.set(modelFile, modelPayload);
  runtimeManifest.nativeModels = {file: modelFile, sha256: sha256(modelPayload)};
  files.set('runtime/manifest.json', Buffer.from(JSON.stringify(runtimeManifest)));

  const worker = await rolldown({ input: 'runtime/ui/host-worker.ts', platform: 'browser' });
  try {
    const output = await worker.generate({ format: 'iife', sourcemap: qa, minify: !qa, entryFileNames: 'ui-host-worker.js' });
    for (const item of output.output) files.set(item.fileName, Buffer.from(item.type === 'chunk' ? item.code : item.source));
  } finally {
    await worker.close();
  }

  const fingerprint = sha256([...files.keys()].sort().map(path => `${path} ${sha256(files.get(path)!)}\n`).join(''));
  const directory = qa ? 'assets/' : `assets/release-${fingerprint.slice(0, 24)}/`;
  return {
    directory,
    plugin: {
      name: 'starfall-player-assets',
      async writeBundle({ dir }) {
        await Promise.all([...files].map(async ([path, bytes]) => {
          const output = join(dir!, directory, path);
          await mkdir(dirname(output), { recursive: true });
          await writeFile(output, bytes);
        }));
      },
    },
  };
}

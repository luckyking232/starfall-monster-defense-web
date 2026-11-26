import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundle = await rolldown({ input: resolve(root, 'src/fgui/probe.ts'), platform: 'browser' });
const output = await bundle.generate({ format: 'esm', minify: true });
const file = output.output[0];
if (!file || file.type !== 'chunk') throw new Error('FGUI probe build failed');
for (const directory of ['public/assets', 'dist/assets']) {
  mkdirSync(resolve(root, directory), { recursive: true });
  writeFileSync(resolve(root, directory, 'fgui-probe.js'), file.code);
}

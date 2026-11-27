import { rolldown } from 'rolldown';

const bundle = await rolldown({
  input: 'src/engine/public-api.ts',
});
await bundle.write({
  file: 'dist-qa/assets/engine-public.js',
  format: 'esm',
  sourcemap: true,
});
await bundle.close();

const workerBundle = await rolldown({
  input: 'src/engine/worker.ts',
});
await workerBundle.write({
  file: 'dist-qa/assets/runtime-worker.js',
  format: 'iife',
  sourcemap: true,
});
await workerBundle.close();

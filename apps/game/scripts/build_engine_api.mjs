import { rolldown } from 'rolldown';

const bundle = await rolldown({
  input: 'src/engine/public-api.ts',
});
await bundle.write({
  file: 'public/assets/engine-public.js',
  format: 'esm',
  sourcemap: true,
});
await bundle.write({
  file: 'dist/assets/engine-public.js',
  format: 'esm',
  sourcemap: true,
});
await bundle.close();

const workerBundle = await rolldown({
  input: 'src/engine/worker.ts',
});
await workerBundle.write({
  file: 'public/assets/runtime-worker.js',
  format: 'iife',
  sourcemap: true,
});
await workerBundle.write({
  file: 'dist/assets/runtime-worker.js',
  format: 'iife',
  sourcemap: true,
});
await workerBundle.close();

import { existsSync } from 'node:fs';
import { rolldown } from 'rolldown';

const workerBundle = await rolldown({
  input: 'runtime/ui/host-worker.ts',
});
await workerBundle.write({
  file: 'public/assets/ui-host-worker.js',
  format: 'iife',
  sourcemap: true,
});
if (existsSync('dist')) {
  await workerBundle.write({
    file: 'dist/assets/ui-host-worker.js',
    format: 'iife',
    sourcemap: true,
  });
}
await workerBundle.close();

const clientBundle = await rolldown({
  input: 'src/ui/public-api.ts',
});
await clientBundle.write({
  file: 'public/assets/ui-client.js',
  format: 'esm',
  sourcemap: true,
});
if (existsSync('dist')) {
  await clientBundle.write({
    file: 'dist/assets/ui-client.js',
    format: 'esm',
    sourcemap: true,
  });
}
await clientBundle.close();

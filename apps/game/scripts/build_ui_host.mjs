import { rolldown } from 'rolldown';

const output = process.argv[2] ?? 'public';
if (output === 'public') {
  const workerBundle = await rolldown({ input: 'runtime/ui/host-worker.ts' });
  await workerBundle.write({
    file: 'public/assets/ui-host-worker.js',
    format: 'iife',
    sourcemap: true,
  });
  await workerBundle.close();
}

const clientBundle = await rolldown({
  input: 'src/ui/public-api.ts',
});
await clientBundle.write({
  file: `${output}/assets/ui-client.js`,
  format: 'esm',
  sourcemap: true,
});
await clientBundle.close();

import { defineConfig, type UserConfig } from 'vite';
import { playerAssets } from './scripts/build-player-assets.ts';
import { buildStageAssets } from './scripts/build-stage-assets.ts';
import { gameVersion } from './scripts/build-version.ts';

export default defineConfig(async ({ command, mode }): Promise<UserConfig> => {
  const qa = mode === 'qa';
  const [assets, stageAssets] = await Promise.all([
    command === 'build' ? playerAssets(qa) : undefined,
    buildStageAssets(),
  ]);
  return {
    plugins: [gameVersion(), assets?.plugin],
    publicDir: command === 'build' && !qa ? false : 'public',
    define: {
      __STARFALL_ASSET_DIRECTORY__: JSON.stringify(assets?.directory ?? 'assets/'),
      __STARFALL_STAGE_ASSETS__: JSON.stringify(stageAssets),
    },
    base: './',
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
    },
    preview: {
      host: '127.0.0.1',
      port: 4173,
      strictPort: true,
    },
    build: {
      outDir: qa ? 'dist-qa' : 'dist',
      target: 'es2022',
      sourcemap: qa,
      rollupOptions: {
        preserveEntrySignatures: 'strict',
      },
    },
    worker: {
      format: 'iife',
    },
  };
});

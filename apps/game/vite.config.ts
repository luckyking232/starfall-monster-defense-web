import { defineConfig } from 'vite';
import { gameVersion } from './scripts/build-version';

export default defineConfig({
  plugins: [gameVersion()],
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
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      preserveEntrySignatures: 'strict',
    },
  },
  worker: {
    format: 'iife',
  },
});

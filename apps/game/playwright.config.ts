import { defineConfig } from '@playwright/test';

const port = Number(process.env['STARFALL_TEST_PORT'] ?? 4173);
const archivedSite = process.env['STARFALL_TEST_BASE_URL'];
const url = archivedSite ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: url,
    browserName: 'chromium',
    ...(process.platform === 'win32' ? { channel: 'msedge' } : {}),
    launchOptions: {
      ...(process.platform === 'linux' ? {args:['--enable-unsafe-swiftshader']} : {}),
      ...(process.env['CHROME_PATH'] ? {executablePath:process.env['CHROME_PATH']} : {}),
    },
    viewport: { width: 1334, height: 750 },
    actionTimeout: 10000,
    trace: 'retain-on-failure',
  },
  webServer: archivedSite || process.env['STARFALL_ROLLOUT_NEW_DIST'] ? [] : {
    command: `npm run preview -- --mode qa --port ${port} --strictPort`,
    url,
    reuseExistingServer: !process.env['CI'],
    timeout: 120000,
  },
});

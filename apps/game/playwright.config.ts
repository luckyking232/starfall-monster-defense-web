import { defineConfig } from "@playwright/test"

const remotePreview = process.env.GAME_TEST_URL
const baseURL = remotePreview ?? "http://127.0.0.1:4175/preview/"
const proxy = process.env.GAME_TEST_PROXY

export default defineConfig({
  testDir: "./tests",
  testMatch: "*.spec.ts",
  fullyParallel: true,
  workers: 2,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    channel: process.env.PLAYWRIGHT_CHANNEL,
    proxy: proxy ? { server: proxy } : undefined,
    viewport: { width: 1280, height: 720 },
    trace: "retain-on-failure",
  },
  webServer: remotePreview ? undefined : {
    command: "node tests/serve-build.mjs",
    url: baseURL,
    timeout: 10_000,
  },
})

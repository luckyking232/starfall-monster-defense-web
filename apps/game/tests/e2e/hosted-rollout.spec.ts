import { expect, test } from '@playwright/test';
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { cp, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { openChooser, originalClick } from './navigation';

const run = promisify(execFile);
const retainScript = fileURLToPath(new URL('../../scripts/hosted-release.mjs', import.meta.url));
const currentRelease = process.env['STARFALL_ROLLOUT_NEW_DIST'];
const launchCases = [
  ['legacy assets at the domain root', process.env['STARFALL_ROLLOUT_LEGACY_DIST'], '/'],
  ['legacy assets at the Pages subpath', process.env['STARFALL_ROLLOUT_LEGACY_PAGES_DIST'], '/play/'],
  ['previous fingerprinted assets at the Pages subpath', process.env['STARFALL_ROLLOUT_PREVIOUS_DIST'], '/play/'],
] as const;
const mediaTypes: Record<string, string> = {
  '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.otf': 'font/otf',
  '.flac': 'audio/flac', '.wasm': 'application/wasm',
};

for (const [label, previousRelease, mount] of launchCases) {
  test(`an already-open tab reaches the first battle using ${label} after deployment`, async ({ page }, info) => {
    test.skip(!previousRelease || !currentRelease, 'Supply the old and new compiled release directories');
    test.setTimeout(120000);

    const candidate = await mkdtemp(join(tmpdir(), 'starfall-rollout-'));
    let deployed = previousRelease!;
    const server = createServer(async (request, response) => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (!url.pathname.startsWith(mount)) return response.writeHead(404).end();
      const relativePath = url.pathname.slice(mount.length) || 'index.html';
      const path = join(deployed, relativePath);
      try {
        const { size } = await stat(path);
        response.writeHead(200, {
          'content-type': mediaTypes[extname(path)] ?? 'application/octet-stream',
          'content-length': size,
          'cache-control': 'no-store',
        });
        createReadStream(path).pipe(response);
      } catch {
        response.writeHead(404, { 'cache-control': 'no-store' }).end();
      }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const site = `http://127.0.0.1:${(server.address() as AddressInfo).port}${mount}`;
    const afterSwap: { path: string; status: number }[] = [];
    let navigations = 0;
    try {
      await cp(currentRelease!, candidate, { recursive: true });
      const newRoot = (await readdir(join(candidate, 'assets'))).find(name => /^release-[a-f\d]{24}$/.test(name));
      expect(newRoot).toBeTruthy();
      expect(await readdir(join(previousRelease!, 'assets'))).not.toContain(newRoot);
      await page.addInitScript(() => {
        const state = { firstBattleFrame: 0 };
        Object.assign(window, { rolloutState: state });
        const WorkerClass = window.Worker;
        window.Worker = class extends WorkerClass {
          constructor(url: string | URL, options?: WorkerOptions) {
            super(url, options);
            this.addEventListener('message', ({ data }) => {
              if (data?.type === 'event' && data.event?.name === 'world') {
                state.firstBattleFrame = Math.max(state.firstBattleFrame, data.event.state.fixedFrame);
              }
            });
          }
        };
      });
      await page.goto(site);
      await expect(page.getByRole('region', { name: '魔物抵御战活动主页' })).toBeVisible({ timeout: 45000 });
      page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
      const { stdout } = await run(process.execPath, [retainScript, 'retain', candidate, site]);
      await info.attach('retention', { contentType: 'text/plain', body: stdout });
      console.log(stdout.trim());
      deployed = candidate;
      page.on('response', response => {
        const path = new URL(response.url()).pathname;
        if (path.startsWith(`${mount}assets/`)) afterSwap.push({ path, status: response.status() });
      });

      await openChooser(page);
      await originalClick(page, 145, 274);
      await expect(page.getByRole('region', { name: '魔物抵御战战场' })).toBeVisible({ timeout: 55000 });
      await expect.poll(() => page.evaluate(() =>
        (window as unknown as { rolloutState: { firstBattleFrame: number } }).rolloutState.firstBattleFrame),
      ).toBeGreaterThan(0);
      expect(navigations).toBe(0);
      expect(afterSwap.some(result => result.path.includes('/native/frames/'))).toBe(true);
      expect(afterSwap.filter(result => result.status !== 200)).toEqual([]);

      const freshPage = await page.context().newPage();
      const newRequests: string[] = [];
      freshPage.on('request', request => {
        const path = new URL(request.url()).pathname;
        if (path.includes('/fgui/') || path.includes('/runtime/')) newRequests.push(path);
      });
      try {
        await freshPage.goto(site);
        await expect(freshPage.getByRole('region', { name: '魔物抵御战活动主页' })).toBeVisible({ timeout: 45000 });
        expect(newRequests.length).toBeGreaterThan(0);
        expect(newRequests.filter(path => !path.startsWith(`${mount}assets/${newRoot}/`))).toEqual([]);
      } finally {
        await freshPage.close();
      }
    } finally {
      await info.attach('post-deploy-responses', { contentType: 'application/json', body: JSON.stringify(afterSwap) });
      server.close();
      server.closeAllConnections();
      await rm(candidate, { recursive: true, force: true });
    }
  });
}

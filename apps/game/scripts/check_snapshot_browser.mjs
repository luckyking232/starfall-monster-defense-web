import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

const [entry, reportPath] = process.argv.slice(2);
if (!entry || !reportPath) throw new Error('Usage: node scripts/check_snapshot_browser.mjs <local nested URL> <report.json>');
const base = new URL(entry);
if (base.hostname !== '127.0.0.1' || !base.pathname.endsWith('/') || base.pathname === '/') {
  throw new Error('Use a nested directory on the local preview server');
}
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
});
try {
  const context = await browser.newContext({ viewport: { width: 1334, height: 750 } });
  const page = await context.newPage();
  const errors = [];
  const responses = [];
  context.on('response', response => {
    const url = new URL(response.url());
    if (!['http:', 'https:'].includes(url.protocol)) return;
    responses.push({ path: url.pathname, status: response.status(), mime: response.headers()['content-type'] ?? '' });
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname) || response.status() >= 400)
      errors.push(response.status() + ' ' + url.href);
  });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base.href);
  const region = name => page.getByRole('region', { name, exact: true }).waitFor({ timeout: 45000 });
  async function tap(x, y) {
    const bounds = await page.locator('#app canvas:visible').last().boundingBox();
    if (!bounds) throw new Error('Missing visible game canvas');
    await page.mouse.click(bounds.x + x/1334*bounds.width, bounds.y + y/750*bounds.height);
  }
  await region('魔物抵御战活动主页');
  await tap(1147, 679);
  await region('选择关卡');
  await tap(145, 274);
  await region('魔物抵御战战场');
  const pause = page.getByRole('region', { name: '战斗暂停' });
  const deadline = Date.now() + 20000;
  while (!await pause.isVisible() && Date.now() < deadline) {
    await tap(163, 47);
    await pause.waitFor({ timeout: 750 }).catch(() => {});
  }
  await region('战斗暂停');
  const wasm = responses.find(item => item.path.endsWith('.wasm'));
  if (!wasm?.mime.startsWith('application/wasm')) errors.push('WASM response missing or served with incorrect MIME');
  if (!responses.some(item => item.path.endsWith('/mesh-effects.json'))) errors.push('Native mesh shader library was not loaded');
  const report = { page: base.href, reached: '战斗暂停', requests: responses.length, wasm, errors };
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}

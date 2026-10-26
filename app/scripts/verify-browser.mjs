import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const project = fileURLToPath(new URL('../', import.meta.url));
const dist = path.join(project, 'dist');
const assets = path.resolve(project, '../assets');
const resultsDir = path.join(project, 'test-results');
await mkdir(assets, { recursive: true });
await mkdir(resultsDir, { recursive: true });
if (!existsSync(path.join(dist, 'index.html'))) throw new Error('Run npm run build first.');

// Serve the production build under a repository-style subpath, as on GitHub Pages.
const prefix = '/buffer-commute/';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (!pathname.startsWith(prefix)) { response.writeHead(404).end(); return; }
    const relative = pathname.slice(prefix.length) || 'index.html';
    const filename = path.resolve(dist, relative);
    if (!filename.startsWith(dist + path.sep)) { response.writeHead(403).end(); return; }
    if (!(await stat(filename)).isFile()) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': mime[path.extname(filename)] ?? 'application/octet-stream' });
    response.end(await readFile(filename));
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;
const baseURL = origin + prefix;
const checks = [];
let browser;
const check = name => { checks.push(name); console.log(`PASS ${name}`); };
try {
  const options = { headless: true };
  if (!existsSync(chromium.executablePath()) && process.platform === 'win32') {
    const root = path.join(homedir(), 'AppData/Local/ms-playwright');
    const candidate = readdirSync(root).filter(name => /^chromium-\d+$/.test(name)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1])).map(name => path.join(root, name, 'chrome-win64/chrome.exe')).find(existsSync);
    if (candidate) options.executablePath = candidate;
  }
  browser = await chromium.launch(options);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1, locale: 'en-GB' });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await context.newPage();
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => requests.push({ url: request.url(), method: request.method() }));
  page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
  assert.equal((await page.goto(baseURL)).status(), 200);
  await page.getByTestId('departure-time').waitFor();
  assert.match(await page.title(), /Buffer/);
  assert.equal(await page.getByTestId('departure-time').innerText(), '08:15');
  check('Production build loads under a repository subpath; default plan is Metro 08:15');
  await page.screenshot({ path: path.join(assets, 'buffer-desktop.png'), fullPage: true });
  await page.screenshot({ path: path.join(assets, 'buffer-submission.png') });
  await page.getByRole('button', { name: '80%', exact: true }).click();
  assert.equal(await page.getByTestId('departure-time').innerText(), '08:19');
  assert.match(await page.locator('.result-route').innerText(), /Riverside bus/);
  await page.getByRole('button', { name: '95%', exact: true }).click();
  assert.equal(await page.getByTestId('departure-time').innerText(), '08:13');
  await page.getByRole('button', { name: '100%', exact: true }).click();
  assert.equal(await page.getByTestId('departure-time').innerText(), '08:11');
  check('Coverage buttons recompute both departure and recommended route');
  await page.getByRole('button', { name: '90%', exact: true }).click();
  await page.getByRole('button', { name: 'Choose Riverside bus', exact: true }).click();
  assert.equal(await page.getByTestId('departure-time').innerText(), '08:03');
  check('Manual route selection updates the chosen plan');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download plan', exact: true }).click();
  const download = await downloadEvent;
  const downloadedFile = path.join(resultsDir, 'buffer-plan.txt');
  await download.saveAs(downloadedFile);
  const exported = await readFile(downloadedFile, 'utf8');
  assert.match(exported, /Riverside bus/); assert.match(exported, /08:03/); assert.match(exported, /Synthetic demo/);
  check('Downloaded plan matches the actual selection and preserves data provenance');
  await page.getByRole('button', { name: 'Copy plan', exact: true }).click();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /Route: Riverside bus/);
  check('Copy plan writes the selected plan to the clipboard');
  await page.getByLabel('Extra buffer in minutes', { exact: true }).fill('-1');
  await page.getByRole('heading', { name: 'Let’s finish your plan.' }).waitFor();
  assert.equal(await page.getByTestId('departure-time').count(), 0);
  check('Invalid inputs clear the plan instead of leaving stale output');
  await page.getByRole('button', { name: 'Reset demo', exact: true }).click();
  await page.getByLabel('Arrive by', { exact: true }).fill('00:10');
  assert.equal(await page.getByTestId('departure-time').innerText(), '23:25 (previous day)');
  check('Cross-midnight departure names the previous day');
  await page.getByRole('button', { name: 'Reset demo', exact: true }).click();
  const csv = 'route,minutes\nBus,20\nBus,22\nBus,24\nBus,28\nBus,30\nRail,21\nRail,22\nRail,23\nRail,24\nRail,25\n';
  await page.getByLabel('Import trip CSV', { exact: true }).setInputFiles({ name: 'my-trips.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByText('Your local CSV', { exact: true }).waitFor();
  assert.equal(await page.getByTestId('departure-time').innerText(), '08:30');
  assert.match(await page.locator('.result-route').innerText(), /Rail/);
  assert.equal(await page.locator('.route-card').count(), 2);
  check('Local CSV replaces demo data and recalculates a different recommendation');
  await page.getByLabel('Import trip CSV', { exact: true }).setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from('route,minutes\nBus,NaN') });
  await page.getByRole('alert').filter({ hasText: 'whole number' }).waitFor();
  assert.equal(await page.getByTestId('departure-time').innerText(), '08:30');
  check('Malformed CSV shows an error and keeps the last valid data');
  await page.reload(); await page.getByTestId('departure-time').waitFor();
  assert.equal(await page.getByTestId('departure-time').innerText(), '08:15');
  check('Reload clears imported history and restores the synthetic demo');
  await context.setOffline(true);
  await page.getByRole('button', { name: '80%', exact: true }).click();
  assert.equal(await page.getByTestId('departure-time').innerText(), '08:19');
  await context.setOffline(false);
  check('Planning works without a network after the page has loaded');
  await page.getByRole('button', { name: 'Reset demo', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: path.join(assets, 'buffer-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: '80%', exact: true }).click();
  assert.equal(await page.getByTestId('departure-time').innerText(), '08:19');
  check('390px mobile layout has no horizontal overflow and controls remain functional');
  await page.setViewportSize({ width: 320, height: 740 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  check('320px narrow layout also fits the viewport');
  assert.deepEqual(errors, []);
  assert.equal(requests.filter(request => request.method !== 'GET' || !request.url.startsWith(origin)).length, 0);
  check('No browser errors, failed requests, external assets or upload requests');
  const report = { checkedAt: new Date().toISOString(), basePath: prefix, browserVersion: browser.version(), checks, browserErrors: errors, requestCount: requests.length, externalRequests: 0, uploadRequests: 0 };
  await writeFile(path.join(resultsDir, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`${checks.length} browser checks passed. Screenshots: ../assets/`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { _electron } from 'playwright-core';

// Browser proof against the real dashboard HTML and a loopback owner-API fixture.
// No host, production service, private credentials or desktop controls are used.
const compiled = await build({ entryPoints: ['relay/src/dashboard.ts'], write: false, bundle: true, format: 'esm', platform: 'node', target: 'es2022' });
const { dashboardHtml } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const token = randomBytes(32).toString('base64url');
const host = 'phone-smoke-only';
const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=';
const requests = [], fixtureErrors = [];
let state = { mode: 'off', hostOnline: true, activeBot: null, schedule: null, schedulePending: false, expiresAt: null, liveEndsAt: null };
const server = createServer(async (request, response) => {
  try {
    if (request.url === '/control/' + host && request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(dashboardHtml(host)); return;
    }
    if (request.url === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    assert.equal(request.headers.authorization, 'Bearer ' + token);
    assert.match(request.headers['x-request-id'], /^[a-f0-9-]{36}$/);
    assert.ok(request.url.startsWith('/api/owner/' + host + '/'));
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
    const route = request.url.split('/').at(-1); requests.push({ route, body });
    let result;
    if (route === 'status' && request.method === 'GET') result = state;
    else if (route === 'state' && request.method === 'POST') {
      assert.ok(['armed', 'paused', 'off'].includes(body.mode));
      assert.equal(body.minutes, 480);
      const expiresAt = body.mode === 'armed' ? Date.now() + 480 * 60_000 : null;
      state = { ...state, mode: body.mode, schedule: null, schedulePending: false, expiresAt, liveEndsAt: expiresAt };
      result = { ...state, confirmed: true };
    } else if (route === 'schedule' && request.method === 'POST') {
      assert.equal(typeof body.startsAt, 'number'); assert.equal(typeof body.endsAt, 'number');
      assert.equal(body.endsAt - body.startsAt, 12 * 3600_000);
      state = { ...state, mode: 'off', schedule: body, schedulePending: true, expiresAt: null, liveEndsAt: null };
      result = state;
    } else if (route === 'command' && request.method === 'POST') {
      assert.equal(body.name, 'screenshot'); assert.deepEqual(body.args, {});
      result = { ok: true, result: { snapshotId: 'synthetic-phone-preview', image: { mimeType: 'image/png', data: pixel, width: 1, height: 1 }, window: { title: 'Synthetic preview only' } } };
    } else throw new Error('Unexpected fixture route');
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(result));
  } catch (error) {
    fixtureErrors.push(error.message); response.writeHead(400, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: 'phone-fixture-validation-failed' }));
  }
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'botdesk-phone-proof-'));
const env = { ...process.env, BOTDESK_TEST_DATA: directory, BOTDESK_PHONE_TEST_URL: `http://127.0.0.1:${server.address().port}/control/${host}#${token}` };
delete env.ELECTRON_RUN_AS_NODE;
let electron;
try {
  electron = await _electron.launch({ executablePath: path.resolve('node_modules/electron/dist/electron.exe'), args: ['scripts/phone-dashboard-fixture.mjs'], env, timeout: 30_000 });
  const page = await electron.firstWindow();
  await page.setViewportSize({ width: 390, height: 844 });
  const pageErrors = []; page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.waitForFunction(() => document.querySelector('#mode')?.textContent === 'OFF');
  const screen = await page.evaluate(() => ({ width: innerWidth, fullWidth: document.documentElement.scrollWidth }));
  assert.equal(screen.width, 390); assert.ok(screen.fullWidth <= 390, 'Phone layout must not scroll horizontally');
  const start = await page.locator('#schedule-start').inputValue();
  const end = await page.locator('#schedule-end').inputValue();
  assert.match(start, /T06:00$/); assert.match(end, /T18:00$/);
  assert.equal(start.slice(0, 10), end.slice(0, 10));
  assert.ok(new Date(start).getTime() > Date.now());
  assert.equal(new Date(end).getTime() - new Date(start).getTime(), 12 * 3600_000);
  assert.match(await page.locator('#timezone').textContent(), /^Times on this phone: .+/);
  assert.equal(await page.locator('#preview').isDisabled(), true);

  await page.locator('[data-action="armed"]').click();
  await page.waitForFunction(() => document.querySelector('#mode').textContent === 'LIVE');
  assert.ok(requests.some((request) => request.route === 'state' && request.body.mode === 'armed' && request.body.minutes === 480));
  assert.match(await page.locator('#countdown').textContent(), /^Live for /);
  await page.locator('#preview').click();
  await page.waitForFunction(() => document.querySelector('#screen').naturalWidth === 1 && document.querySelector('#screen').style.display === 'block', null, { timeout: 10_000 });
  assert.match(await page.locator('#preview-time').textContent(), /^Captured /);
  await page.locator('[data-action="paused"]').click();
  await page.waitForFunction(() => document.querySelector('#mode').textContent === 'PAUSED');
  assert.equal(await page.locator('#screen').getAttribute('src'), null);

  const invalidEnd = await page.evaluate((value) => {
    const d = new Date(value); d.setHours(d.getHours() + 13); return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  }, start);
  await page.locator('#schedule-end').fill(invalidEnd);
  const beforeInvalid = requests.filter((request) => request.route === 'schedule').length;
  await page.locator('#save-schedule').click();
  await page.waitForFunction(() => document.querySelector('#alert').textContent.includes('within 12 hours'));
  assert.equal(requests.filter((request) => request.route === 'schedule').length, beforeInvalid);
  await page.locator('#schedule-end').fill(end);
  await page.locator('#save-schedule').click();
  await page.waitForFunction(() => document.querySelector('#mode').textContent === 'SCHEDULED');
  assert.match(await page.locator('#schedule-detail').textContent(), /^Saved:/);
  assert.match(await page.locator('#countdown').textContent(), /^Starts in /);
  assert.equal(state.schedule.endsAt - state.schedule.startsAt, 12 * 3600_000);
  await page.evaluate(() => scrollTo(0, 0));
  await fs.mkdir('evidence', { recursive: true });
  const screenshotPath = path.resolve('evidence/phone-schedule.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });

  await page.locator('[data-action="off"]').click();
  await page.waitForFunction(() => document.querySelector('#mode').textContent === 'OFF');
  assert.equal(state.schedule, null); assert.equal(state.schedulePending, false);
  const isolated = await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every((window) => { const preferences = window.webContents.getLastWebPreferences(); return !window.isVisible() && preferences.sandbox && preferences.contextIsolation && !preferences.nodeIntegration; }));
  assert.equal(isolated, true);
  assert.deepEqual(pageErrors, []); assert.deepEqual(fixtureErrors, []);
  const result = { ok: true, viewportWidth: 390, checks: ['no-horizontal-overflow', 'next-6am-to-6pm-defaults', 'phone-timezone-displayed', 'eight-hour-go-live', 'nested-target-image-preview', 'pause-clears-preview', 'over-12-hour-schedule-rejected', 'schedule-save-and-countdown', 'stop-cancels-schedule', 'hidden-sandboxed-window'], screenshot: 'evidence/phone-schedule.png', source: 'Synthetic loopback owner API; no desktop capture or production connection' };
  await fs.writeFile('evidence/phone-schedule-smoke.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {
  await electron?.close();
  server.closeAllConnections(); await new Promise((done) => server.close(done));
  assert.equal(path.dirname(directory), path.resolve(os.tmpdir())); await fs.rm(directory, { recursive: true, force: true });
}

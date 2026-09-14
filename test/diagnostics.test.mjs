import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildDiagnosticReport, readRecentAudit, redactReport, renderDiagnosticReport } from '../host/diagnostics.mjs';
import { AuditLog } from '../host/audit-log.mjs';

const token = (seed) => seed.padEnd(43, 'x');
const config = { relayUrl: 'https://relay.example.test', hostId: 'pc-0123456789abcdef01234567', hostToken: token('host-secret-'), ownerToken: token('owner-secret-'), botToken: token('bot-secret-'), allowRemoteArm: false, startAtLogin: false, allowedApps: ['msedge', 'notepad'] };

test('rendered report never contains pairing secrets, DPAPI blobs, bearer values or owner-link fragments', () => {
  const status = {
    mode: 'off', stopLatched: false, targetWindow: { processName: 'msedge', title: 'Private tab about ' + config.ownerToken, integrity: 'medium', desktop: 'default', automationChecked: true, geometry: { x: 1, y: 2, width: 800, height: 600 } },
    relay: { connected: false, authenticated: false, reason: 'unauthorized', httpStatus: 401, attempts: 3, nextRetryAt: Date.now() + 8000, closeReason: 'Bearer ' + config.hostToken }
  };
  const audit = [{ time: '2026-09-14T00:00:00.000Z', botId: 'bot', command: 'type', outcome: 'ok', app: 'notepad ' + config.botToken }];
  const text = renderDiagnosticReport({ config, status, audit, paths: { userData: 'C:\\Users\\owner\\AppData\\Roaming\\botdesk', home: 'C:\\Users\\owner' }, extraSecrets: ['dpapi:QUJDREVGR0hJSktMTU5PUA=='] });
  for (const secret of [config.hostToken, config.ownerToken, config.botToken, 'Private tab', 'C:\\Users\\owner', 'Users\\\\owner']) assert.equal(text.includes(secret), false, secret);
  assert.match(text, /"hostToken": "saved"/);
  assert.match(text, /"userData": "~\\\\AppData\\\\Roaming\\\\botdesk"/);
  assert.match(text, /"label": "Rejected by relay"/);
  assert.match(text, /"retry": "Next attempt in \ds \(attempt 3\)\."/);
  assert.match(text, /"processName": "msedge"/);
  assert.equal(text.includes('"title"'), false);
  const parsed = JSON.parse(text);
  assert.equal(parsed.configuration.relayUrl, config.relayUrl);
  assert.equal(parsed.configuration.hostId, config.hostId);
  assert.ok(parsed.notes.some((note) => note.includes('Rejected by relay')));
  assert.ok(parsed.notes.some((note) => note.includes('remote-arm-disabled')));
});

test('redaction removes token-shaped strings, bearer headers, fragments and home paths on both slash styles', () => {
  const home = '/home/owner';
  const out = redactReport(`token=${'A'.repeat(43)} link=https://r.example/control/pc-1#${'b'.repeat(43)} Authorization: Bearer abc.def dpapi:AAAA==== id=pc-0123456789abcdef01234567 uuid=3f2504e0-4f89-11d3-9a0c-0305e82c3301 file=${home}/x and /home/owner\\y`, { home });
  assert.equal(out.includes('A'.repeat(43)), false);
  assert.equal(out.includes('b'.repeat(43)), false);
  assert.match(out, /Bearer \[redacted\]/);
  assert.match(out, /dpapi:\[redacted\]/);
  assert.match(out, /id=pc-0123456789abcdef01234567/, 'host ids remain readable');
  assert.match(out, /uuid=3f2504e0-4f89-11d3-9a0c-0305e82c3301/, 'uuids remain readable');
  assert.equal(out.includes('/home/owner'), false);
  assert.match(out, /file=~\/x and ~\\y/);
  assert.equal(redactReport(null), '');
  assert.equal(redactReport('short', { secrets: ['x'] }), 'short', 'tiny secrets are ignored rather than shredding text');
});

test('report lists concrete blockers for an unpaired, unselected, latched host and a failed helper', () => {
  const report = buildDiagnosticReport({ config: { relayUrl: '', hostId: '', hostToken: '', ownerToken: '' }, status: { mode: 'off', stopLatched: true, relay: { reason: 'setup-required' } }, helper: { ok: false, error: 'windows-helper-failed', message: 'PowerShell exited (windows-helper-failed)' }, prerequisites: { credentialEncryption: true, emergencyShortcutRegistered: false } });
  const joined = report.notes.join('\n');
  assert.match(joined, /Pairing is incomplete/);
  assert.match(joined, /Windows helper: PowerShell exited/);
  assert.match(joined, /local stop is latched/);
  assert.match(joined, /select-a-window-first/);
  assert.match(joined, /Ctrl\+Shift\+F12/);
  assert.equal(report.configuration.hostToken, 'missing');
  assert.equal(report.prerequisites.windowsHelper.ok, false);
  const healthy = buildDiagnosticReport({ config: { ...config, allowRemoteArm: true }, status: { mode: 'armed', expiresAt: Date.now() + 1000, targetWindow: { processName: 'notepad' }, relay: { connected: true, authenticated: true } }, helper: { ok: true }, prerequisites: { credentialEncryption: true, emergencyShortcutRegistered: true } });
  assert.deepEqual(healthy.notes.map((note) => note.slice(0, 26)), ['No setup blockers detected']);
  assert.equal(healthy.connection.label, 'Securely connected');
});

test('recent audit reads only the newest file tail and tolerates missing directories', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'botdesk-diag-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  assert.deepEqual(readRecentAudit(path.join(directory, 'missing')), []);
  assert.deepEqual(readRecentAudit(directory), []);
  const log = new AuditLog(directory);
  for (let index = 0; index < 30; index++) log.write({ botId: 'bot', command: 'click', outcome: 'ok-' + index, app: 'notepad' });
  fs.writeFileSync(path.join(directory, 'audit-2000-01-01.jsonl'), '{"outcome":"ancient"}\n');
  fs.writeFileSync(path.join(directory, 'notes.txt'), 'ignored');
  const recent = readRecentAudit(directory, 5);
  assert.equal(recent.length, 5);
  assert.equal(recent.at(-1).outcome, 'ok-29');
  assert.equal(recent.some((entry) => entry.outcome === 'ancient'), false);
  assert.deepEqual(Object.keys(recent[0]), ['time', 'botId', 'command', 'outcome', 'app']);
});

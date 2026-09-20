import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { validateToolArgs, createRelayClient } from '../mcp/server.mjs';
import { runWindowsAction } from '../host/windows.mjs';

const valid = { snapshotId: 'fresh', points: [{ x: 0, y: 0 }, { x: 40, y: 80 }], durationMs: 300 };
function childFixture() {
  const child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.kills = 0; child.input = '';
  child.stdin.on('data', (chunk) => { child.input += chunk; });
  child.kill = () => { child.kills++; queueMicrotask(() => child.emit('close', 1)); };
  return child;
}
function helperFixture() {
  const children = [], options = [];
  return { children, options, spawnImpl(command, argv, opts) { const child = childFixture(); children.push(child); options.push({ command, argv, ...opts }); return child; } };
}

test('drag SDK rejects malformed path, duration and nested additions before network', async () => {
  assert.equal(validateToolArgs('botdesk_drag', valid), 'drag');
  let requests = 0;
  const client = createRelayClient({ relayUrl: 'https://fixture.invalid', hostId: 'fixture', botToken: 'fixture-token-long-enough' }, () => { requests++; throw new Error('unexpected network'); });
  const invalid = [
    { ...valid, snapshotId: undefined }, { ...valid, snapshotId: '' }, { ...valid, x: 0 },
    { ...valid, points: {} }, { ...valid, points: [] }, { ...valid, points: [valid.points[0]] },
    { ...valid, points: Array.from({ length: 65 }, (_, x) => ({ x, y: 0 })) },
    ...[null, [], { x: 0 }, { x: 0, y: 0, script: 'x' }, { x: -1, y: 1 }, { x: 32768, y: 0 }, { x: 0.5, y: 0 }, { x: 0, y: NaN }].map((point) => ({ ...valid, points: [point, valid.points[1]] })),
    { ...valid, points: [{ x: 1, y: 1 }, { x: 1, y: 1 }] },
    ...[99, 2001, 200.5, '300', NaN].map((durationMs) => ({ ...valid, durationMs }))
  ];
  for (const args of invalid) await assert.rejects(client('botdesk_drag', args), (error) => !error.message.includes('unexpected network'));
  assert.equal(requests, 0);
});

test('drag keeps cancellation channel open and resolves only after native release and exit', async () => {
  const f = helperFixture(), abort = new AbortController();
  let done = false;
  const result = runWindowsAction('drag', valid, { spawnImpl: f.spawnImpl, signal: abort.signal }).then((value) => { done = true; return value; });
  const child = f.children[0];
  assert.deepEqual(JSON.parse(child.input), { action: 'drag', args: valid });
  assert.equal(child.stdin.writableEnded, false);
  child.stdout.write('{"dragProgress":"button-held"}\n');
  abort.abort(); await delay(5);
  assert.equal(done, false); assert.ok(child.input.endsWith('cancel\n')); assert.equal(child.kills, 0);
  child.stdout.write('{"dragProgress":"button-released"}\n{"ok":false,"error":"drag-cancelled"}\n');
  assert.equal(done, false);
  child.emit('close', 0);
  assert.equal((await result).error, 'windows-helper-aborted');
  assert.equal(f.children.length, 1);
  assert.equal(f.options[0].shell, false); assert.equal(f.options[0].windowsHide, true);
});

test('forced drag termination waits for process exit then awaits internal button-up helper', async () => {
  const f = helperFixture(), abort = new AbortController(); let done = false;
  const result = runWindowsAction('drag', valid, { spawnImpl: f.spawnImpl, signal: abort.signal }).then((value) => { done = true; return value; });
  const child = f.children[0]; child.stdout.write('{"dragProgress":"button-held"}\n');
  child.kill = () => { child.kills++; };
  abort.abort(); await delay(280);
  assert.equal(child.kills, 1); assert.equal(f.children.length, 1); assert.equal(done, false);
  child.emit('close', 1); await delay(0);
  assert.equal(f.children.length, 2); assert.equal(done, false);
  const cleanup = f.children[1]; assert.deepEqual(JSON.parse(cleanup.input), { action: 'release_left', args: {} });
  cleanup.stdout.end('{"ok":true}'); cleanup.emit('close', 0);
  assert.equal((await result).error, 'windows-helper-aborted');
});

test('a crashed drag also releases; release failure is never reported as successful STOP', async () => {
  const f = helperFixture();
  const result = runWindowsAction('drag', valid, { spawnImpl: f.spawnImpl });
  const child = f.children[0]; child.stdout.write('{"dragProgress":"button-held"}\n'); child.emit('close', 1); await delay(0);
  f.children[1].stdout.end('{"ok":false,"error":"input-incomplete"}'); f.children[1].emit('close', 0);
  assert.equal((await result).error, 'windows-drag-release-unconfirmed');
});

test('completed or pre-input rejected drag never emits extra mouse-up; raw release is unavailable', async () => {
  for (const lines of ['{"ok":false,"error":"point-obscured"}\n', '{"dragProgress":"button-held"}\n{"dragProgress":"button-released"}\n{"ok":true}\n']) {
    const f = helperFixture(); const result = runWindowsAction('drag', valid, { spawnImpl: f.spawnImpl });
    f.children[0].stdout.write(lines); f.children[0].emit('close', 0);
    const value = await result; assert.equal(typeof value.ok, 'boolean'); assert.equal(f.children.length, 1);
  }
  const f = helperFixture();
  assert.equal((await runWindowsAction('release_left', {}, { spawnImpl: f.spawnImpl })).error, 'unknown-action');
  assert.equal(f.children.length, 0);
});

test('drag native startup timeout takes the cancellation path without leaving an input helper alive', async () => {
  const f = helperFixture(); const result = runWindowsAction('drag', valid, { spawnImpl: f.spawnImpl, timeoutMs: 5 });
  assert.equal((await result).error, 'windows-helper-timeout'); assert.equal(f.children[0].kills, 1); assert.equal(f.children.length, 1);
});

test('an unconfirmed helper exit is a safety fault; no cleanup races a possibly live drag', async () => {
  const f = helperFixture(), abort = new AbortController();
  const result = runWindowsAction('drag', valid, { spawnImpl: f.spawnImpl, signal: abort.signal });
  const child = f.children[0]; child.kill = () => { child.kills++; };
  child.stdout.write('{"dragProgress":"button-held"}\n'); abort.abort();
  assert.equal((await result).error, 'windows-drag-stop-unconfirmed');
  assert.equal(f.children.length, 1); assert.equal(child.kills, 1);
});

test('STOP arriving during emergency cleanup cannot start a second release or settle early', async () => {
  const f = helperFixture(), abort = new AbortController(); let done = false;
  const result = runWindowsAction('drag', valid, { spawnImpl: f.spawnImpl, signal: abort.signal }).then((value) => { done = true; return value; });
  const child = f.children[0]; child.stdout.write('{"dragProgress":"button-held"}\n'); child.emit('close', 1); await delay(0);
  abort.abort(); await delay(5);
  assert.equal(f.children.length, 2); assert.equal(done, false); assert.equal(child.kills, 0);
  f.children[1].stdout.end('{"ok":true}'); f.children[1].emit('close', 0);
  assert.equal((await result).error, 'windows-helper-aborted');
});

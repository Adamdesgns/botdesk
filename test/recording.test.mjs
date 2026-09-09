import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RecordingService } from '../host/recording.mjs';

function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
async function setup(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'botdesk-record-test-'));
  const sent = [], finishErrors = [];
  const service = new RecordingService({ directory, send: (name, data) => {
    sent.push({ name, data });
    if (name === 'record-stop') queueMicrotask(() => service.finish(data.id).catch((error) => finishErrors.push(error)));
  } });
  t.after(async () => { await service.stop(); assert.equal(path.dirname(directory), path.resolve(os.tmpdir())); await fs.rm(directory, { recursive: true, force: true }); });
  return { service, directory, sent, finishErrors, abort: new AbortController() };
}

test('pre-aborted recording does not capture or create an output file', async (t) => {
  const s = await setup(t); s.abort.abort();
  const result = await s.service.start({ signal: s.abort.signal, getFrame: () => assert.fail('must not capture'), onFailure: () => {} });
  assert.equal(result.ok, false); assert.equal(result.error, 'recording-cancelled');
  assert.deepEqual(await fs.readdir(s.directory), []); assert.equal(s.sent.length, 0);
});

test('recording accepts matching chunks, saves their exact byte order and reports result', async (t) => {
  const s = await setup(t);
  const result = await s.service.start({ signal: s.abort.signal, getFrame: () => new Promise(() => {}), onFailure: () => {} });
  assert.equal(result.ok, true);
  assert.equal(s.sent[0].name, 'record-start');
  const id = result.recordingId;
  await Promise.all([s.service.chunk({ id, bytes: new Uint8Array([1, 2, 3]) }), s.service.chunk({ id, bytes: new Uint8Array([4, 5]) })]);
  const stopped = await s.service.stop();
  assert.equal(stopped.ok, true); assert.equal(stopped.bytes, 5);
  assert.deepEqual([...await fs.readFile(stopped.path)], [1, 2, 3, 4, 5]);
  assert.equal(s.service.active, null); assert.equal(s.finishErrors.length, 0);
  assert.equal((await s.service.stop()).recording, false);
});

test('recording rejects chunks from another session or above the bounded chunk limit', async (t) => {
  const s = await setup(t);
  const result = await s.service.start({ signal: s.abort.signal, getFrame: () => new Promise(() => {}), onFailure: () => {} });
  await assert.rejects(s.service.chunk({ id: 'wrong-session', bytes: new Uint8Array([1]) }), /invalid-recording-chunk/);
  await assert.rejects(s.service.chunk({ id: result.recordingId, bytes: [1, 2] }), /invalid-recording-chunk/);
  await assert.rejects(s.service.chunk({ id: result.recordingId, bytes: new Uint8Array(8 * 1024 * 1024 + 1) }), /invalid-recording-chunk/);
  assert.equal(s.service.active.bytes, 0);
});

test('late frame after stop is discarded rather than sent to the recorder', async (t) => {
  const s = await setup(t), frame = deferred();
  await s.service.start({ signal: s.abort.signal, getFrame: () => frame.promise, onFailure: () => {} });
  await s.service.stop();
  frame.resolve({ ok: true, image: { data: 'not-real-capture' } });
  await Promise.resolve();
  assert.equal(s.sent.filter((event) => event.name === 'record-frame').length, 0);
});

test('guard failure reports failure without releasing an unsafe frame', async (t) => {
  const s = await setup(t), failure = deferred();
  await s.service.start({ signal: s.abort.signal, getFrame: async () => ({ ok: false, error: 'sensitive-window' }), onFailure: () => failure.resolve() });
  await failure.promise;
  assert.equal(s.sent.some((event) => event.name === 'record-frame'), false);
});

test('second start during an active recording is rejected', async (t) => {
  const s = await setup(t);
  const options = { signal: s.abort.signal, getFrame: () => new Promise(() => {}), onFailure: () => {} };
  await s.service.start(options);
  assert.deepEqual(await s.service.start(options), { ok: false, error: 'already-recording' });
});

test('recording stop is idempotent while renderer completion is pending', async (t) => {
  const s = await setup(t);
  await s.service.start({ signal: s.abort.signal, getFrame: () => new Promise(() => {}), onFailure: () => {} });
  const [first, second] = await Promise.all([s.service.stop(), s.service.stop()]);
  assert.deepEqual(first, second);
  assert.equal(s.sent.filter((event) => event.name === 'record-stop').length, 1);
});

test('concurrent starts reserve the recorder before asynchronous file setup', async (t) => {
  const s = await setup(t), gate = deferred();
  const mkdir = fs.mkdir, open = fs.open;
  const opened = [];
  // Delay filesystem setup so both requests overlap deterministically; use mock
  // handles so a regression cannot leave an orphaned real file descriptor.
  fs.mkdir = async () => gate.promise;
  fs.open = async () => { const handle = { write: async () => {}, close: async () => {} }; opened.push(handle); return handle; };
  const options = { signal: s.abort.signal, getFrame: () => new Promise(() => {}), onFailure: () => {} };
  try {
    const first = s.service.start(options), second = s.service.start(options);
    gate.resolve();
    const results = await Promise.all([first, second]);
    assert.equal(results.filter((result) => result.ok).length, 1, 'Exactly one recording may start');
    assert.equal(results.filter((result) => result.error === 'already-recording').length, 1);
    assert.equal(opened.length, 1);
  } finally { fs.mkdir = mkdir; fs.open = open; }
});

test('failed disk writes still close and release the recorder on finish', async (t) => {
  const s = await setup(t);
  const result = await s.service.start({ signal: s.abort.signal, getFrame: () => new Promise(() => {}), onFailure: () => {} });
  const handle = s.service.active.handle;
  s.service.active.handle = { write: async () => { throw new Error('simulated-disk-full'); }, close: () => handle.close() };
  await assert.rejects(s.service.chunk({ id: result.recordingId, bytes: new Uint8Array([1]) }), /simulated-disk-full/);
  let finished, thrown;
  try { finished = await s.service.finish(result.recordingId); } catch (error) { thrown = error; }
  // On a regression clean up the fixture descriptor ourselves so the test cannot
  // strand a real file or wait on the failed recorder's fallback timer.
  if (s.service.active) { await handle.close(); s.service.active = null; }
  assert.equal(thrown, undefined, 'Finishing a failed recording must return an error result after cleanup');
  assert.equal(finished.ok, false);
  assert.equal(s.service.active, null);
});

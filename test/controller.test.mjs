import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { HostController } from '../host/controller.mjs';

const target = () => ({ handle: '1001', processId: 123, processName: 'msedge', title: 'Ordinary test page', integrity: 'medium', desktop: 'default', automationChecked: true, passwordFocused: false, passwordPresent: false, geometry: { x: -200, y: 20, width: 1000, height: 600 } });
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }

function setup(t, config = {}) {
  let now = 1000;
  let foreground = target();
  const events = [], calls = [];
  const settings = { allowRemoteArm: false, allowedApps: ['msedge'], ...config };
  const executor = {
    foreground: async () => structuredClone(foreground),
    run: async (name, args, options) => { calls.push({ name, args, options }); return { ok: true, window: structuredClone(foreground) }; },
    recordStart: async () => ({ ok: true }),
    recordStop: async () => ({ ok: true, recording: false })
  };
  const controller = new HostController({ configStore: { load: () => settings }, auditLog: { write: (entry) => events.push(entry) }, executor, clock: () => now });
  t.after(() => controller.setMode('off'));
  const command = (name, args = {}, options = {}) => ({ name, args, commandId: randomUUID(), expiresAt: now + 20_000, controlGeneration: 1, botId: 'tester-1', ...options });
  const arm = () => { controller.selectTarget(target()); controller.setMode('armed', { minutes: 5, generation: 1 }); };
  const capture = async (botId = 'tester-1') => {
    const result = await controller.runCommand(command('screenshot', {}, { botId }));
    assert.equal(result.ok, true, JSON.stringify(result));
    return result.result.snapshotId;
  };
  return { controller, executor, settings, events, calls, command, arm, capture, advance: (ms) => { now += ms; }, changeWindow: (update) => { foreground = { ...foreground, ...update }; } };
}

test('controller starts off; target selection and an armed session are required', async (t) => {
  const s = setup(t);
  assert.equal(s.controller.getStatus().mode, 'off');
  assert.throws(() => s.controller.setMode('armed'), /select-a-window-first/);
  assert.equal((await s.controller.runCommand(s.command('screenshot'))).ok, false);
  s.arm();
  const snapshotId = await s.capture();
  const result = await s.controller.runCommand(s.command('click', { snapshotId, x: 0, y: 20 }));
  assert.equal(result.ok, true);
  assert.equal(s.calls.at(-1).name, 'click');
  assert.equal(s.calls.at(-1).args.expectedWindow.handle, '1001');
  assert.equal(s.controller.getStatus().mode, 'armed');
});

test('GO LIVE defaults to an eight-hour session and caps requested sessions at twelve hours', (t) => {
  const s = setup(t);
  s.controller.selectTarget(target());
  s.controller.setMode('armed', { generation: 1 });
  assert.equal(s.controller.getStatus().expiresAt, 1000 + 480 * 60_000);
  s.controller.setMode('armed', { generation: 2, minutes: 24 * 60 });
  assert.equal(s.controller.getStatus().expiresAt, 1000 + 720 * 60_000);
});

test('a requested thirty-minute session expires and cannot be renewed by input', async (t) => {
  const s = setup(t); s.controller.selectTarget(target());
  s.controller.setMode('armed', { minutes: 30, generation: 1 });
  const expiry = 1000 + 30 * 60_000;
  assert.equal(s.controller.getStatus().expiresAt, expiry);
  await s.capture(); assert.equal(s.controller.getStatus().expiresAt, expiry);
  s.advance(30 * 60_000);
  assert.equal(s.controller.getStatus().mode, 'off');
  assert.equal((await s.controller.runCommand(s.command('screenshot'))).ok, false);
});

test('drag consumes one fresh snapshot and passes its exact title and geometry to native checks', async (t) => {
  const s = setup(t); s.arm();
  const args = { snapshotId: 'missing', points: [{ x: 1, y: 1 }, { x: 20, y: 20 }], durationMs: 500 };
  assert.equal((await s.controller.runCommand(s.command('drag', args))).error, 'fresh-snapshot-required');
  args.snapshotId = await s.capture();
  assert.equal((await s.controller.runCommand(s.command('drag', args))).ok, true);
  assert.equal(s.calls.at(-1).args.snapshotTitle, target().title);
  assert.deepEqual(s.calls.at(-1).args.geometry, target().geometry);
  assert.equal((await s.controller.runCommand(s.command('drag', args))).error, 'fresh-snapshot-required');
  args.snapshotId = await s.capture(); s.changeWindow({ title: 'Other page' });
  assert.equal((await s.controller.runCommand(s.command('drag', args))).error, 'window-moved-retake-snapshot');
});

test('STOP during drag waits for executor cleanup and latches any unconfirmed mouse release', async (t) => {
  for (const error of ['windows-drag-release-unconfirmed', 'windows-drag-stop-unconfirmed']) {
    const s = setup(t); s.arm(); const snapshotId = await s.capture();
    const started = deferred(), cleanup = deferred(); let signal;
    s.executor.run = async (_, __, options) => { signal = options.signal; started.resolve(); return cleanup.promise; };
    const result = s.controller.runCommand(s.command('drag', { snapshotId, points: [{ x: 1, y: 1 }, { x: 2, y: 2 }], durationMs: 500 }));
    await started.promise; s.controller.emergencyStop();
    assert.equal(signal.aborted, true);
    assert.ok(s.controller.operation, 'operation must remain busy while native cleanup is pending');
    let idle = false; const settled = s.controller.whenIdle().then(() => { idle = true; });
    await Promise.resolve(); assert.equal(idle, false, 'quit must wait for drag cleanup');
    cleanup.resolve({ ok: false, error });
    assert.equal((await result).error, error);
    await settled; assert.equal(idle, true);
    assert.equal(s.controller.getStatus().mode, 'off');
    assert.equal(s.controller.getStatus().inputSafetyFault, error);
    assert.throws(() => s.controller.clearLocalStop(), new RegExp(error));
    assert.throws(() => s.controller.setMode('armed'), new RegExp(error));
  }
});

test('commands without valid deadline, generation and replay ID fail before target access', async (t) => {
  const s = setup(t); s.arm();
  let foregroundCalls = 0;
  s.executor.foreground = async () => { foregroundCalls++; return target(); };
  for (const bad of [{ commandId: undefined }, { commandId: 'x' }, { commandId: '../../not-valid' }, { expiresAt: undefined }, { expiresAt: Infinity }, { controlGeneration: undefined }, { controlGeneration: 1.1 }]) {
    assert.equal((await s.controller.runCommand(s.command('screenshot', {}, bad))).error, 'invalid-command-envelope');
  }
  assert.equal(foregroundCalls, 0);
  assert.equal((await s.controller.runCommand(s.command('screenshot', {}, { expiresAt: 999 }))).error, 'command-expired');
  assert.equal((await s.controller.runCommand(s.command('screenshot', {}, { controlGeneration: 2 }))).error, 'stale-session');
});

test('replayed command IDs cannot execute twice', async (t) => {
  const s = setup(t); s.arm(); const request = s.command('snapshot');
  assert.equal((await s.controller.runCommand(request)).ok, true);
  assert.equal((await s.controller.runCommand(request)).error, 'command-replayed');
  assert.equal(s.calls.length, 1);
});

test('remote arming requires local opt-in, target selection and a fresh request', async (t) => {
  const s = setup(t); const request = { mode: 'armed', expiresAt: 20_000, requestId: randomUUID(), controlGeneration: 1 };
  s.controller.selectTarget(target());
  assert.equal((await s.controller.applyOwnerState(request)).error, 'remote-arm-disabled');
  s.settings.allowRemoteArm = true; s.controller.targetWindow = null;
  assert.equal((await s.controller.applyOwnerState(request)).error, 'select-a-window-first');
  s.controller.selectTarget(target());
  assert.equal((await s.controller.applyOwnerState({ ...request, expiresAt: 999 })).error, 'expired-arm-request');
  assert.equal((await s.controller.applyOwnerState(request)).ok, true);
  assert.equal(s.controller.getStatus().expiresAt, 20_000);
});

test('local emergency stop latches until locally reset and remote arm cannot clear it', async (t) => {
  const s = setup(t, { allowRemoteArm: true }); s.arm(); s.controller.emergencyStop();
  assert.equal(s.controller.getStatus().mode, 'off');
  assert.equal(s.controller.getStatus().stopLatched, true);
  const request = { mode: 'armed', expiresAt: 20_000, requestId: randomUUID(), controlGeneration: 2 };
  assert.equal((await s.controller.applyOwnerState(request)).error, 'local-stop-latched');
  assert.throws(() => s.controller.setMode('armed'), /local-stop-latched/);
  s.controller.clearLocalStop();
  assert.equal((await s.controller.applyOwnerState(request)).ok, true);
});

test('emergency stop during awaited foreground check cancels before any input', async (t) => {
  const s = setup(t); s.arm(); const pending = deferred(); let signal;
  s.executor.foreground = ({ signal: observed }) => { signal = observed; return pending.promise; };
  const result = s.controller.runCommand(s.command('screenshot'));
  s.controller.emergencyStop();
  assert.equal(signal.aborted, true);
  pending.resolve(target());
  assert.equal((await result).error, 'command-cancelled');
  assert.equal(s.calls.length, 0);
  assert.equal(s.controller.getStatus().mode, 'off');
});

test('only one command executes at a time; overlapping commands are rejected rather than queued', async (t) => {
  const s = setup(t); s.arm(); const pending = deferred();
  s.executor.foreground = () => pending.promise;
  const first = s.controller.runCommand(s.command('screenshot'));
  assert.equal((await s.controller.runCommand(s.command('snapshot'))).error, 'host-busy');
  pending.resolve(target()); assert.equal((await first).ok, true);
  assert.equal(s.calls.length, 1);
});

test('emergency stop propagates cancellation to an executing native action', async (t) => {
  const s = setup(t); s.arm(); const snapshotId = await s.capture();
  const started = deferred(), pending = deferred(); let signal;
  s.executor.run = async (_, __, options) => { signal = options.signal; started.resolve(); return pending.promise; };
  const action = s.controller.runCommand(s.command('click', { snapshotId, x: 1, y: 1 }));
  await started.promise; s.controller.emergencyStop();
  assert.equal(signal.aborted, true); pending.resolve({ ok: true });
  assert.equal((await action).error, 'command-cancelled');
  assert.equal(s.controller.getStatus().mode, 'off');
});

test('input requires a fresh snapshot and consumes it', async (t) => {
  const s = setup(t); s.arm();
  assert.equal((await s.controller.runCommand(s.command('type', { text: 'hello', snapshotId: 'unknown' }))).error, 'fresh-snapshot-required');
  const snapshotId = await s.capture();
  assert.equal((await s.controller.runCommand(s.command('type', { text: 'hello', snapshotId }))).ok, true);
  assert.equal((await s.controller.runCommand(s.command('key', { key: 'ENTER', snapshotId }))).error, 'fresh-snapshot-required');
  const old = await s.capture(); s.advance(15_001);
  assert.equal((await s.controller.runCommand(s.command('scroll', { deltaY: 120, snapshotId: old }))).error, 'fresh-snapshot-required');
});

test('moving the target or changing its page title invalidates the captured coordinates', async (t) => {
  const s = setup(t); s.arm(); const first = await s.capture();
  s.changeWindow({ geometry: { ...target().geometry, x: 300 } });
  assert.equal((await s.controller.runCommand(s.command('click', { snapshotId: first, x: 20, y: 30 }))).error, 'window-moved-retake-snapshot');
  const next = await s.capture(); s.changeWindow({ title: 'A different ordinary page' });
  assert.equal((await s.controller.runCommand(s.command('click', { snapshotId: next, x: 20, y: 30 }))).error, 'window-moved-retake-snapshot');
});

test('approved target and password detection remain guards even with a fresh snapshot', async (t) => {
  const s = setup(t); s.arm(); const snapshotId = await s.capture();
  s.changeWindow({ handle: '2002' });
  assert.equal((await s.controller.runCommand(s.command('click', { snapshotId, x: 20, y: 30 }))).error, 'target-changed');
  s.changeWindow({ handle: '1001', passwordPresent: true });
  assert.equal((await s.controller.runCommand(s.command('click', { snapshotId, x: 20, y: 30 }))).error, 'credential');
});

test('bot lease prevents a second bot from acting; owner preview neither steals nor supplies bot snapshots', async (t) => {
  const s = setup(t); s.arm(); await s.capture('tester-1');
  assert.equal((await s.controller.runCommand(s.command('screenshot', {}, { botId: 'tester-2' }))).error, 'bot-lease-held');
  const ownerSnapshot = await s.capture('owner-preview');
  assert.equal(s.controller.activeBot, 'tester-1');
  assert.equal((await s.controller.runCommand(s.command('click', { x: 1, y: 1, snapshotId: ownerSnapshot }))).error, 'fresh-snapshot-required');
});

test('status and stop/record-stop remain usable while off and paused', async (t) => {
  const s = setup(t);
  for (const mode of ['off', 'paused']) {
    s.controller.setMode(mode);
    for (const name of ['status', 'record_stop', 'stop_all']) assert.equal((await s.controller.runCommand({ name })).ok, true);
  }
});

test('bot status never returns pairing or owner credentials', async (t) => {
  const s = setup(t, { hostToken: 'private-host-secret', ownerToken: 'private-owner-secret', botToken: 'private-bot-secret' });
  const response = await s.controller.runCommand({ name: 'status' });
  const text = JSON.stringify(response);
  for (const key of ['hostToken', 'ownerToken', 'botToken']) {
    assert.equal(text.includes(key), false);
    assert.equal(text.includes(s.settings[key]), false);
  }
});

test('expiry and lost relay connection revoke access and invalidate snapshots', async (t) => {
  const s = setup(t); s.arm(); await s.capture();
  s.advance(300_001); assert.equal(s.controller.getStatus().mode, 'off');
  assert.equal(s.controller.snapshots.size, 0);
  s.arm(); const relay = new EventEmitter(); relay.send = () => true;
  s.controller.attachRelay(relay);
  relay.emit('status', { connected: false, authenticated: false });
  assert.equal(s.controller.getStatus().mode, 'off');
});

test('record_stop during record_start cancels late success instead of restarting recording', async (t) => {
  const s = setup(t); s.arm(); const started = deferred(), pending = deferred(); let signal;
  s.executor.recordStart = (options) => { signal = options.signal; started.resolve(); return pending.promise; };
  const recording = s.controller.runCommand(s.command('record_start'));
  await started.promise;
  assert.equal((await s.controller.runCommand({ name: 'record_stop' })).ok, true);
  assert.equal(signal.aborted, true);
  pending.resolve({ ok: true });
  assert.equal((await recording).error, 'command-cancelled');
  assert.equal(s.controller.getStatus().recording, false);
});

test('recording failure revokes recording flag and local capture signal', async (t) => {
  const s = setup(t); s.arm(); let options;
  s.executor.recordStart = async (received) => { options = received; return { ok: true }; };
  assert.equal((await s.controller.runCommand(s.command('record_start'))).ok, true);
  assert.equal(s.controller.getStatus().recording, true);
  options.onFailure();
  assert.equal(options.signal.aborted, true);
  assert.equal(s.controller.getStatus().recording, false);
});

test('read requests restore only the approved target and verify foreground again',async t=>{
  for(const name of ['screenshot','snapshot','list_windows']){
    const s=setup(t);s.arm();s.changeWindow({handle:'other',processId:777});let focusCalls=0;
    s.executor.focus=async(window,{signal})=>{focusCalls++;assert.equal(window.handle,'1001');assert.equal(signal.aborted,false);s.changeWindow(target());return {ok:true};};
    assert.equal((await s.controller.runCommand(s.command(name))).ok,true);assert.equal(focusCalls,1);
  }
});
test('read focus refusal and false success never produce a screenshot',async t=>{
  for(const response of [{ok:false,error:'focus-refused'},{ok:true}]){
    const s=setup(t);s.arm();s.changeWindow({handle:'other'});s.executor.focus=async()=>response;
    const r=await s.controller.runCommand(s.command('screenshot'));assert.equal(r.ok,false);assert.equal(s.calls.length,0);
    assert.equal(r.error,response.ok?'target-changed':'focus-refused');
  }
});
test('STOP aborts focus recovery and a late success cannot capture or rearm',async t=>{
  const s=setup(t);s.arm();s.changeWindow({handle:'other'});const pending=deferred();let signal;
  s.executor.focus=async(_window,options)=>{signal=options.signal;return pending.promise;};
  const request=s.controller.runCommand(s.command('screenshot'));await new Promise(resolve=>setImmediate(resolve));
  s.controller.emergencyStop();assert.equal(signal.aborted,true);pending.resolve({ok:true});
  assert.equal((await request).error,'command-cancelled');assert.equal(s.calls.length,0);assert.equal(s.controller.mode,'off');
});
test('input and disabled sessions cannot trigger focus recovery',async t=>{
  const s=setup(t);s.arm();const snapshotId=await s.capture();s.changeWindow({handle:'other'});let focusCalls=0;
  s.executor.focus=async()=>{focusCalls++;return {ok:true};};
  for(const name of ['click','type','key','scroll'])assert.equal((await s.controller.runCommand(s.command(name,{snapshotId,x:0,y:0,text:'test',key:'ENTER',deltaY:120}))).ok,false);
  s.controller.setMode('off',{generation:1});assert.equal((await s.controller.runCommand(s.command('screenshot'))).ok,false);assert.equal(focusCalls,0);
});
test('focus recovery invalidates previous snapshots',async t=>{
  const s=setup(t);s.arm();const old=await s.capture();s.changeWindow({handle:'other'});
  s.executor.focus=async()=>{s.changeWindow(target());return {ok:true};};await s.capture();
  assert.equal((await s.controller.runCommand(s.command('type',{snapshotId:old,text:'test'}))).error,'fresh-snapshot-required');
});

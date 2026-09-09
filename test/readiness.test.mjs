import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveReadiness, formatSessionClock } from '../host/ui/readiness.mjs';

const paired = { relayUrl: 'https://fixture.example.test', hostId: 'fixture-pc', hostToken: 'saved', ownerToken: 'saved', allowRemoteArm: false };
const connected = { mode: 'off', relay: { authenticated: true, connected: true } };
const target = { handle: '100', processId: 42, processName: 'msedge', title: 'Synthetic app' };

test('first-run readiness has no fabricated connection or selected target', () => {
  const state = deriveReadiness();
  assert.equal(state.count, 0);
  assert.equal(state.ready, false);
  assert.equal(state.nextIncomplete, 'pair');
  assert.equal(state.connection, 'Pairing needed');
  assert.match(state.goLiveHint, /Choose a window/);
});

test('stored credentials do not mark the relay connected before authentication', () => {
  const offline = deriveReadiness(paired, { relay: { connected: false, authenticated: false } });
  assert.equal(offline.paired, true);
  assert.equal(offline.completed.pair, false);
  assert.equal(offline.connection, 'Waiting for relay');
  const connecting = deriveReadiness(paired, { relay: { connected: true, authenticated: false } });
  assert.equal(connecting.connection, 'Verifying connection');
  assert.equal(connecting.completed.pair, false);
  assert.equal(deriveReadiness(paired, connected).completed.pair, true);
});

test('pair readiness requires saved host/owner credentials and never requires a bot credential', () => {
  for (const patch of [{ hostToken: '' }, { ownerToken: '' }, { hostToken: 'unsaved-private-value' }, { hostId: '' }, { relayUrl: '' }]) {
    assert.equal(deriveReadiness({ ...paired, ...patch }, connected).paired, false);
  }
  assert.equal(deriveReadiness(paired, connected).paired, true);
  assert.equal(Object.hasOwn(paired, 'botToken'), false);
});

test('phone completion uses persisted preference rather than optimistic status or a draft checkbox', () => {
  const status = { ...connected, targetWindow: target, allowRemoteArm: true };
  const beforeSave = deriveReadiness(paired, status);
  assert.equal(beforeSave.count, 2);
  assert.equal(beforeSave.completed.phone, false);
  assert.equal(beforeSave.nextIncomplete, 'phone');
  const afterSave = deriveReadiness({ ...paired, allowRemoteArm: true }, status);
  assert.equal(afterSave.count, 3);
  assert.equal(afterSave.ready, true);
  assert.equal(afterSave.labels.phone, 'Enabled and saved');
});

test('local emergency latch prevents ready-to-leave while retaining truthful saved step progress', () => {
  const state = deriveReadiness({ ...paired, allowRemoteArm: true }, { ...connected, targetWindow: target, stopLatched: true });
  assert.equal(state.count, 3);
  assert.equal(state.ready, false);
  assert.match(state.next, /Unlock the local stop/);
  assert.match(state.goLiveHint, /Unlock/);
});

test('target must identify a real selected process; changing status never mutates stored configuration', () => {
  const frozen = Object.freeze({ ...paired, allowRemoteArm: true });
  for (const selected of [null, {}, { handle: '100' }, { handle: '100', processId: 0 }, { handle: '100', processId: '42' }]) {
    assert.equal(deriveReadiness(frozen, { ...connected, targetWindow: selected }).selected, false);
  }
  assert.equal(deriveReadiness(frozen, { ...connected, targetWindow: target }).selected, true);
  assert.equal(frozen.allowRemoteArm, true);
});

test('countdown handles missing state, expiration, subsecond rounding and an overnight session', () => {
  for (const value of [undefined, null, NaN, Infinity, '1234']) assert.equal(formatSessionClock(value, 0), '—');
  assert.equal(formatSessionClock(1000, 1001), '00:00:00');
  assert.equal(formatSessionClock(1001, 1000), '00:00:01');
  assert.equal(formatSessionClock(28_801_000, 1000), '08:00:00');
  assert.equal(formatSessionClock(Date.UTC(2026, 8, 10, 6), Date.UTC(2026, 8, 9, 18)), '12:00:00');
});

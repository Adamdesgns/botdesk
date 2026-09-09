import test from 'node:test';
import assert from 'node:assert/strict';
import { canBotControl, effectiveState, clampMinutes } from '../relay/src/policy.ts';

test('relay expires armed sessions and bot leases', () => {
  const state = { mode: 'armed', expiresAt: 100, hostLastSeen: null, activeBot: 't1', leaseEndsAt: 100 };
  assert.equal(effectiveState(state, 101).mode, 'off');
  const leaseOnly = { ...state, expiresAt: 10_000 };
  const expiredLease = effectiveState(leaseOnly, 101);
  assert.equal(expiredLease.activeBot, null);
  assert.equal(expiredLease.mode, 'armed');
});

test('Go Live defaults to eight hours and has a twelve-hour maximum', () => {
  assert.equal(clampMinutes(undefined), 480);
  assert.equal(clampMinutes('invalid'), 480);
  assert.equal(clampMinutes(10000), 720);
  assert.equal(clampMinutes(-5), 5);
});

test('armed state without a valid deadline cannot grant a lease', () => {
  assert.equal(canBotControl({ mode: 'armed', expiresAt: null, hostLastSeen: null, activeBot: null, leaseEndsAt: null }, 'bot').allowed, false);
  const base = { mode: 'armed', expiresAt: 1000, hostLastSeen: null, activeBot: null, leaseEndsAt: null };
  assert.equal(canBotControl(base, 'bot', 999).next.leaseEndsAt, 1000);
});

test('relay gives one bot a renewable lease', () => {
  const base = { mode: 'armed', expiresAt: 10_000, hostLastSeen: null, activeBot: null, leaseEndsAt: null };
  const first = canBotControl(base, 't1', 100);
  assert.equal(first.allowed, true);
  assert.equal(canBotControl(first.next, 't2', 200).error, 'bot-lease-held');
  assert.equal(canBotControl(first.next, 't1', 200).allowed, true);
});

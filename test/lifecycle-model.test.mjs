import test from 'node:test';
import assert from 'node:assert/strict';
import { explore } from '../formal/botdoor-lifecycle.mjs';

const REQUIRED = ['authenticated-off', 'arming', 'live-bot', 'live-owner', 'handoff-waiting', 'handoff-completed', 'paused', 'expired', 'stop-latched', 'disconnected'];

test('the BotDoor lifecycle model reaches every session state and keeps STOP, expiry, and owner control', () => {
  const result = explore();
  assert.equal(result.truncated, false, `explored ${result.states} states`);
  assert.deepEqual(result.violations, []);
  for (const name of REQUIRED) assert.equal(result.reached.has(name), true, name);
  assert.ok(result.states > REQUIRED.length);
});

test('the checker catches a grant extended by an operator switch, a lying operator ack, owner-control input, and a dropped STOP', () => {
  const extended = explore({ extendOnSwitch: true });
  assert.ok(extended.violations.some(item => item.code === 'grant-extended' || item.code === 'schedule-outlives-grant'));
  const unconfirmed = explore({ acceptBadAck: true });
  assert.ok(unconfirmed.violations.some(item => item.code === 'operator-unconfirmed' || item.code === 'input-while-owner-control'));
  const input = explore({ allowOwnerInput: true });
  assert.ok(input.violations.some(item => item.code === 'input-while-owner-control'));
  const stopped = explore({ ignoreLocalStop: true });
  assert.ok(stopped.violations.some(item => item.code === 'stop-bypassed'));
});

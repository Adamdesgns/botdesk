import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySocketError, describeOwnerError, describeRelayStatus, retryText } from '../host/relay-status.mjs';

test('socket errors map to stable reasons without leaking the message text', () => {
  const cases = [
    [{ message: 'Unexpected server response: 401' }, 'unauthorized'],
    [{ message: 'Unexpected server response: 409' }, 'host-already-connected'],
    [{ message: 'Unexpected server response: 404' }, 'relay-route-missing'],
    [{ message: 'Unexpected server response: 502' }, 'relay-error'],
    [{ message: 'Opening handshake has timed out' }, 'handshake-timeout'],
    [{ message: 'getaddrinfo ENOTFOUND relay.invalid', code: 'ENOTFOUND' }, 'dns-failure'],
    [{ message: 'connect ECONNREFUSED 127.0.0.1:9', code: 'ECONNREFUSED' }, 'relay-unreachable'],
    [{ message: 'certificate has expired', code: 'CERT_HAS_EXPIRED' }, 'tls-error'],
    [{ message: 'Hostname/IP does not match', code: 'ERR_TLS_CERT_ALTNAME_INVALID' }, 'tls-error'],
    [{ message: 'something else' }, 'connection-failed'],
    [undefined, 'connection-failed']
  ];
  for (const [error, reason] of cases) {
    const classified = classifySocketError(error);
    assert.equal(classified.reason, reason, JSON.stringify(error));
    assert.equal(JSON.stringify(classified).includes('relay.invalid'), false);
    assert.equal(JSON.stringify(classified).includes('127.0.0.1'), false);
  }
  assert.equal(classifySocketError({ code: 'weird code with spaces' }).code, undefined);
});

test('every relay reason has owner-readable text and distinct labels for the common failures', () => {
  const reasons = ['setup-required', 'invalid-relay-url', 'connecting', 'unauthorized', 'host-already-connected', 'dns-failure', 'relay-unreachable', 'tls-error', 'handshake-timeout', 'heartbeat-timeout', 'disconnected', 'stopped', 'connection-failed', 'relay-error', 'relay-route-missing'];
  const labels = new Set();
  for (const reason of reasons) {
    const summary = describeRelayStatus({ connected: false, authenticated: false, reason });
    assert.equal(summary.key, reason);
    assert.ok(summary.label.length > 2 && summary.detail.length > 20, reason);
    labels.add(summary.label);
  }
  assert.equal(labels.size, reasons.length, 'each reason needs its own label');
  assert.equal(describeRelayStatus({ connected: true, authenticated: true, reason: 'unauthorized' }).label, 'Securely connected');
  assert.equal(describeRelayStatus({ connected: true, authenticated: false }).label, 'Authenticating');
  assert.equal(describeRelayStatus({}).label, 'Connection failed');
  assert.match(describeRelayStatus({ reason: 'relay-unreachable', code: 'ECONNREFUSED' }).detail, /ECONNREFUSED/);
  assert.match(describeRelayStatus({ reason: 'unauthorized', httpStatus: 401 }).detail, /HTTP 401/);
  assert.match(describeRelayStatus({ reason: 'disconnected', closeReason: 'host-heartbeat-timeout' }).detail, /relay said: host-heartbeat-timeout/);
});

test('retry text counts down from the next scheduled attempt', () => {
  assert.equal(retryText({ authenticated: true, nextRetryAt: 5000 }, 1000), '');
  assert.equal(retryText({ nextRetryAt: 5000, attempts: 1 }, 1000), 'Next attempt in 4s.');
  assert.equal(retryText({ nextRetryAt: 5000, attempts: 3 }, 1000), 'Next attempt in 4s (attempt 3).');
  assert.equal(retryText({ nextRetryAt: 500, attempts: 2 }, 1000), 'Reconnecting now (attempt 2).');
  assert.equal(retryText({}), '');
});

test('owner request errors keep their code and gain an instruction', () => {
  for (const code of ['unauthorized', 'host-busy', 'state-timeout', 'remote-arm-disabled', 'local-stop-latched', 'select-a-window-first', 'focus-refused']) {
    const text = describeOwnerError(code);
    assert.ok(text.endsWith('(' + code + ')'), text);
    assert.ok(text.length > code.length + 20);
  }
  assert.equal(describeOwnerError('something-new'), 'The relay reported: something-new');
  assert.equal(describeOwnerError('x'.repeat(200)).length <= 120, true);
});

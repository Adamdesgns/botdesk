import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRelayError, formatBotError, ERROR_CODES } from '../shared/errors.mjs';
import { createRelayClient, validateRelayConfig } from '../mcp/server.mjs';

test('relay errors map to distinguishable credential and session codes', () => {
  assert.equal(classifyRelayError(401, { error: 'unauthorized' }), ERROR_CODES.AUTHENTICATION_REJECTED);
  assert.equal(classifyRelayError(503, { error: 'host-offline' }), ERROR_CODES.HOST_OFFLINE);
  assert.equal(classifyRelayError(409, { error: 'not-armed' }), ERROR_CODES.NOT_ARMED);
  assert.equal(classifyRelayError(409, { error: 'session-expired' }), ERROR_CODES.SESSION_EXPIRED);
  assert.equal(classifyRelayError(504, { error: 'command-timeout' }), ERROR_CODES.COMMAND_TIMEOUT);
  assert.equal(classifyRelayError(409, { error: 'capture-too-large' }), ERROR_CODES.PAYLOAD_TOO_LARGE);
});

test('missing env surfaces credential-missing without leaking values', () => {
  assert.throws(() => validateRelayConfig({}), (error) => {
    assert.match(error.message, /credential-missing/);
    assert.equal(error.code, ERROR_CODES.CREDENTIAL_MISSING);
    assert.doesNotMatch(error.message, /Bearer|token-[A-Za-z0-9]{10,}/);
    return true;
  });
});

test('authentication rejected and host offline messages stay actionable', async () => {
  const config = { relayUrl: 'https://relay.example.test', hostId: 'test-host', botToken: 'test-token-12345678901234567890' };
  await assert.rejects(
    createRelayClient(config, async () => Response.json({ error: 'unauthorized' }, { status: 401 }))('botdesk_status'),
    (error) => error.code === ERROR_CODES.AUTHENTICATION_REJECTED && /authentication-rejected/.test(error.message)
  );
  await assert.rejects(
    createRelayClient(config, async () => Response.json({ error: 'host-offline' }, { status: 503 }))('botdesk_status'),
    (error) => error.code === ERROR_CODES.HOST_OFFLINE && /host-offline/.test(error.message)
  );
});

test('formatBotError never echoes long secret-looking tokens', () => {
  const message = formatBotError(ERROR_CODES.AUTHENTICATION_REJECTED, 'Bearer abcdefghijklmnopqrstuvwxyz0123456789');
  assert.match(message, /authentication-rejected/);
  assert.match(message, /\[redacted\]/);
  assert.doesNotMatch(message, /abcdefghijklmnopqrstuvwxyz0123456789/);
});

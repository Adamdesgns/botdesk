import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { TOOL_DEFS, createRelayClient, toolContent, validateRelayConfig, validateToolArgs } from '../mcp/server.mjs';
import { COMMANDS, clampArmMinutes } from '../shared/protocol.mjs';
import { runMcpSmoke } from '../scripts/mcp-smoke.mjs';

const config = { relayUrl: 'https://relay.example.test', hostId: 'test-host', botToken: 'test-token-12345678901234567890' };
const success = (result = { mode: 'off' }) => Response.json({ ok: true, result });

test('MCP tool list matches shared command contract', () => {
  assert.deepEqual(TOOL_DEFS.map((tool) => tool.name.replace('botdesk_', '')).sort(), [...COMMANDS].sort());
});

test('away sessions default to eight hours and cap at twelve hours', () => {
  assert.equal(clampArmMinutes(), 480);
  assert.equal(clampArmMinutes('invalid'), 480);
  assert.equal(clampArmMinutes(10_000), 720);
  assert.equal(clampArmMinutes(1), 5);
  assert.equal(clampArmMinutes(30), 30);
});

test('relay config allows HTTPS origin and explicit loopback only', () => {
  for (const relayUrl of ['https://relay.example.test', 'http://localhost:8787', 'http://127.0.0.1:8787', 'http://[::1]:8787']) {
    assert.ok(validateRelayConfig({ ...config, relayUrl }).relayUrl);
  }
  for (const relayUrl of ['http://relay.example.test', 'http://192.168.1.2', 'file:///tmp/test', 'https://token@relay.example.test', 'https://relay.example.test/path', 'https://relay.example.test/?token=secret', 'https://relay.example.test/#secret']) {
    assert.throws(() => validateRelayConfig({ ...config, relayUrl }));
  }
  for (const hostId of ['../other', 'UPPER', 'test/other', '-bad']) assert.throws(() => validateRelayConfig({ ...config, hostId }));
  assert.throws(() => validateRelayConfig({ ...config, botToken: 'bad\r\nheader' }));
  assert.throws(() => validateRelayConfig({ ...config, botId: 'bad\r\nheader' }));
  assert.throws(() => validateRelayConfig({ ...config, timeoutMs: 999999 }));
});

test('separate clients receive distinct bot ids unless explicitly set', async () => {
  const observed = [];
  const fakeFetch = async (_, options) => { observed.push(options.headers); return success(); };
  const first = createRelayClient(config, fakeFetch);
  const second = createRelayClient(config, fakeFetch);
  await first('botdesk_status'); await first('botdesk_status'); await second('botdesk_status');
  assert.equal(observed[0]['x-bot-id'], observed[1]['x-bot-id']);
  assert.notEqual(observed[0]['x-bot-id'], observed[2]['x-bot-id']);
  assert.equal(new Set(observed.map((item) => item['x-request-id'])).size, 3);
  const deterministic = createRelayClient({ ...config, botId: 'approved-tester-1' }, fakeFetch);
  await deterministic('botdesk_status');
  assert.equal(observed[3]['x-bot-id'], 'approved-tester-1');
});

test('fresh snapshot id and bounded inputs are required before HTTP call', async () => {
  const call = createRelayClient(config, () => { throw new Error('Network must not be reached'); });
  for (const [name, args] of [
    ['click', { x: 10, y: 10 }], ['type', { text: 'hello' }], ['key', { key: 'ENTER' }], ['scroll', { deltaY: 120 }],
    ['click', { snapshotId: 'a', x: -1, y: 1 }], ['click', { snapshotId: 'a', x: 1.5, y: 1 }],
    ['scroll', { snapshotId: 'a', deltaY: 0 }], ['scroll', { snapshotId: 'a', deltaY: 9999 }],
    ['key', { snapshotId: 'a', key: 'CTRL+V' }], ['key', { snapshotId: 'a', key: 'WIN+R' }],
    ['type', { snapshotId: 'a', text: '\u001b' }], ['type', { snapshotId: 'a', text: 'a'.repeat(4001) }],
    ['type', { snapshotId: 'a', text: 'javascript:alert(1)' }], ['type', { snapshotId: 'a', text: '\t' }],
    ['status', { script: 'shell command' }], ['screenshot', { maxWidth: 100 }],
    ['focus', { handle: '9999' }], ['focus', { snapshotId: 'a' }]
  ]) await assert.rejects(call(`botdesk_${name}`, args), (error) => !error.message.includes('Network must not'));
  assert.equal(validateToolArgs('botdesk_click', { snapshotId: 'fresh', x: 0, y: 0 }), 'click');
});

test('maximum Unicode plain-text input fits bounded relay request and retains contents', async () => {
  const text = '\u2028'.repeat(4000);
  const call = createRelayClient(config, async (_, options) => {
    assert.ok(Buffer.byteLength(options.body) <= 16 * 1024);
    assert.equal(JSON.parse(options.body).args.text, text);
    return success();
  });
  await call('botdesk_type', { snapshotId: 'a'.repeat(128), text });
});

test('relay requests disable redirects and bound errors, malformed bodies and advertised length', async () => {
  const call = createRelayClient(config, async (_, options) => {
    assert.equal(options.redirect, 'error');
    assert.equal(options.signal.aborted, false);
    return success({ okay: true });
  });
  assert.deepEqual(await call('botdesk_status'), { okay: true });
  await assert.rejects(createRelayClient(config, async () => Response.json({ error: 'not-armed' }, { status: 409 }))('botdesk_click', { snapshotId: 'x', x: 0, y: 0 }), /not-armed/);
  await assert.rejects(createRelayClient(config, async () => new Response('not JSON'))('botdesk_status'), /invalid JSON/);
  await assert.rejects(createRelayClient(config, async () => Response.json({ result: {} }))('botdesk_status'), /invalid command result/);
  await assert.rejects(createRelayClient(config, async () => new Response('x', { headers: { 'content-length': 20 * 1024 * 1024 } }))('botdesk_status'), /size limit/);
  await assert.rejects(createRelayClient(config, async () => new Response(new Uint8Array(12 * 1024 * 1024 + 1)))('botdesk_status'), /size limit/);
});

test('deadline aborts both fetch and slow response-body reads', async () => {
  let signal;
  const call = createRelayClient({ ...config, timeoutMs: 15 }, async (_, options) => { signal = options.signal; return new Promise(() => {}); });
  await assert.rejects(call('botdesk_status'), /timed out/);
  assert.equal(signal.aborted, true);
  const fixture = createServer((_, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.write('{'); });
  fixture.listen(0, '127.0.0.1'); await once(fixture, 'listening');
  try {
    await assert.rejects(createRelayClient({ ...config, relayUrl: `http://127.0.0.1:${fixture.address().port}`, timeoutMs: 50 })('botdesk_status'), /timed out/);
  } finally { fixture.closeAllConnections(); await new Promise((done) => fixture.close(done)); }
});

test('real HTTP redirects never send a bearer token to another endpoint', async () => {
  let leaked = false;
  const fixture = createServer((request, response) => {
    if (request.url === '/leak') { leaked = true; response.end('{}'); }
    else { response.writeHead(302, { location: '/leak' }); response.end(); }
  });
  fixture.listen(0, '127.0.0.1'); await once(fixture, 'listening');
  try {
    await assert.rejects(createRelayClient({ ...config, relayUrl: `http://127.0.0.1:${fixture.address().port}` })('botdesk_status'));
    assert.equal(leaked, false);
  } finally { fixture.closeAllConnections(); await new Promise((done) => fixture.close(done)); }
});

test('screenshot content carries target pixels and snapshot id and rejects invalid images', () => {
  const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=';
  const result = { snapshotId: 'fresh', image: { data: pixel, mimeType: 'image/png', width: 1, height: 1 }, window: { processName: 'msedge' } };
  const content = toolContent('botdesk_screenshot', result);
  assert.equal(content[0].type, 'image');
  assert.equal(JSON.parse(content[1].text).width, 1);
  assert.equal(JSON.parse(content[1].text).snapshotId, 'fresh');
  assert.throws(() => toolContent('botdesk_screenshot', { ...result, snapshotId: undefined }), /snapshotId/);
  for (const image of [{ ...result.image, data: 'evil!!' }, { ...result.image, mimeType: 'text/html' }, { ...result.image, width: -1 }, { ...result.image, data: 'A'.repeat(12 * 1024 * 1024) }]) {
    assert.throws(() => toolContent('botdesk_screenshot', { ...result, image }));
  }
  assert.throws(() => toolContent('botdesk_snapshot', { text: 'x'.repeat(1024 * 1024 + 1) }), /oversized/);
});

test('SDK client starts the MCP executable and completes tools over real stdio', { timeout: 20_000 }, async () => {
  const result = await runMcpSmoke();
  assert.equal(result.toolCount, 12);
  assert.equal(result.relayRequests, 7);
});

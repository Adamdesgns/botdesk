import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=';

// Real SDK client -> real stdio child process -> loopback HTTP fixture.
// This deliberately never connects to a host or performs desktop input.
export async function runMcpSmoke() {
  const requests = [];
  const fixture = createServer(async (request, response) => {
    try {
      assert.equal(request.method, 'POST');
      assert.equal(request.url, '/api/bot/smoke-host/command');
      assert.equal(request.headers.authorization, 'Bearer local-smoke-token-123456789');
      assert.match(request.headers['x-bot-id'], /^[a-zA-Z0-9._-]{1,80}$/);
      assert.match(request.headers['x-request-id'], /^[0-9a-f-]{36}$/);
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      requests.push({ ...body, botId: request.headers['x-bot-id'], requestId: request.headers['x-request-id'] });
      const result = body.name === 'screenshot'
        ? { snapshotId: 'smoke-image', width: 1, height: 1, data: pixel, mimeType: 'image/png', target: { processName: 'fixture-only' } }
        : body.name === 'snapshot'
          ? { snapshotId: 'smoke-controls', width: 1, height: 1, controls: [{ name: 'Fixture button', type: 'Button' }] }
          : { mode: 'off', fixture: true, command: body.name };
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, result }));
    } catch {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'fixture-rejected-request' }));
    }
  });
  fixture.listen(0, '127.0.0.1');
  await once(fixture, 'listening');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../mcp/server.mjs', import.meta.url))],
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([, value]) => typeof value === 'string')), BOTDESK_RELAY_URL: `http://127.0.0.1:${fixture.address().port}`, BOTDESK_HOST_ID: 'smoke-host', BOTDESK_BOT_TOKEN: 'local-smoke-token-123456789', BOTDESK_BOT_ID: '' },
    stderr: 'pipe'
  });
  transport.stderr?.on('data', () => {});
  const client = new Client({ name: 'botdesk-integration-test', version: '0.1.0' });
  try {
    await client.connect(transport, { timeout: 10_000 });
    const tools = await client.listTools();
    assert.equal(tools.tools.length, 18);
    for (const suffix of ['status', 'capabilities', 'screenshot', 'snapshot', 'list_windows', 'list_monitors', 'focus', 'scroll', 'click', 'move', 'drag', 'type', 'key', 'clipboard_read', 'clipboard_write', 'record_start', 'record_stop', 'stop_all']) {
      assert.ok(tools.tools.some((tool) => tool.name === `botdesk_${suffix}`));
    }
    const capabilities = await client.callTool({ name: 'botdesk_capabilities', arguments: {} });
    assert.equal(JSON.parse(capabilities.content[0].text).contractVersion, '1.1.0');
    const status = await client.callTool({ name: 'botdesk_status', arguments: {} });
    assert.equal(JSON.parse(status.content[0].text).mode, 'off');
    const screenshot = await client.callTool({ name: 'botdesk_screenshot', arguments: {} });
    assert.equal(screenshot.content[0].type, 'image');
    assert.equal(screenshot.content[0].data, pixel);
    assert.equal(JSON.parse(screenshot.content[1].text).snapshotId, 'smoke-image');
    const snapshot = await client.callTool({ name: 'botdesk_snapshot', arguments: {} });
    assert.equal(JSON.parse(snapshot.content[0].text).controls[0].name, 'Fixture button');
    const beforeInvalid = requests.length;
    const invalid = await client.callTool({ name: 'botdesk_click', arguments: { x: 0, y: 0 } });
    assert.equal(invalid.isError, true);
    assert.equal(requests.length, beforeInvalid, 'Invalid input must never reach relay');
    const scroll = await client.callTool({ name: 'botdesk_scroll', arguments: { snapshotId: 'smoke-controls', deltaY: 120 } });
    assert.notEqual(scroll.isError, true);
    const dragArgs = { snapshotId: 'fixture-drag', points: [{ x: 1, y: 2 }, { x: 12, y: 32 }], durationMs: 300 };
    const drag = await client.callTool({ name: 'botdesk_drag', arguments: dragArgs });
    assert.notEqual(drag.isError, true);
    assert.deepEqual(requests.at(-1).args, dragArgs);
    for (const name of ['botdesk_record_stop', 'botdesk_stop_all']) {
      assert.notEqual((await client.callTool({ name, arguments: {} })).isError, true);
    }
    assert.equal(new Set(requests.map((request) => request.botId)).size, 1, 'One MCP process keeps one bot session identity');
    assert.equal(new Set(requests.map((request) => request.requestId)).size, requests.length, 'Every request must have a fresh replay ID');
    return { toolCount: tools.tools.length, relayRequests: requests.length, transport: 'stdio SDK client + loopback HTTP fixture' };
  } finally {
    await client.close();
    await transport.close();
    fixture.closeAllConnections();
    await new Promise((resolveClose) => fixture.close(resolveClose));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runMcpSmoke().then((result) => console.log(`BotDesk MCP smoke passed: ${JSON.stringify(result)}`)).catch((error) => { console.error(error); process.exitCode = 1; });
}

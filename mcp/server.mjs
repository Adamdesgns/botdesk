#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const MAX_RESPONSE_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_REQUEST_BYTES = 16 * 1024;
const snapshotId = { type: 'string', minLength: 1, maxLength: 128 };
const keys = ['ENTER', 'TAB', 'ESCAPE', 'BACKSPACE', 'DELETE', 'ARROWUP', 'ARROWDOWN', 'ARROWLEFT', 'ARROWRIGHT', 'HOME', 'END', 'PAGEUP', 'PAGEDOWN', 'CTRL+A', 'CTRL+Z', 'ALT+LEFT', 'ALT+RIGHT', 'F5'];
const schema = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

export const TOOL_DEFS = [
  { name: 'botdesk_status', description: 'Check connection, owner permission and bot session status. Available while paused or off.', inputSchema: schema() },
  { name: 'botdesk_screenshot', description: 'Capture only the owner-approved foreground Windows window at native resolution. Returns an image, its width/height, and a fresh snapshotId for the next input. Coordinates are pixels relative to this image. Requires armed access; sensitive windows are blocked.', inputSchema: schema() },
  { name: 'botdesk_snapshot', description: 'Read bounded Windows UI Automation controls from only the owner-approved foreground window. Returns target dimensions and a fresh snapshotId for the next input. Password fields and sensitive windows are blocked. No arbitrary JavaScript or shell execution.', inputSchema: schema() },
  { name: 'botdesk_list_windows', description: 'List eligible approved Windows targets while armed. This does not grant input permission or change the selected window.', inputSchema: schema() },
  { name: 'botdesk_click', description: 'Click x/y pixels relative to the last approved target image. A fresh snapshotId from screenshot or snapshot is required; a changed window or stale snapshot is rejected.', inputSchema: schema({ snapshotId, x: { type: 'integer', minimum: 0, maximum: 32767 }, y: { type: 'integer', minimum: 0, maximum: 32767 } }, ['snapshotId', 'x', 'y']) },
  { name: 'botdesk_type', description: 'Type plain text into the approved target using a fresh snapshotId. Input into password/sensitive controls is blocked. Capture again before the next action.', inputSchema: schema({ snapshotId, text: { type: 'string', minLength: 1, maxLength: 4000 } }, ['snapshotId', 'text']) },
  { name: 'botdesk_key', description: 'Press one permitted navigation/editing key in the approved target with a fresh snapshotId. Clipboard and system shortcuts are unavailable.', inputSchema: schema({ snapshotId, key: { type: 'string', enum: keys } }, ['snapshotId', 'key']) },
  { name: 'botdesk_scroll', description: 'Scroll the approved target using a fresh snapshotId. deltaY is a nonzero integer from -1200 to 1200; positive scrolls down, negative up.', inputSchema: schema({ snapshotId, deltaY: { type: 'integer', minimum: -1200, maximum: 1200 } }, ['snapshotId', 'deltaY']) },
  { name: 'botdesk_record_start', description: 'Start a local recording of the owner-approved target window while armed. Recording remains subject to target and sensitive-window guards.', inputSchema: schema() },
  { name: 'botdesk_record_stop', description: 'Stop and save the local recording. Available even after the owner pauses or turns access off.', inputSchema: schema() },
  { name: 'botdesk_stop_all', description: 'Immediately turn BotDesk access off and stop input. Available while paused or off.', inputSchema: schema() }
];

export function validateRelayConfig(config) {
  if (!config?.relayUrl || !config.hostId || !config.botToken) throw new Error('BotDesk MCP is not configured. Set BOTDESK_RELAY_URL, BOTDESK_HOST_ID and BOTDESK_BOT_TOKEN.');
  let url;
  try { url = new URL(config.relayUrl); } catch { throw new Error('Invalid BotDesk relay URL.'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Relay URL must be an HTTPS origin (or explicit HTTP loopback for local testing), without credentials, path, query or fragment.');
  }
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(config.hostId)) throw new Error('Invalid BotDesk host ID.');
  if (typeof config.botToken !== 'string' || !/^[\x21-\x7e]{16,512}$/.test(config.botToken)) throw new Error('Invalid BotDesk bot token.');
  const botId = config.botId || randomUUID();
  if (!/^[a-zA-Z0-9._-]{1,80}$/.test(botId)) throw new Error('Invalid BotDesk bot ID.');
  const timeoutMs = config.timeoutMs ?? 35_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 35_000) throw new Error('Invalid relay timeout.');
  return { ...config, relayUrl: url.origin, botId, timeoutMs };
}

export function validateToolArgs(toolName, args) {
  const tool = TOOL_DEFS.find((candidate) => candidate.name === toolName);
  if (!tool) throw new Error(`Unknown tool: ${toolName}`);
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Tool arguments must be an object.');
  const { properties, required } = tool.inputSchema;
  if (Object.keys(args).some((key) => !Object.hasOwn(properties, key))) throw new Error('Unexpected tool argument.');
  for (const key of required) if (!Object.hasOwn(args, key)) throw new Error(`Missing required argument: ${key}`);
  for (const [key, value] of Object.entries(args)) {
    const rule = properties[key];
    if (rule.type === 'integer' && (!Number.isInteger(value) || value < rule.minimum || value > rule.maximum)) throw new Error(`Invalid ${key}.`);
    if (rule.type === 'string' && (typeof value !== 'string' || value.length < (rule.minLength || 0) || value.length > (rule.maxLength || Infinity) || (rule.enum && !rule.enum.includes(value)))) throw new Error(`Invalid ${key}.`);
  }
  if (toolName === 'botdesk_scroll' && args.deltaY === 0) throw new Error('deltaY must be nonzero.');
  if (toolName === 'botdesk_type' && (/[\u0000-\u001f\u007f]/.test(args.text) || /(?:javascript|vbscript|data|file|shell|ms-settings|powershell):/i.test(args.text))) throw new Error('Control characters and executable URL schemes are not permitted in plain text.');
  return tool.name.slice('botdesk_'.length);
}

async function boundedJson(response) {
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new Error('Relay response exceeded the size limit.');
  }
  if (!response.body) throw new Error('Relay returned an empty response.');
  const reader = response.body.getReader();
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error('Relay response exceeded the size limit.');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('Relay returned invalid JSON.'); }
}

export function createRelayClient(config, fetchImpl = fetch) {
  const connection = validateRelayConfig(config);
  return async function relayCall(toolName, args = {}) {
    const name = validateToolArgs(toolName, args);
    const body = JSON.stringify({ name, args });
    if (Buffer.byteLength(body) > MAX_REQUEST_BYTES) throw new Error('Tool request exceeded the size limit.');
    const aborter = new AbortController();
    let timeout;
    try {
      const operation = (async () => {
        const response = await fetchImpl(`${connection.relayUrl}/api/bot/${connection.hostId}/command`, {
          method: 'POST', redirect: 'error', signal: aborter.signal,
          headers: { authorization: `Bearer ${connection.botToken}`, 'content-type': 'application/json', 'x-bot-id': connection.botId, 'x-request-id': randomUUID() }, body
        });
        const payload = await boundedJson(response);
        if (!response.ok) throw new Error(String(payload?.message || payload?.error || `BotDesk relay returned ${response.status}`).slice(0, 1000));
        if (!payload || typeof payload !== 'object' || payload.ok !== true || !Object.hasOwn(payload, 'result')) throw new Error('Relay returned an invalid command result.');
        return payload.result;
      })();
      const deadline = new Promise((_, reject) => {
        timeout = setTimeout(() => { reject(new Error('BotDesk relay response timed out.')); aborter.abort(); }, connection.timeoutMs);
      });
      return await Promise.race([operation, deadline]);
    } finally { clearTimeout(timeout); aborter.abort(); }
  };
}

let defaultClient;
export async function callRelay(toolName, args = {}) {
  defaultClient ||= createRelayClient({ relayUrl: process.env.BOTDESK_RELAY_URL, hostId: process.env.BOTDESK_HOST_ID, botToken: process.env.BOTDESK_BOT_TOKEN, botId: process.env.BOTDESK_BOT_ID });
  return defaultClient(toolName, args);
}

export function toolContent(toolName, result) {
  if (toolName === 'botdesk_screenshot') {
    const image = result?.image || result;
    if (!image || typeof image.data !== 'string' || image.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(image.data) || !image.data.length || image.data.length % 4 !== 0) throw new Error('Invalid or oversized screenshot image.');
    const imageBytes = Buffer.from(image.data, 'base64');
    if (imageBytes.byteLength > MAX_IMAGE_BYTES || imageBytes.toString('base64') !== image.data) throw new Error('Invalid or oversized screenshot image.');
    if (!['image/png', 'image/jpeg'].includes(image.mimeType)) throw new Error('Unsupported screenshot image format.');
    if (![image.width, image.height].every((value) => Number.isInteger(value) && value > 0 && value <= 32768)) throw new Error('Invalid screenshot dimensions.');
    if (image.mimeType === 'image/png' && (imageBytes.length < 24 || !imageBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || imageBytes.toString('ascii', 12, 16) !== 'IHDR' || imageBytes.readUInt32BE(16) !== image.width || imageBytes.readUInt32BE(20) !== image.height)) throw new Error('Screenshot PNG dimensions do not match the target image.');
    if (image.mimeType === 'image/jpeg' && (imageBytes.length < 5 || imageBytes[0] !== 255 || imageBytes[1] !== 216 || imageBytes[2] !== 255 || imageBytes.at(-2) !== 255 || imageBytes.at(-1) !== 217)) throw new Error('Invalid screenshot JPEG image.');
    if (typeof result.snapshotId !== 'string' || !result.snapshotId.length || result.snapshotId.length > 128) throw new Error('Screenshot has no valid snapshotId.');
    const metadata = JSON.stringify({ snapshotId: result.snapshotId, width: image.width, height: image.height, coordinates: 'Pixels relative to the target image (0,0 is top left). Capture again before each input.', target: result.target || result.window || null });
    if (Buffer.byteLength(metadata) > 1024 * 1024) throw new Error('Oversized screenshot target metadata.');
    return [
      { type: 'image', data: image.data, mimeType: image.mimeType },
      { type: 'text', text: metadata }
    ];
  }
  const text = JSON.stringify(result, null, 2);
  if (typeof text !== 'string' || Buffer.byteLength(text) > 1024 * 1024) throw new Error('Invalid or oversized tool result.');
  return [{ type: 'text', text }];
}

export async function startServer() {
  const server = new Server({ name: 'botdesk', version: '0.1.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFS }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const result = await callRelay(request.params.name, request.params.arguments || {});
      return { content: toolContent(request.params.name, result) };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : 'BotDesk command failed.' }] };
    }
  });
  await server.connect(new StdioServerTransport());
  console.error('[botdesk-mcp] ready');
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  startServer().catch(() => { console.error('[botdesk-mcp] startup failed'); process.exitCode = 1; });
}

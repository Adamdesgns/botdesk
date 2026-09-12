#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { COMMANDS, CAPABILITY_FLAGS } from '../shared/protocol.mjs';
import { CONTRACT_VERSION, ERROR_CODES, classifyRelayError, formatBotError } from '../shared/errors.mjs';

const MAX_RESPONSE_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_REQUEST_BYTES = 16 * 1024;
const snapshotId = { type: 'string', minLength: 1, maxLength: 128 };
const keys = [
  'ENTER', 'TAB', 'ESCAPE', 'BACKSPACE', 'DELETE',
  'ARROWUP', 'ARROWDOWN', 'ARROWLEFT', 'ARROWRIGHT',
  'HOME', 'END', 'PAGEUP', 'PAGEDOWN',
  'CTRL+A', 'CTRL+C', 'CTRL+X', 'CTRL+V', 'CTRL+Z', 'CTRL+S',
  'ALT+LEFT', 'ALT+RIGHT', 'F5',
  'E', 'W', 'A', 'S', 'D', 'SPACE'
];
const schema = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const pointProps = { x: { type: 'integer', minimum: 0, maximum: 32767 }, y: { type: 'integer', minimum: 0, maximum: 32767 } };

export const TOOL_DEFS = [
  { name: 'botdesk_status', description: 'Check connection, owner permission, access scope/expiry and bot session status. Available while paused or off. Distinguishes host-offline, not-armed, session-expired and authentication failures.', inputSchema: schema() },
  { name: 'botdesk_capabilities', description: 'Report the versioned SDK contract, available tools, granted scope flags and hard platform limits (UAC/secure desktop). Does not require arming.', inputSchema: schema() },
  { name: 'botdesk_screenshot', description: 'Capture only the owner-approved foreground Windows window. Returns an image (PNG or JPEG), width/height, and a fresh snapshotId. Coordinates are pixels relative to this image. Requires armed access.', inputSchema: schema() },
  { name: 'botdesk_snapshot', description: 'Read bounded Windows UI Automation controls from only the owner-approved foreground window. Returns labels, roles, enabled state, bounds and a fresh snapshotId. Password fields and sensitive windows are blocked.', inputSchema: schema() },
  { name: 'botdesk_list_windows', description: 'List eligible approved Windows targets while armed. Does not change the selected window or grant input.', inputSchema: schema() },
  { name: 'botdesk_list_monitors', description: 'List connected monitors (bounds, scale factor) for coordinate awareness. Available while armed. Does not grant full-desktop capture.', inputSchema: schema() },
  { name: 'botdesk_focus', description: 'Bring the owner-approved target window to the foreground. Requires armed access. Does not bypass UAC or elevated windows.', inputSchema: schema() },
  { name: 'botdesk_click', description: 'Click x/y pixels relative to the last approved target image. Supports button left|right|middle and count 1|2. A fresh snapshotId is required.', inputSchema: schema({ snapshotId, ...pointProps, button: { type: 'string', enum: ['left', 'right', 'middle'] }, count: { type: 'integer', minimum: 1, maximum: 2 } }, ['snapshotId', 'x', 'y']) },
  { name: 'botdesk_move', description: 'Move the cursor to x/y pixels relative to the last approved target image without clicking. Fresh snapshotId required.', inputSchema: schema({ snapshotId, ...pointProps }, ['snapshotId', 'x', 'y']) },
  { name: 'botdesk_drag', description: 'Bounded left-button drag using a fresh snapshotId. Supply 2–64 distinct consecutive integer points and durationMs 100–2000. Button releases on cancel/STOP/expiry.', inputSchema: schema({ snapshotId, points: { type: 'array', minItems: 2, maxItems: 64, items: schema(pointProps, ['x', 'y']) }, durationMs: { type: 'integer', minimum: 100, maximum: 2000 } }, ['snapshotId', 'points', 'durationMs']) },
  { name: 'botdesk_type', description: 'Type plain text into the approved target using a fresh snapshotId. Password/sensitive controls are blocked.', inputSchema: schema({ snapshotId, text: { type: 'string', minLength: 1, maxLength: 4000 } }, ['snapshotId', 'text']) },
  { name: 'botdesk_key', description: 'Press one permitted key or chord in the approved target with a fresh snapshotId. Includes navigation, editing, CTRL+C/V/X/S, and Studio movement keys E/WASD/SPACE.', inputSchema: schema({ snapshotId, key: { type: 'string', enum: keys } }, ['snapshotId', 'key']) },
  { name: 'botdesk_scroll', description: 'Scroll the approved target. Provide nonzero deltaY and/or deltaX from -1200 to 1200. Fresh snapshotId required.', inputSchema: schema({ snapshotId, deltaY: { type: 'integer', minimum: -1200, maximum: 1200 }, deltaX: { type: 'integer', minimum: -1200, maximum: 1200 } }, ['snapshotId']) },
  { name: 'botdesk_clipboard_read', description: 'Read plain-text clipboard contents while armed. Secrets-like patterns are redacted from the tool result. Prefer secret-reference workflows when entering credentials.', inputSchema: schema() },
  { name: 'botdesk_clipboard_write', description: 'Write plain text to the clipboard while armed (max 4000 chars). Does not paste; use botdesk_key CTRL+V with a fresh snapshot when needed.', inputSchema: schema({ text: { type: 'string', minLength: 1, maxLength: 4000 } }, ['text']) },
  { name: 'botdesk_record_start', description: 'Start a local recording of the owner-approved target window while armed.', inputSchema: schema() },
  { name: 'botdesk_record_stop', description: 'Stop and save the local recording. Available even after pause/off.', inputSchema: schema() },
  { name: 'botdesk_stop_all', description: 'Immediately turn BotDesk access off and stop input. Available while paused or off.', inputSchema: schema() }
];

export function validateRelayConfig(config) {
  const missing = [];
  if (!config?.relayUrl) missing.push('BOTDESK_RELAY_URL');
  if (!config?.hostId) missing.push('BOTDESK_HOST_ID');
  if (!config?.botToken) missing.push('BOTDESK_BOT_TOKEN');
  if (missing.length) {
    const error = new Error(formatBotError(ERROR_CODES.CREDENTIAL_MISSING, `unset ${missing.join(', ')}`));
    error.code = ERROR_CODES.CREDENTIAL_MISSING;
    throw error;
  }
  let url;
  try { url = new URL(config.relayUrl); } catch {
    const error = new Error(formatBotError(ERROR_CODES.MISCONFIGURED, 'Invalid BotDesk relay URL.'));
    error.code = ERROR_CODES.MISCONFIGURED;
    throw error;
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    const error = new Error(formatBotError(ERROR_CODES.MISCONFIGURED, 'Relay URL must be an HTTPS origin (or explicit HTTP loopback), without credentials, path, query or fragment.'));
    error.code = ERROR_CODES.MISCONFIGURED;
    throw error;
  }
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(config.hostId)) {
    const error = new Error(formatBotError(ERROR_CODES.MISCONFIGURED, 'Invalid BotDesk host ID.'));
    error.code = ERROR_CODES.MISCONFIGURED;
    throw error;
  }
  if (typeof config.botToken !== 'string' || !/^[\x21-\x7e]{16,512}$/.test(config.botToken)) {
    const error = new Error(formatBotError(ERROR_CODES.MISCONFIGURED, 'Invalid BotDesk bot token shape.'));
    error.code = ERROR_CODES.MISCONFIGURED;
    throw error;
  }
  const botId = config.botId || randomUUID();
  if (!/^[a-zA-Z0-9._-]{1,80}$/.test(botId)) {
    const error = new Error(formatBotError(ERROR_CODES.MISCONFIGURED, 'Invalid BotDesk bot ID.'));
    error.code = ERROR_CODES.MISCONFIGURED;
    throw error;
  }
  const timeoutMs = config.timeoutMs ?? 35_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 35_000) {
    const error = new Error(formatBotError(ERROR_CODES.MISCONFIGURED, 'Invalid relay timeout.'));
    error.code = ERROR_CODES.MISCONFIGURED;
    throw error;
  }
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
    if (rule.type === 'array') {
      if (!Array.isArray(value) || value.length < (rule.minItems || 0) || value.length > (rule.maxItems || Infinity)) throw new Error(`Invalid ${key}.`);
    }
  }
  if (toolName === 'botdesk_scroll') {
    const hasY = Object.hasOwn(args, 'deltaY');
    const hasX = Object.hasOwn(args, 'deltaX');
    if (!hasY && !hasX) throw new Error('Provide deltaY and/or deltaX.');
    if (hasY && args.deltaY === 0 && (!hasX || args.deltaX === 0)) throw new Error('Scroll deltas must be nonzero overall.');
    if (hasX && args.deltaX === 0 && (!hasY || args.deltaY === 0)) throw new Error('Scroll deltas must be nonzero overall.');
  }
  if (toolName === 'botdesk_drag') {
    if (!Array.isArray(args.points) || args.points.length < 2 || args.points.length > 64) throw new Error('Invalid points.');
    for (let index = 0; index < args.points.length; index++) {
      const point = args.points[index], previous = args.points[index - 1];
      if (!point || typeof point !== 'object' || Array.isArray(point) || Object.keys(point).length !== 2 || !Object.hasOwn(point, 'x') || !Object.hasOwn(point, 'y') || ![point.x, point.y].every((value) => Number.isInteger(value) && value >= 0 && value <= 32767)) throw new Error('Invalid point.');
      if (previous && point.x === previous.x && point.y === previous.y) throw new Error('Consecutive drag points must differ.');
    }
  }
  if (toolName === 'botdesk_type' && (/[\u0000-\u001f\u007f]/.test(args.text) || /(?:javascript|vbscript|data|file|shell|ms-settings|powershell):/i.test(args.text))) throw new Error('Control characters and executable URL schemes are not permitted in plain text.');
  if (toolName === 'botdesk_clipboard_write' && (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(args.text))) throw new Error('Clipboard text must be plain printable text.');
  return tool.name.slice('botdesk_'.length);
}

async function boundedJson(response) {
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw Object.assign(new Error(formatBotError(ERROR_CODES.PAYLOAD_TOO_LARGE, 'Relay response exceeded the size limit.')), { code: ERROR_CODES.PAYLOAD_TOO_LARGE });
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
      if (size > MAX_RESPONSE_BYTES) throw Object.assign(new Error(formatBotError(ERROR_CODES.PAYLOAD_TOO_LARGE, 'Relay response exceeded the size limit.')), { code: ERROR_CODES.PAYLOAD_TOO_LARGE });
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
    if (name === 'capabilities') {
      return {
        contractVersion: CONTRACT_VERSION,
        commands: [...COMMANDS],
        tools: TOOL_DEFS.map((tool) => tool.name),
        capabilities: CAPABILITY_FLAGS,
        limitations: [
          'Cannot bypass Windows UAC or secure desktop.',
          'Elevated integrity and password controls are blocked.',
          'Selected-window mode is the default; full-desktop mode requires an explicit owner grant (not yet enabled).',
          'Do not replay clicks after timeout, cancel, disconnect or expiry.'
        ],
        errors: ERROR_CODES
      };
    }
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
        if (!response.ok) {
          const code = classifyRelayError(response.status, payload);
          throw Object.assign(new Error(formatBotError(code, payload?.message || payload?.error || `HTTP ${response.status}`)), { code, status: response.status });
        }
        if (!payload || typeof payload !== 'object' || payload.ok !== true || !Object.hasOwn(payload, 'result')) throw new Error('Relay returned an invalid command result.');
        return payload.result;
      })();
      const deadline = new Promise((_, reject) => {
        timeout = setTimeout(() => {
          const error = Object.assign(new Error(formatBotError(ERROR_CODES.COMMAND_TIMEOUT, 'BotDesk relay response timed out.')), { code: ERROR_CODES.COMMAND_TIMEOUT });
          reject(error);
          aborter.abort();
        }, connection.timeoutMs);
      });
      return await Promise.race([operation, deadline]);
    } finally { clearTimeout(timeout); aborter.abort(); }
  };
}

let defaultClient;
export async function callRelay(toolName, args = {}) {
  try {
    defaultClient ||= createRelayClient({ relayUrl: process.env.BOTDESK_RELAY_URL, hostId: process.env.BOTDESK_HOST_ID, botToken: process.env.BOTDESK_BOT_TOKEN, botId: process.env.BOTDESK_BOT_ID });
  } catch (error) {
    if (!error.code) {
      error.code = ERROR_CODES.CREDENTIAL_MISSING;
      error.message = formatBotError(ERROR_CODES.CREDENTIAL_MISSING, error.message);
    }
    throw error;
  }
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
    const metadata = JSON.stringify({ snapshotId: result.snapshotId, width: image.width, height: image.height, mimeType: image.mimeType, coordinates: 'Pixels relative to the target image (0,0 is top left). Capture again before each input.', target: result.target || result.window || null });
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
  const server = new Server({ name: 'botdesk', version: CONTRACT_VERSION }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFS }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const result = await callRelay(request.params.name, request.params.arguments || {});
      return { content: toolContent(request.params.name, result) };
    } catch (error) {
      const text = error instanceof Error ? error.message : formatBotError(ERROR_CODES.UNKNOWN);
      return { isError: true, content: [{ type: 'text', text }] };
    }
  });
  await server.connect(new StdioServerTransport());
  console.error('[botdesk-mcp] ready');
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  startServer().catch(() => { console.error('[botdesk-mcp] startup failed'); process.exitCode = 1; });
}

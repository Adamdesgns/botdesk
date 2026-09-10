import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
// PowerShell cannot open files inside Electron's archive. The installer unpacks this helper.
const helperPath = path.resolve(moduleDir, '../scripts/windows-helper.ps1').replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
const MAX_OUTPUT_BYTES = 24 * 1024 * 1024;
const ACTIONS = new Set(['foreground', 'list_windows', 'focus', 'capture', 'snapshot', 'click', 'drag', 'type', 'key', 'scroll']);
const DRAG_TIMING_PREFIX = 'BOTDESK_DRAG_TIMING ';
const DRAG_TIMING_FIELDS = ['phase', 'checkCount', 'moveCount', 'elapsedMs', 'costMs', 'targetMs', 'pointMs', 'completed'];
// Exported only for an inert transport fixture. No native stderr is forwarded
// unless the owner opted in; exact numeric fields are rebuilt before emitting.
export function createDragTimingForwarder(emit = entry => process.stderr.write(`${DRAG_TIMING_PREFIX}${JSON.stringify(entry)}\n`)) {
  const enabled = process.env.BOTDESK_DRAG_TIMING === '1';
  let pending = '', bytes = 0, lines = 0;
  return chunk => {
    if (!enabled || lines >= 256 || bytes > 65536) return;
    bytes += Buffer.byteLength(chunk);
    if (bytes > 65536) { pending = ''; return; }
    pending += chunk;
    for (;;) {
      const end = pending.indexOf('\n');
      if (end < 0) break;
      const line = pending.slice(0, end).replace(/\r$/, ''); pending = pending.slice(end + 1);
      if (!line.startsWith(DRAG_TIMING_PREFIX) || line.length > 1024) continue;
      try {
        const value = JSON.parse(line.slice(DRAG_TIMING_PREFIX.length));
        if (!value || Array.isArray(value) || Object.keys(value).length !== DRAG_TIMING_FIELDS.length ||
          !DRAG_TIMING_FIELDS.every(field => Number.isSafeInteger(value[field]) && value[field] >= 0 && value[field] <= 60000) ||
          ![1, 2, 3, 4, 5, 7].includes(value.phase) || value.checkCount > 256 || value.moveCount > 256 || value.completed > 1) continue;
        if (++lines > 256) return;
        emit(Object.fromEntries(DRAG_TIMING_FIELDS.map(field => [field, value[field]])));
      } catch { /* Never expose foreign stderr or malformed diagnostic text. */ }
    }
    if (pending.length > 1024) pending = '';
  };
}
function powershellPath() {
  return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}
// Injectable spawn is for fixture tests; the caller never supplies executable or shell text.
export function runWindowsAction(action, args = {}, { timeoutMs = 8000, signal, spawnImpl = spawn } = {}) {
  if (!ACTIONS.has(action)) return Promise.resolve({ ok: false, error: 'unknown-action' });
  if (signal?.aborted) return Promise.resolve({ ok: false, error: 'windows-helper-aborted' });
  if (action === 'drag') return runDragHelper(args, { timeoutMs, signal, spawnImpl });
  return runSingleHelper(action, args, { timeoutMs, signal, spawnImpl });
}
function runSingleHelper(action, args, { timeoutMs = 8000, signal, spawnImpl = spawn } = {}) {
  return new Promise((resolve) => {
    let child;
    let timer;
    let stdout = '';
    let outputBytes = 0;
    let settled = false;
    const finish = (value, kill = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (kill) { try { child?.kill(); } catch { /* already stopped */ } }
      resolve(value);
    };
    const abort = () => finish({ ok: false, error: 'windows-helper-aborted' }, true);
    try {
      child = spawnImpl(powershellPath(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helperPath], {
        shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch { return finish({ ok: false, error: 'windows-helper-start-failed' }); }
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) return abort();
    timer = setTimeout(() => finish({ ok: false, error: 'windows-helper-timeout' }, true), Math.min(30000, Math.max(1, timeoutMs)));
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > MAX_OUTPUT_BYTES) return finish({ ok: false, error: 'windows-helper-output-limit' }, true);
      stdout += chunk;
    });
    // Do not return native exception strings: they can contain window or input content.
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => finish({ ok: false, error: 'windows-helper-input-failed' }, true));
    child.on('error', () => finish({ ok: false, error: 'windows-helper-start-failed' }));
    child.on('close', (code) => {
      if (code !== 0) return finish({ ok: false, error: 'windows-helper-failed' });
      try {
        const result = JSON.parse(stdout.trim());
        if (!result || typeof result !== 'object' || typeof result.ok !== 'boolean') throw new Error('invalid');
        finish(result);
      } catch { finish({ ok: false, error: 'windows-helper-invalid-response' }); }
    });
    try { child.stdin.end(`${JSON.stringify({ action, args })}\n`); }
    catch { finish({ ok: false, error: 'windows-helper-input-failed' }, true); }
  });
}
// Drag alone spans a button-down/up pair. Cancellation first asks the native
// helper to release under its input lock, then kills a stuck helper. Never send
// the emergency button-up until the original process has actually exited.
function runDragHelper(args, { timeoutMs, signal, spawnImpl }) {
  return new Promise((resolve) => {
    let child, timer, killTimer, exitTimer, settled = false, closed = false, stopping = null;
    let pending = '', outputBytes = 0, held = false, result = null, malformed = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); clearTimeout(killTimer); clearTimeout(exitTimer);
      signal?.removeEventListener('abort', abort);
      resolve(value);
    };
    const stop = (error) => {
      if (settled || stopping) return;
      stopping = { ok: false, error };
      clearTimeout(timer);
      if (closed) return; // Cleanup is already running; do not touch the exited child.
      try { child.stdin.end('cancel\n'); } catch { /* force-stop follows */ }
      killTimer = setTimeout(() => {
        try { child.kill(); } catch { /* failure is reported below */ }
        if (!closed) exitTimer = setTimeout(() => finish({ ok: false, error: 'windows-drag-stop-unconfirmed' }), 1500);
      }, 250);
    };
    const abort = () => stop('windows-helper-aborted');
    const consume = (line) => {
      if (!line.trim()) return;
      let value;
      try { value = JSON.parse(line); } catch { malformed = true; return; }
      if (value?.dragProgress === 'button-held' && Object.keys(value).length === 1) held = true;
      else if (value?.dragProgress === 'button-released' && Object.keys(value).length === 1) held = false;
      else if (value && typeof value === 'object' && typeof value.ok === 'boolean' && result === null) result = value;
      else malformed = true;
    };
    try {
      child = spawnImpl(powershellPath(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helperPath], {
        shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch { return finish({ ok: false, error: 'windows-helper-start-failed' }); }
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > 16384) return stop('windows-helper-output-limit');
      pending += chunk;
      for (;;) { const index = pending.indexOf('\n'); if (index < 0) break; consume(pending.slice(0, index)); pending = pending.slice(index + 1); }
    });
    child.stderr.on('data', createDragTimingForwarder());
    child.stdin.on('error', () => stop('windows-helper-input-failed'));
    child.on('error', () => stop('windows-helper-start-failed'));
    child.on('close', async (code) => {
      if (closed) return;
      closed = true;
      clearTimeout(timer); clearTimeout(killTimer); clearTimeout(exitTimer);
      consume(pending); pending = '';
      const outcome = stopping || (code === 0 && !malformed && result ? result : { ok: false, error: code !== 0 ? 'windows-helper-failed' : 'windows-helper-invalid-response' });
      if (held) {
        // Internal safety cleanup only: absent from SDK, relay and ACTIONS.
        const release = await runSingleHelper('release_left', {}, { timeoutMs: 8000, spawnImpl });
        if (!release.ok) return finish({ ok: false, error: 'windows-drag-release-unconfirmed' });
      }
      finish(stopping || outcome);
    });
    try { child.stdin.write(`${JSON.stringify({ action: 'drag', args })}\n`); }
    catch { stop('windows-helper-input-failed'); }
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    if (!stopping) timer = setTimeout(() => stop('windows-helper-timeout'), Math.min(12000, Math.max(1, timeoutMs)));
  });
}
export async function foregroundWindow(options) {
  const result = await runWindowsAction('foreground', {}, options);
  return result.ok ? result.window : {};
}
export const listWindows = (options) => runWindowsAction('list_windows', {}, options);
export const focus = (args, options) => runWindowsAction('focus', args, options);
export const capture = (args, options) => runWindowsAction('capture', args, options);
export const snapshot = (args, options) => runWindowsAction('snapshot', args, options);
export const click = (args, options) => runWindowsAction('click', args, options);
export const drag = (args, options) => runWindowsAction('drag', args, options);
export const typeText = (args, options) => runWindowsAction('type', args, options);
export const pressKey = (args, options) => runWindowsAction('key', args, options);
export const scroll = (args, options) => runWindowsAction('scroll', args, options);

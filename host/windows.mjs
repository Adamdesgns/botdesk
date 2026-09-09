import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
// PowerShell cannot open files inside Electron's archive. The installer unpacks this helper.
const helperPath = path.resolve(moduleDir, '../scripts/windows-helper.ps1').replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
const MAX_OUTPUT_BYTES = 24 * 1024 * 1024;
const ACTIONS = new Set(['foreground', 'list_windows', 'focus', 'capture', 'snapshot', 'click', 'type', 'key', 'scroll']);
function powershellPath() {
  return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}
// Injectable spawn is for fixture tests; the caller never supplies executable or shell text.
export function runWindowsAction(action, args = {}, { timeoutMs = 8000, signal, spawnImpl = spawn } = {}) {
  if (!ACTIONS.has(action)) return Promise.resolve({ ok: false, error: 'unknown-action' });
  if (signal?.aborted) return Promise.resolve({ ok: false, error: 'windows-helper-aborted' });
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
export async function foregroundWindow(options) {
  const result = await runWindowsAction('foreground', {}, options);
  return result.ok ? result.window : {};
}
export const listWindows = (options) => runWindowsAction('list_windows', {}, options);
export const focus = (args, options) => runWindowsAction('focus', args, options);
export const capture = (args, options) => runWindowsAction('capture', args, options);
export const snapshot = (args, options) => runWindowsAction('snapshot', args, options);
export const click = (args, options) => runWindowsAction('click', args, options);
export const typeText = (args, options) => runWindowsAction('type', args, options);
export const pressKey = (args, options) => runWindowsAction('key', args, options);
export const scroll = (args, options) => runWindowsAction('scroll', args, options);

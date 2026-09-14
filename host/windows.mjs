import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
// PowerShell cannot open files inside Electron's archive. The installer unpacks this helper.
export const helperPath = path.resolve(moduleDir, '../scripts/windows-helper.ps1').replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
const MAX_OUTPUT_BYTES = 24 * 1024 * 1024;
const ACTIONS = new Set(['foreground', 'list_windows', 'focus', 'capture', 'snapshot', 'click', 'type', 'key', 'scroll']);
export function powershellPath() {
  return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}
const HELPER_ERRORS = {
  'unsupported-platform': 'Bot Door controls Windows only. The native helper cannot run on this operating system.',
  'windows-helper-missing': 'The Windows helper script was not found next to the application. Reinstall or rebuild the portable package; the build must unpack scripts/windows-helper.ps1.',
  'windows-helper-start-failed': 'Windows PowerShell could not be started. Confirm powershell.exe exists under System32\\WindowsPowerShell\\v1.0 and is not blocked by policy.',
  'windows-helper-failed': 'Windows PowerShell exited with an error before the helper could answer. Common causes: PowerShell Constrained Language Mode or an AppLocker/WDAC policy blocking Add-Type, or missing .NET Framework UI Automation assemblies.',
  'windows-helper-timeout': 'The Windows helper did not answer in time. The first run compiles the helper and can take several seconds on a slow PC; try again. Persistent timeouts usually mean antivirus is scanning PowerShell or the PC is overloaded.',
  'windows-helper-invalid-response': 'The Windows helper returned something other than its JSON answer. Another PowerShell profile or policy may be writing to the console; the helper runs with -NoProfile, so check for system-wide PowerShell transcription or logging hooks.',
  'windows-helper-output-limit': 'The Windows helper produced more output than expected. Try again with a smaller approved window.',
  'windows-helper-input-failed': 'The Windows helper closed before it read its request. Try again; if it repeats, check PowerShell policy.',
  'windows-helper-aborted': 'The action was cancelled by a stop or a newer request.',
  'native-action-blocked': 'Windows refused the action or the helper blocked it: the approved window may have closed, moved behind a sensitive window, or lost its ordinary privileges.',
  'focus-refused': 'Windows refused to bring the approved window to the front. Click that window once on the PC and try again.',
  'target-not-foreground': 'The approved window is not in the foreground on the PC.'
};
export function describeHelperError(code) {
  const clean = String(code || 'windows-helper-failed').slice(0, 64);
  return (HELPER_ERRORS[clean] || 'The Windows helper reported an error.') + ' (' + clean + ')';
}
// Compiles the fixed helper without reading input or touching any window. Confirms PowerShell,
// .NET and policy prerequisites before the owner reaches REFRESH WINDOWS.
export function helperSelfTest({ timeoutMs = 30000, spawnImpl = spawn, platform = process.platform, helperFile = helperPath } = {}) {
  const startedAt = Date.now();
  const finish = (result) => ({ ...result, checkedAt: new Date(startedAt).toISOString(), durationMs: Date.now() - startedAt, ...(result.ok ? {} : { message: describeHelperError(result.error) }) });
  if (platform !== 'win32') return Promise.resolve(finish({ ok: false, error: 'unsupported-platform' }));
  if (!existsSync(helperFile)) return Promise.resolve(finish({ ok: false, error: 'windows-helper-missing' }));
  return new Promise((resolve) => {
    let child;
    let timer;
    let stdout = '';
    let stderr = '';
    let settled = false;
    const done = (result, kill = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (kill) { try { child?.kill(); } catch { /* already stopped */ } }
      resolve(finish(result));
    };
    try {
      child = spawnImpl(powershellPath(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helperFile, '-CompileOnly'], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch { return done({ ok: false, error: 'windows-helper-start-failed' }); }
    timer = setTimeout(() => done({ ok: false, error: 'windows-helper-timeout' }, true), Math.min(60000, Math.max(1, timeoutMs)));
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { if (stdout.length < 4096) stdout += chunk; });
    // Compile-only output never contains window content; keep a bounded, printable excerpt for the diagnostic report.
    child.stderr.on('data', (chunk) => { if (stderr.length < 600) stderr += chunk; });
    child.on('error', () => done({ ok: false, error: 'windows-helper-start-failed' }));
    child.on('close', (code) => {
      const excerpt = stderr.replace(/[^\x20-\x7e\n]/g, '').replace(/\s+/g, ' ').trim().slice(0, 300);
      if (code !== 0) return done({ ok: false, error: 'windows-helper-failed', exitCode: code, ...(excerpt ? { stderrExcerpt: excerpt } : {}) });
      try {
        const result = JSON.parse(stdout.trim());
        if (result?.ok === true && result.compiled === true) return done({ ok: true, compiled: true });
        done({ ok: false, error: 'windows-helper-invalid-response' });
      } catch { done({ ok: false, error: 'windows-helper-invalid-response', ...(excerpt ? { stderrExcerpt: excerpt } : {}) }); }
    });
  });
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

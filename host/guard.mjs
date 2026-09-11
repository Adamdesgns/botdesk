import { COMMANDS, isCommand } from '../shared/protocol.mjs';
const DENY_PATTERNS = Object.freeze({
  financial: [/\bstripe\b/i, /\bpaypal\b/i, /\bvenmo\b/i, /\bcash\s*app\b/i, /\bbank(?:ing)?\b/i, /\bcredit\s*card\b/i, /\bbrokerage\b/i, /\bcrypto\b/i, /\bwallet\b/i],
  credential: [/\bsign\s*in\b/i, /\blog\s*in\b/i, /\blogin\b/i, /\bpassword\b/i, /credential\s*manager/i, /authenticator/i, /1password/i, /bitwarden/i, /lastpass/i, /keepass/i],
  system: [/user\s*account\s*control/i, /\buac\b/i, /windows\s*security/i, /registry\s*editor/i, /regedit/i, /task\s*manager/i, /device\s*manager/i, /control\s*panel/i, /windows\s*defender/i, /group\s*policy/i, /devtools/i, /developer\s*tools/i, /powershell/i, /command\s*prompt/i, /\bterminal\b/i]
});
const SAFE_KEYS = new Set(['ENTER', 'TAB', 'ESCAPE', 'BACKSPACE', 'DELETE', 'ARROWUP', 'ARROWDOWN', 'ARROWLEFT', 'ARROWRIGHT', 'HOME', 'END', 'PAGEUP', 'PAGEDOWN', 'CTRL+A', 'CTRL+Z', 'ALT+LEFT', 'ALT+RIGHT', 'F5']);
export const DEFAULT_APP_ALLOWLIST = Object.freeze(['msedge', 'chrome', 'firefox', 'notepad']);
const UNSAFE_APPS = new Set(['powershell', 'pwsh', 'cmd', 'windowsterminal', 'conhost', 'regedit', 'taskmgr', 'mmc', 'explorer', 'code', 'wscript', 'cscript', 'python', 'pythonw']);
const normalizeApp = (value) => String(value || '').trim().toLowerCase().replace(/\.exe$/, '');
const reject = (category, reason) => ({ allowed: false, category, reason });
export function classifyWindow(window = {}) {
  const joined = [window.processName, window.title].filter(Boolean).join(' ');
  for (const [category, patterns] of Object.entries(DENY_PATTERNS)) {
    if (patterns.some((pattern) => pattern.test(joined))) return reject(category, `${category} windows are off-limits.`);
  }
  const integrity = String(window.integrity || '').toLowerCase();
  if (!['low', 'medium'].includes(integrity)) return reject(integrity === 'unknown' || !integrity ? 'unknown-integrity' : 'elevated', 'The target must have verified ordinary Windows privileges.');
  if (window.desktop !== 'default') return reject('desktop-blocked', 'The normal unlocked interactive desktop is required.');
  if (window.automationChecked !== true) return reject('automation-unavailable', 'Windows could not verify the target controls.');
  if (window.passwordFocused !== false || window.passwordPresent !== false) return reject('credential', 'Password controls are off-limits.');
  if (!window.handle || !Number.isInteger(window.processId) || window.processId <= 0 || !window.processName || !window.title) return reject('unknown-window', 'The target window could not be verified.');
  if (UNSAFE_APPS.has(normalizeApp(window.processName))) return reject('app-blocked', 'Shells, system tools and code editors are off-limits.');
  return { allowed: true, category: 'ordinary', reason: '' };
}
export function validateCommand(name, args = {}, context = {}) {
  if (!isCommand(name)) return reject('unknown-command', 'Unknown command.');
  if (name === 'status' || name === 'stop_all') return { allowed: true };
  if (!['armed', 'running'].includes(context.mode)) return reject('not-armed', 'BotDesk is not armed.');
  if (!Number.isFinite(context.expiresAt) || (context.now ?? Date.now()) >= context.expiresAt) return reject('expired', 'The armed session expired.');
  const target = context.targetWindow;
  const foreground = context.foreground || {};
  if (!target?.handle || !Number.isInteger(target.processId)) return reject('target-required', 'Choose a target window on the PC first.');
  if (name === 'focus') {
    const verdict = classifyWindow(target);
    if (!verdict.allowed) return verdict;
    const app = normalizeApp(target.processName);
    if (!(context.allowedApps || DEFAULT_APP_ALLOWLIST).map(normalizeApp).includes(app)) return reject('app-blocked', 'The approved app is not on the local allowlist.');
    return { allowed: true };
  }
  if (String(target.handle) !== String(foreground.handle) || target.processId !== foreground.processId) return reject('target-changed', 'The approved window must remain in the foreground.');
  const verdict = classifyWindow(foreground);
  if (!verdict.allowed) return verdict;
  const app = normalizeApp(foreground.processName);
  if (!(context.allowedApps || DEFAULT_APP_ALLOWLIST).map(normalizeApp).includes(app)) return reject('app-blocked', 'The focused app is not on the local allowlist.');
  if (name === 'click') {
    const g = foreground.geometry;
    if (!Number.isInteger(args.x) || !Number.isInteger(args.y) || !g || args.x < 0 || args.y < 0 || args.x >= g.width || args.y >= g.height) return reject('bad-arguments', 'Click coordinates must fall inside the approved screenshot.');
  }
  if (name === 'type' && (typeof args.text !== 'string' || args.text.length < 1 || args.text.length > 4000 || /[\u0000-\u001f\u007f]/.test(args.text) || /(?:javascript|vbscript|data|file|shell|ms-settings|powershell):/i.test(args.text))) return reject('bad-arguments', 'Text must be plain printable text, up to 4,000 characters.');
  if (name === 'key' && !SAFE_KEYS.has(String(args.key || '').toUpperCase())) return reject('key-blocked', 'That shortcut is not permitted.');
  if (name === 'scroll' && (!Number.isInteger(args.deltaY) || !args.deltaY || Math.abs(args.deltaY) > 1200)) return reject('bad-arguments', 'Scroll must be a nonzero integer from -1200 to 1200.');
  return { allowed: true };
}
export { COMMANDS, DENY_PATTERNS, SAFE_KEYS };

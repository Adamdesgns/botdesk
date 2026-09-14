import fs from 'node:fs';
import path from 'node:path';
import { describeRelayStatus, retryText } from './relay-status.mjs';

const SECRET_KEYS = ['hostToken', 'ownerToken', 'botToken'];
const AUDIT_TAIL_BYTES = 64 * 1024;

// Defence in depth: known secret values are removed first, then anything shaped like a token.
export function redactReport(text, { secrets = [], home = '' } = {}) {
  let out = String(text ?? '');
  for (const secret of secrets) if (typeof secret === 'string' && secret.length >= 8) out = out.split(secret).join('[redacted]');
  out = out.replace(/dpapi:[A-Za-z0-9+/=]+/g, 'dpapi:[redacted]');
  out = out.replace(/Bearer\s+[^\s"'\\]+/gi, 'Bearer [redacted]');
  out = out.replace(/#[A-Za-z0-9_-]{8,}/g, '#[redacted]');
  out = out.replace(/(?<![A-Za-z0-9_+/-])[A-Za-z0-9_-]{40,}(?![A-Za-z0-9_-])/g, '[redacted-token]');
  if (home && home.length > 3) {
    for (const variant of new Set([home, home.replace(/\\/g, '/'), home.replace(/\//g, '\\'), home.replace(/\\/g, '\\\\')])) out = out.split(variant).join('~');
  }
  return out;
}

export function readRecentAudit(directory, limit = 20) {
  try {
    const files = fs.readdirSync(directory).filter((name) => /^audit-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)).sort();
    const latest = files.at(-1);
    if (!latest) return [];
    const file = path.join(directory, latest);
    const size = fs.statSync(file).size;
    const handle = fs.openSync(file, 'r');
    try {
      const length = Math.min(size, AUDIT_TAIL_BYTES);
      const buffer = Buffer.alloc(length);
      fs.readSync(handle, buffer, 0, length, size - length);
      const lines = buffer.toString('utf8').split('\n').filter(Boolean);
      return lines.slice(-limit).map((line) => {
        try {
          const entry = JSON.parse(line);
          return { time: String(entry.time || '').slice(0, 40), botId: String(entry.botId || '').slice(0, 80), command: String(entry.command || '').slice(0, 80), outcome: String(entry.outcome || '').slice(0, 80), app: String(entry.app || '').slice(0, 80) };
        } catch { return { unreadable: true }; }
      });
    } finally { fs.closeSync(handle); }
  } catch { return []; }
}

const iso = (value) => (Number.isFinite(value) ? new Date(value).toISOString() : null);
const tokenState = (value) => (typeof value === 'string' && value.length > 0 ? 'saved' : 'missing');

function notes({ config, status, helper, prerequisites }) {
  const list = [];
  const relay = status.relay || {};
  if (!config.relayUrl || !config.hostId || !config.hostToken || !config.ownerToken) list.push('Pairing is incomplete: paste the completed pairing file and SAVE SETTINGS. The host needs relayUrl, hostId, hostToken and ownerToken.');
  else if (!relay.authenticated) list.push('Relay: ' + describeRelayStatus(relay).label + ' - ' + describeRelayStatus(relay).detail);
  if (prerequisites.credentialEncryption === false) list.push('Windows credential encryption is unavailable; pairing tokens cannot be saved.');
  if (prerequisites.emergencyShortcutRegistered === false) list.push('The Ctrl+Shift+F12 emergency stop could not be registered; another program may own that shortcut.');
  if (helper && helper.ok === false) list.push('Windows helper: ' + (helper.message || helper.error));
  if (status.stopLatched) list.push('The local stop is latched. Remote arming is rejected with local-stop-latched until UNLOCK LOCAL STOP is used on this PC.');
  if (!status.targetWindow) list.push('No approved window is selected. Remote or scheduled arming is rejected with select-a-window-first until REFRESH WINDOWS and a selection are done on this PC.');
  if (!config.allowRemoteArm) list.push('Remote arming is disabled. Phone GO LIVE and schedules are rejected with remote-arm-disabled until the setting is enabled and saved (local GO LIVE enables it).');
  if (!list.length) list.push('No setup blockers detected. If the bot still cannot act, compare the bot error code with docs/TROUBLESHOOTING.md.');
  return list;
}

export function buildDiagnosticReport({ app = {}, config = {}, status = {}, helper = null, audit = [], prerequisites = {}, paths = {}, now = Date.now() } = {}) {
  const relay = status.relay || {};
  const summary = describeRelayStatus(relay);
  const target = status.targetWindow || null;
  return {
    report: 'Bot Door diagnostic report',
    generatedAt: new Date(now).toISOString(),
    redaction: 'Tokens, pairing secrets, window titles, typed text and screenshots are never included. Home directory paths are shortened to ~.',
    app: {
      version: app.version || null, packaged: Boolean(app.packaged), portable: Boolean(app.portable), background: Boolean(app.background),
      electron: app.electron || null, chrome: app.chrome || null, node: app.node || null,
      platform: app.platform || process.platform, release: app.release || null, arch: app.arch || process.arch, locale: app.locale || null
    },
    paths: { userData: paths.userData || null, helper: paths.helper || null, configFileExists: Boolean(paths.configFileExists) },
    prerequisites: {
      credentialEncryption: prerequisites.credentialEncryption ?? null,
      emergencyShortcutRegistered: prerequisites.emergencyShortcutRegistered ?? null,
      windowsHelper: helper ? { ok: helper.ok, error: helper.error || null, message: helper.message || null, exitCode: helper.exitCode ?? null, stderrExcerpt: helper.stderrExcerpt || null, checkedAt: helper.checkedAt || null, durationMs: helper.durationMs ?? null } : { ok: null, message: 'not checked' }
    },
    configuration: {
      relayUrl: config.relayUrl || null, hostId: config.hostId || null,
      hostToken: tokenState(config.hostToken), ownerToken: tokenState(config.ownerToken), botToken: tokenState(config.botToken),
      allowRemoteArm: Boolean(config.allowRemoteArm), startAtLogin: Boolean(config.startAtLogin), allowedApps: Array.isArray(config.allowedApps) ? config.allowedApps : []
    },
    connection: {
      label: summary.label, detail: summary.detail, retry: retryText(relay, now) || null,
      connected: Boolean(relay.connected), authenticated: Boolean(relay.authenticated), reason: relay.reason || null, code: relay.code || null,
      httpStatus: relay.httpStatus ?? null, closeCode: relay.closeCode ?? null, closeReason: relay.closeReason || null, attempts: relay.attempts ?? 0,
      lastAuthenticatedAt: iso(relay.lastAuthenticatedAt), lastErrorAt: iso(relay.lastErrorAt), nextRetryAt: iso(relay.nextRetryAt)
    },
    session: {
      mode: status.mode || 'off', expiresAt: iso(status.expiresAt), stopLatched: Boolean(status.stopLatched), activeBot: status.activeBot || null, recording: Boolean(status.recording),
      targetSelected: Boolean(target),
      target: target ? { processName: target.processName || null, integrity: target.integrity || null, desktop: target.desktop || null, automationChecked: target.automationChecked ?? null, size: target.geometry ? `${target.geometry.width}x${target.geometry.height}` : null } : null
    },
    recentAudit: audit,
    notes: notes({ config, status, helper, prerequisites })
  };
}

export function renderDiagnosticReport(input) {
  const report = buildDiagnosticReport(input);
  const config = input?.config || {};
  const secrets = SECRET_KEYS.map((key) => config[key]).concat(input?.extraSecrets || []);
  return redactReport(JSON.stringify(report, null, 2), { secrets, home: input?.paths?.home || '' });
}

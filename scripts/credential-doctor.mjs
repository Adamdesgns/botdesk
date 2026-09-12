#!/usr/bin/env node
/**
 * Owner-side credential presence doctor. Prints states only — never token values.
 * Distinguishes real AppData vs Codex MSIX virtualized AppData.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = os.homedir();
const candidates = [
  {
    label: 'real-local-pairing',
    path: path.join(home, 'AppData', 'Local', 'BotDesk-Setup', 'botdesk-pairing.json')
  },
  {
    label: 'real-roaming-config',
    path: path.join(home, 'AppData', 'Roaming', 'botdesk', 'config.json')
  },
  {
    label: 'real-local-config',
    path: path.join(home, 'AppData', 'Local', 'BotDesk', 'config.json')
  },
  {
    label: 'codex-virtualized-pairing',
    path: path.join(home, 'AppData', 'Local', 'Packages', 'OpenAI.Codex_2p2nqsd0c76g0', 'LocalCache', 'Local', 'BotDesk-Setup', 'botdesk-pairing.json')
  },
  {
    label: 'codex-virtualized-config',
    path: path.join(home, 'AppData', 'Local', 'Packages', 'OpenAI.Codex_2p2nqsd0c76g0', 'LocalCache', 'Roaming', 'botdesk', 'config.json')
  }
];

function secretState(value) {
  if (value == null || value === '') return 'absent';
  if (typeof value === 'string' && value.startsWith('dpapi:')) return 'dpapi-present';
  if (typeof value === 'string' && value.length >= 16) return 'present';
  return 'invalid';
}

function inspect(filePath) {
  if (!fs.existsSync(filePath)) return { exists: false };
  const raw = fs.readFileSync(filePath, 'utf8');
  let json;
  try { json = JSON.parse(raw); } catch { return { exists: true, parseError: true, bytes: raw.length }; }
  return {
    exists: true,
    bytes: raw.length,
    provisioningStatus: json.provisioningStatus || null,
    hostId: typeof json.hostId === 'string' ? json.hostId : null,
    relayUrl: typeof json.relayUrl === 'string' ? json.relayUrl : null,
    botToken: secretState(json.botToken),
    hostToken: secretState(json.hostToken),
    ownerToken: secretState(json.ownerToken),
    allowedApps: Array.isArray(json.allowedApps) ? json.allowedApps : null
  };
}

const report = {
  checkedAt: new Date().toISOString(),
  diagnosis: [],
  files: Object.fromEntries(candidates.map((item) => [item.label, inspect(item.path)]))
};

const pairing = report.files['codex-virtualized-pairing'].exists ? report.files['codex-virtualized-pairing']
  : report.files['real-local-pairing'].exists ? report.files['real-local-pairing'] : null;
const config = report.files['codex-virtualized-config'].exists ? report.files['codex-virtualized-config']
  : report.files['real-local-config'].exists ? report.files['real-local-config']
  : report.files['real-roaming-config'].exists ? report.files['real-roaming-config'] : null;

if (!pairing && !config) {
  report.diagnosis.push('credential-missing: no local pairing or host config found in real or Codex-virtualized AppData');
} else {
  if (pairing?.botToken === 'present') report.diagnosis.push('pairing-bot-token: present (use only this for Morgan; never hostToken/ownerToken)');
  else if (pairing) report.diagnosis.push('credential-missing: pairing found but botToken absent/invalid');
  if (config?.hostToken === 'dpapi-present' && config?.ownerToken === 'dpapi-present') {
    report.diagnosis.push('host-config: DPAPI host/owner tokens present');
  } else if (config) {
    report.diagnosis.push('host-config: incomplete encrypted credentials');
  }
  if (report.files['codex-virtualized-pairing'].exists && !report.files['real-local-pairing'].exists) {
    report.diagnosis.push('launcher-note: pairing lives under Codex MSIX AppData virtualization; launching BotDesk outside Codex uses a different empty AppData unless credentials are re-imported');
  }
  if (report.files['codex-virtualized-config'].exists && !report.files['real-roaming-config'].exists && !report.files['real-local-config'].exists) {
    report.diagnosis.push('launcher-note: host config is Codex-virtualized; portable launch outside Codex will look unpaired until re-import');
  }
}

report.recovery = [
  'Morgan durable path: platform secret-request named BOTDESK_BOT_TOKEN (or MCP env). Do not rely on box-secrets.json alone — it has wiped empty mid-session.',
  'Host durable path: launch BotDesk outside Codex when possible, or re-import pairing into the active userData. Prefer %LOCALAPPDATA%\\BotDesk after this build.',
  'Never rotate tokens unless authorized. Never print token values. Never substitute hostToken/ownerToken for botToken.'
];

console.log(JSON.stringify(report, null, 2));

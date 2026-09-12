import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildCredentialDoctorReport } from '../scripts/credential-doctor.mjs';
import { redactClipboard } from '../host/executor.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('credential doctor reports presence only and never echoes token values', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'botdesk-doctor-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const pairingDir = path.join(home, 'AppData', 'Local', 'BotDesk-Setup');
  const configDir = path.join(home, 'AppData', 'Roaming', 'botdesk');
  fs.mkdirSync(pairingDir, { recursive: true });
  fs.mkdirSync(configDir, { recursive: true });
  const secret = 'super-secret-bot-token-value-do-not-print-123456';
  fs.writeFileSync(path.join(pairingDir, 'botdesk-pairing.json'), JSON.stringify({
    hostId: 'owner-pc',
    relayUrl: 'https://relay.example.test',
    botToken: secret,
    provisioningStatus: 'complete'
  }));
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({
    hostToken: 'dpapi:AAAA',
    ownerToken: 'dpapi:BBBB',
    botToken: ''
  }));
  const report = buildCredentialDoctorReport(home);
  const text = JSON.stringify(report);
  assert.equal(text.includes(secret), false);
  assert.equal(report.files['real-local-pairing'].botToken, 'present');
  assert.equal(report.files['real-roaming-config'].hostToken, 'dpapi-present');
  assert.ok(report.diagnosis.some((item) => item.startsWith('pairing-bot-token: present')));
  assert.ok(report.diagnosis.some((item) => item.startsWith('host-config: DPAPI')));
});

test('env-first MCP wrapper prefers env, falls back to file, and exits 2 on credential-missing', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'botdesk-wrapper-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const adapter = path.join(directory, 'adapter.mjs');
  const secrets = path.join(directory, 'box-secrets.json');
  fs.writeFileSync(adapter, 'console.log(process.env.BOTDESK_BOT_TOKEN);\n');
  const wrapper = path.join(root, 'mcp/run-with-secret.sh');
  const env = { PATH: process.env.PATH, HOME: directory };
  const missing = spawnSync('bash', [wrapper], { env: { ...env, BOTDESK_ADAPTER_PATH: adapter }, encoding: 'utf8' });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /credential-missing/);
  assert.doesNotMatch(missing.stderr, /super-secret|bot-token-/);

  fs.writeFileSync(secrets, JSON.stringify({ secrets: { BOTDESK_BOT_TOKEN: 'file-token-should-not-win-over-env-123' } }));
  const fromEnv = spawnSync('bash', [wrapper], {
    env: {
      ...env,
      BOTDESK_ADAPTER_PATH: adapter,
      BOTDESK_SECRET_FILE: secrets,
      BOTDESK_RELAY_URL: 'https://relay.example.test',
      BOTDESK_HOST_ID: 'owner-pc',
      BOTDESK_BOT_TOKEN: 'env-token-wins-over-file-456'
    },
    encoding: 'utf8'
  });
  assert.equal(fromEnv.status, 0, fromEnv.stderr);
  assert.equal(fromEnv.stdout.trim(), 'env-token-wins-over-file-456');

  const fromFile = spawnSync('bash', [wrapper], {
    env: {
      ...env,
      BOTDESK_ADAPTER_PATH: adapter,
      BOTDESK_SECRET_FILE: secrets,
      BOTDESK_RELAY_URL: 'https://relay.example.test',
      BOTDESK_HOST_ID: 'owner-pc'
    },
    encoding: 'utf8'
  });
  assert.equal(fromFile.status, 0, fromFile.stderr);
  assert.equal(fromFile.stdout.trim(), 'file-token-should-not-win-over-env-123');
});

test('clipboard read redacts secret-like values without changing ordinary text', () => {
  const ordinary = 'hello from notepad';
  assert.deepEqual(redactClipboard(ordinary), { text: ordinary, redacted: false, length: ordinary.length });
  const secret = redactClipboard('sk-abcdefghijklmnopqrstuvwxyz0123456789');
  assert.equal(secret.redacted, true);
  assert.equal(secret.text, '[redacted-secret-like]');
  assert.doesNotMatch(secret.text, /sk-/);
});

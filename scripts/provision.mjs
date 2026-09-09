import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : '';
}
const relayInput = arg('relay');
const destination = arg('out');
const provisioningSecret = process.env.BOTDESK_PROVISIONING_SECRET || '';
if (!relayInput || !destination || !/^[A-Za-z0-9_-]{43,128}$/.test(provisioningSecret)) {
  console.error('Set BOTDESK_PROVISIONING_SECRET (at least 32 random bytes, base64url), then run: node scripts/provision.mjs --relay https://relay.example --out C:\\private-folder\\botdesk-pairing.json');
  process.exit(1);
}
if (process.argv.includes('--provisioning-secret')) throw new Error('Do not put the secret in command history. Use BOTDESK_PROVISIONING_SECRET.');
const relayUrl = new URL(relayInput);
const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(relayUrl.hostname);
if (relayUrl.username || relayUrl.password || relayUrl.search || relayUrl.hash || relayUrl.pathname !== '/' || (relayUrl.protocol !== 'https:' && !(relayUrl.protocol === 'http:' && loopback && process.argv.includes('--allow-local')))) throw new Error('Use an HTTPS relay origin; --allow-local permits HTTP loopback for local simulation.');
const relay = relayUrl.origin;
const outputPath = path.resolve(destination);
const descriptor = fs.openSync(outputPath, 'wx', 0o600);
fs.closeSync(descriptor);
if (process.platform === 'win32') {
  // Remove inherited access and grant the signed-in user only. Tokens never reach stdout.
  const identity = execFileSync('whoami.exe', [], { encoding: 'utf8', windowsHide: true }).trim();
  execFileSync('icacls.exe', [outputPath, '/inheritance:r', '/grant:r', `${identity}:(F)`], { stdio: 'pipe', windowsHide: true });
}
const token = () => crypto.randomBytes(32).toString('base64url');
async function smallResponse(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty provisioning response');
  const chunks = []; let length = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      length += part.value.byteLength;
      if (length > 4096) { await reader.cancel(); throw new Error('Unexpected provisioning response'); }
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { reader.releaseLock(); }
}
const hostId = `pc-${crypto.randomBytes(12).toString('hex')}`;
const hostToken = token();
const ownerToken = token();
const botToken = token();
const pairing = {
  provisioningStatus: 'pending', relayUrl: relay, hostId, hostToken, ownerToken, botToken,
  ownerLink: `${relay}/control/${hostId}#${ownerToken}`
};
// Write recovery credentials before the request: a network interruption must not orphan the PC.
fs.writeFileSync(outputPath, JSON.stringify(pairing, null, 2), { mode: 0o600 });
try {
  const response = await fetch(`${relay}/api/provision`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
    headers: { authorization: `Bearer ${provisioningSecret}`, 'content-type': 'application/json' },
    body: JSON.stringify({ hostId, hostToken, ownerToken, botToken })
  });
  const payload = await smallResponse(response);
  if (!response.ok) throw new Error(payload.error || `Provisioning failed with ${response.status}`);
  pairing.provisioningStatus = 'complete';
  fs.writeFileSync(outputPath, JSON.stringify(pairing, null, 2), { mode: 0o600 });
  console.log(`Pairing complete. Private credentials and the phone link were saved in ${outputPath}`);
  console.log('Keep this file outside the repo. Host app needs relayUrl, hostId, hostToken, ownerToken. Give only botToken to the bot MCP configuration.');
} catch (error) {
  console.error(`Provisioning did not confirm completion: ${error.message}. Recovery credentials remain in ${outputPath}; inspect the relay status before creating another pairing.`);
  process.exitCode = 1;
}

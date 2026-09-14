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
// Usage problems exit with a plain sentence rather than a stack trace. Secret values are never echoed.
function usageError(message) {
  console.error(`Provisioning did not start: ${message}`);
  console.error('Usage: set BOTDESK_PROVISIONING_SECRET in the environment, then run: node scripts/provision.mjs --relay https://relay.example --out C:\\private-folder\\botdesk-pairing.json');
  process.exit(1);
}
if (process.argv.includes('--provisioning-secret')) usageError('do not pass the secret as an argument; it would land in shell history. Use the BOTDESK_PROVISIONING_SECRET environment variable.');
if (!relayInput) usageError('--relay is required.');
if (!destination) usageError('--out is required and must point at a new file in a private folder.');
if (!provisioningSecret) usageError('BOTDESK_PROVISIONING_SECRET is not set in this terminal. For the local relay, read it from relay\\.dev.vars as shown in docs/SETUP.md.');
if (!/^[A-Za-z0-9_-]{43,128}$/.test(provisioningSecret)) usageError(`BOTDESK_PROVISIONING_SECRET has ${provisioningSecret.length} characters; it must be a base64url value of 43-128 characters (32 random bytes or more), matching the relay's PROVISIONING_SECRET.`);
let relayUrl;
try { relayUrl = new URL(relayInput); } catch { usageError(`--relay "${relayInput}" is not a valid URL.`); }
const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(relayUrl.hostname);
if (relayUrl.username || relayUrl.password || relayUrl.search || relayUrl.hash || relayUrl.pathname !== '/') usageError('--relay must be a bare origin such as https://relay.example, with no path, query, fragment or credentials.');
if (relayUrl.protocol !== 'https:' && !(relayUrl.protocol === 'http:' && loopback && process.argv.includes('--allow-local'))) usageError('use an HTTPS relay origin. --allow-local permits http://127.0.0.1 only, for the local development relay.');
const relay = relayUrl.origin;
const outputPath = path.resolve(destination);
if (!fs.existsSync(path.dirname(outputPath))) usageError(`the folder for --out does not exist: ${path.dirname(outputPath)}. Create it first.`);
if (fs.existsSync(outputPath)) {
  let status = 'unreadable';
  try { status = JSON.parse(fs.readFileSync(outputPath, 'utf8')).provisioningStatus || 'unknown'; } catch { /* keep unreadable */ }
  usageError(`--out already exists (${outputPath}, provisioningStatus: ${status}). This script never overwrites a pairing file. If that file is "complete", use it; if it is "pending" and the relay never confirmed, move it aside before provisioning again.`);
}
let descriptor;
try { descriptor = fs.openSync(outputPath, 'wx', 0o600); } catch (error) { usageError(`could not create ${outputPath} (${error.code || 'error'}).`); }
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
const REJECTIONS = {
  unauthorized: 'the relay rejected the provisioning secret. BOTDESK_PROVISIONING_SECRET must equal the relay\'s PROVISIONING_SECRET (relay\\.dev.vars locally, or the Worker secret for a deployed relay).',
  'already-provisioned': 'the relay already holds credentials for this host ID. Generate a new pairing with a fresh run; existing host IDs are never overwritten.',
  'invalid-provisioning-input': 'the relay rejected the generated credentials. Update both the relay and this script to the same version.',
  'not-found': 'the relay answered 404 for /api/provision. Check that --relay points at the Bot Door relay origin itself.'
};
try {
  let response;
  try {
    response = await fetch(`${relay}/api/provision`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { authorization: `Bearer ${provisioningSecret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ hostId, hostToken, ownerToken, botToken })
    });
  } catch (error) {
    const cause = error?.cause;
    const code = String(cause?.code || cause?.errors?.find((item) => item?.code)?.code || (error?.name === 'TimeoutError' ? 'TimeoutError' : '') || cause?.message || error?.message || 'network-error').replace(/[^A-Za-z0-9_ ]/g, '').trim().slice(0, 40);
    const hint = code === 'ECONNREFUSED' ? ' Nothing is listening at that address; for the local relay, keep `npm run relay:dev` running in another terminal.'
      : code === 'ENOTFOUND' ? ' The relay hostname does not resolve; check the --relay spelling and your internet connection.'
        : code === 'TimeoutError' ? ' The relay did not answer within 15 seconds.'
          : /CERT|TLS|SSL/i.test(code) ? ' The relay\'s TLS certificate could not be verified.' : '';
    throw Object.assign(new Error(`the relay could not be reached (${code}).${hint}`), { stored: false });
  }
  const payload = await smallResponse(response);
  if (!response.ok) throw Object.assign(new Error(REJECTIONS[payload.error] || `the relay rejected the request (${payload.error || `HTTP ${response.status}`}).`), { stored: false });
  pairing.provisioningStatus = 'complete';
  fs.writeFileSync(outputPath, JSON.stringify(pairing, null, 2), { mode: 0o600 });
  console.log(`Pairing complete. Private credentials and the phone link were saved in ${outputPath}`);
  console.log('Keep this file outside the repo. Host app needs relayUrl, hostId, hostToken, ownerToken. Give only botToken to the bot MCP configuration.');
} catch (error) {
  if (error.stored === false) {
    console.error(`Provisioning failed: ${error.message}`);
    console.error(`The relay stored nothing for host ${hostId}, so the pending file ${outputPath} is unusable; delete it and run provisioning again once the cause is fixed.`);
  } else {
    console.error(`Provisioning did not confirm completion: ${error.message}. Recovery credentials remain in ${outputPath}; inspect the relay status before creating another pairing.`);
  }
  process.exitCode = 1;
}

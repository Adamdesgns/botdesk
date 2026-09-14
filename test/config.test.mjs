import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigStore, relayOrigin } from '../host/config-store.mjs';

// Inject a test-only authenticated codec. These tests verify persistence/masking,
// not Windows DPAPI itself; the actual Electron host supplies safeStorage.
function setup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'botdesk-config-test-'));
  t.after(() => { assert.equal(path.dirname(directory), path.resolve(os.tmpdir())); fs.rmSync(directory, { recursive: true, force: true }); });
  const file = path.join(directory, 'config.json');
  const key = crypto.randomBytes(32);
  const codec = {
    encrypt(text) { const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv); const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), data]); },
    decrypt(data) { const decipher = crypto.createDecipheriv('aes-256-gcm', key, data.subarray(0, 12)); decipher.setAuthTag(data.subarray(12, 28)); return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8'); }
  };
  return { file, directory, codec, store: new ConfigStore(file, codec) };
}
const pairing = { relayUrl: 'https://relay.example.test', hostId: 'owner-pc', hostToken: 'host-token-'.padEnd(48, 'h'), ownerToken: 'owner-token-'.padEnd(48, 'o'), botToken: 'bot-token-'.padEnd(48, 'b') };

test('config defaults keep remote arm/startup disabled and contain no credentials', (t) => {
  const { store } = setup(t); const current = store.load();
  assert.equal(current.allowRemoteArm, false); assert.equal(current.startAtLogin, false);
  assert.equal(current.hostToken, ''); assert.equal(current.ownerToken, ''); assert.equal(current.botToken, '');
});

test('pairing secrets persist encrypted and reload; public view masks all credentials', (t) => {
  const { file, codec, store } = setup(t);
  store.save({ ...pairing, allowRemoteArm: true });
  const text = fs.readFileSync(file, 'utf8');
  for (const secret of [pairing.hostToken, pairing.ownerToken, pairing.botToken]) assert.equal(text.includes(secret), false);
  for (const field of ['hostToken', 'ownerToken', 'botToken']) assert.match(JSON.parse(text)[field], /^dpapi:/);
  const reloaded = new ConfigStore(file, codec);
  assert.equal(reloaded.load().hostToken, pairing.hostToken);
  assert.equal(reloaded.load().ownerToken, pairing.ownerToken);
  assert.equal(reloaded.load().botToken, pairing.botToken);
  assert.equal(reloaded.publicView().hostToken, 'saved');
  assert.equal(reloaded.publicView().ownerToken, 'saved');
  assert.equal(reloaded.publicView().botToken, 'saved');
  reloaded.save({ ...reloaded.publicView(), startAtLogin: true });
  assert.equal(reloaded.load().hostToken, pairing.hostToken);
  assert.equal(reloaded.load().startAtLogin, true);
});

test('unencrypted and corrupted secrets fail closed', (t) => {
  const { file, store } = setup(t);
  fs.writeFileSync(file, JSON.stringify({ hostToken: pairing.hostToken }));
  assert.throws(() => store.load(), /Unencrypted/);
  fs.writeFileSync(file, JSON.stringify({ hostToken: 'dpapi:aW52YWxpZA==' }));
  assert.throws(() => store.load());
});

test('credential save requires encryption and validation leaves the prior file intact', (t) => {
  const { file, store } = setup(t);
  assert.throws(() => new ConfigStore(file).save(pairing), /encryption unavailable/);
  assert.equal(fs.existsSync(file), false);
  store.save(pairing); const before = fs.readFileSync(file, 'utf8');
  for (const update of [{ hostToken: 'too-short' }, { hostId: '../wrong' }, { relayUrl: 'http://public.example.test' }, { relayUrl: 'https://user:password@example.test' }, { allowedApps: 'powershell' }]) {
    assert.throws(() => store.save(update));
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  }
});

test('blank token fields keep previously saved secrets; host pairing does not require botToken', (t) => {
  const { store } = setup(t);
  store.save({ relayUrl: pairing.relayUrl, hostId: pairing.hostId, hostToken: pairing.hostToken, ownerToken: pairing.ownerToken });
  assert.equal(store.load().hostToken, pairing.hostToken);
  assert.equal(store.load().ownerToken, pairing.ownerToken);
  assert.equal(store.load().botToken, '');
  store.save({ botToken: pairing.botToken });
  assert.equal(store.load().botToken, pairing.botToken);
  store.save({ hostToken: '', ownerToken: '   ', botToken: '', startAtLogin: false });
  assert.equal(store.load().hostToken, pairing.hostToken);
  assert.equal(store.load().ownerToken, pairing.ownerToken);
  assert.equal(store.load().botToken, pairing.botToken);
});

test('settings accept true booleans only and cannot add shell executables to allowlist', (t) => {
  const { store } = setup(t);
  store.save({ allowRemoteArm: 'true', startAtLogin: 1, allowedApps: ['msedge', 'powershell', 'cmd'], injectedSetting: 'ignored' });
  assert.equal(store.load().allowRemoteArm, false); assert.equal(store.load().startAtLogin, false);
  assert.deepEqual(store.load().allowedApps, ['msedge']);
  assert.equal(store.load().injectedSetting, undefined);
});

test('host token validation matches the relay minimum so a short paste fails at save time, not as a silent 401', (t) => {
  const { store } = setup(t);
  assert.throws(() => store.save({ ...pairing, hostToken: 'h'.repeat(42) }), /Invalid hostToken: pairing tokens are 43/);
  assert.throws(() => store.save({ ...pairing, hostId: 'PC-Upper' }), /Invalid host ID: use the lowercase hostId/);
  store.save({ ...pairing, hostToken: 'h'.repeat(43) });
  assert.equal(store.load().hostToken, 'h'.repeat(43));
});

test('relay configuration accepts TLS origins or explicit loopback and rejects credential URLs', () => {
  for (const url of ['https://relay.example.test', 'http://127.0.0.1:8787', 'http://localhost:8787', 'http://[::1]:8787']) assert.ok(relayOrigin(url));
  for (const url of ['http://public.example.test', 'http://10.0.0.2:8787', 'https://user:pass@example.test', 'https://example.test/path', 'https://example.test/?key=secret', 'https://example.test/#secret', 'file:///tmp/x']) assert.throws(() => relayOrigin(url));
});

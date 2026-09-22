import fs from 'node:fs';
import {randomBytes} from 'node:crypto';

const TOKEN = /^[A-Za-z0-9_-]{43,128}$/;

/** Read only this PC's existing protected pairing, then seal the bot token in
 * the host's Windows-encrypted config. Never return a host or owner token. */
export function ownerBotToken(configStore, pairingPath) {
  const current = configStore.load();
  if (TOKEN.test(current.botToken)) return current.botToken;
  if (!current.hostId || !current.relayUrl || !TOKEN.test(current.hostToken) || !TOKEN.test(current.ownerToken))
    throw new Error('bot-token-unavailable');
  let pairing;
  try { pairing = JSON.parse(fs.readFileSync(pairingPath, 'utf8')); }
  catch { throw new Error('bot-token-unavailable'); }
  if (!pairing || pairing.provisioningStatus !== 'complete' ||
      pairing.hostId !== current.hostId || pairing.relayUrl !== current.relayUrl ||
      pairing.hostToken !== current.hostToken || pairing.ownerToken !== current.ownerToken ||
      !TOKEN.test(pairing.botToken) ||
      [pairing.hostToken, pairing.ownerToken].includes(pairing.botToken))
    throw new Error('bot-token-unavailable');
  try { configStore.save({botToken:pairing.botToken}); }
  catch { throw new Error('bot-token-unavailable'); }
  return pairing.botToken;
}

export function createOwnerBotToken(configStore) {
  const botToken=randomBytes(32).toString('base64url');
  configStore.save({botToken});
  return botToken;
}

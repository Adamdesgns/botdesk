import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigStore } from '../host/config-store.mjs';
import { ownerBotToken,createOwnerBotToken } from '../host/owner-secret.mjs';

const tkn = label => label.padEnd(43,'x');
const pairing = { provisioningStatus:'complete',relayUrl:'https://relay.example.test',hostId:'owner-pc',
  hostToken:tkn('host-'),ownerToken:tkn('owner-'),botToken:tkn('bot-') };
function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'botdesk-owner-secret-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const store=new ConfigStore(path.join(dir,'config.json'),{encrypt:value=>Buffer.from('encrypted:'+value),decrypt:value=>value.toString().slice(10)});
  store.save({relayUrl:pairing.relayUrl,hostId:pairing.hostId,hostToken:pairing.hostToken,ownerToken:pairing.ownerToken});
  const file=path.join(dir,'botdesk-pairing.json');
  return {dir,store,file,write:value=>fs.writeFileSync(file,JSON.stringify(value))};
}

test('existing matching pairing migrates only bot token into encrypted host config',t=>{
  const f=fixture(t);f.write(pairing);
  assert.equal(ownerBotToken(f.store,f.file),pairing.botToken);
  assert.equal(f.store.load().botToken,pairing.botToken);
  const disk=fs.readFileSync(path.join(f.dir,'config.json'),'utf8');
  for(const value of [pairing.botToken,pairing.ownerToken,pairing.hostToken])assert.equal(disk.includes(value),false);
  fs.rmSync(f.file);
  assert.equal(ownerBotToken(f.store,f.file),pairing.botToken,'encrypted saved copy survives removal of the old pairing file');
});

test('missing, incomplete and mismatched pairing never imports a token',t=>{
  const changes=[{hostId:'other'}, {hostToken:tkn('other-host')}, {ownerToken:tkn('other-owner')},
    {relayUrl:'https://different.example.test'}, {botToken:'bad'}, {botToken:pairing.ownerToken}, {provisioningStatus:'pending'}];
  for(const change of changes){const f=fixture(t);f.write({...pairing,...change});
    assert.throws(()=>ownerBotToken(f.store,f.file),/bot-token-unavailable/);
    assert.equal(f.store.load().botToken,'');
  }
  const f=fixture(t);assert.throws(()=>ownerBotToken(f.store,f.file),/bot-token-unavailable/);
});

test('owner can create a fresh bot token sealed in the host config after pairing was lost',t=>{
  const f=fixture(t);
  const first=createOwnerBotToken(f.store);
  assert.match(first,/^[A-Za-z0-9_-]{43}$/);
  assert.equal(ownerBotToken(f.store,f.file),first);
  const second=createOwnerBotToken(f.store);
  assert.notEqual(second,first);
  assert.equal(ownerBotToken(f.store,f.file),second);
  const disk=fs.readFileSync(path.join(f.dir,'config.json'),'utf8');
  assert.equal(disk.includes(first),false);assert.equal(disk.includes(second),false);
});

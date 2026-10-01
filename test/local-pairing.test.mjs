import test from 'node:test';
import assert from 'node:assert/strict';
import {readLocalPairing} from '../mcp/local-config.mjs';
const base={platform:'win32',env:{LOCALAPPDATA:'C:\\fixture',BOTDESK_LOCAL_PAIRING:'1'},readFile:()=>JSON.stringify({relayUrl:'https://relay.example.test',hostId:'pc',botToken:'dpapi:YWJj',ownerToken:'owner-never-exported',hostToken:'host-never-exported'}),decrypt:()=> 'a'.repeat(43)};
test('local pairing is explicit, bot-only and follows saved token rotation without restart',()=>{
 assert.equal(readLocalPairing({...base,env:{}}),null);
 const c=readLocalPairing(base);assert.deepEqual(Object.keys(c).sort(),['botId','botToken','hostId','relayUrl']);
 assert.equal(c.botToken,'a'.repeat(43));assert.equal(readLocalPairing({...base,decrypt:()=> 'b'.repeat(43)}).botToken,'b'.repeat(43));
});
test('local pairing fails closed without leaking decrypt errors or using owner credentials',()=>{
 assert.throws(()=>readLocalPairing({...base,decrypt:()=>{throw new Error('secret should not escape');}}),/^Error: local-pairing-unavailable$/);
 assert.throws(()=>readLocalPairing({...base,readFile:()=>JSON.stringify({ownerToken:'a'.repeat(43)})}),/local-pairing-unavailable/);
 assert.throws(()=>readLocalPairing({...base,platform:'linux'}),/requires-windows/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from 'miniflare';
import WebSocket from 'ws';
import { setTimeout as delay } from 'node:timers/promises';
import { HostController } from '../host/controller.mjs';
import { RelayClient } from '../host/relay-client.mjs';

const randomToken = () => randomBytes(32).toString('base64url');
const secret = randomToken();
const bundle = await build({ entryPoints: ['relay/src/index.ts'], bundle: true, write: false, format: 'esm', platform: 'neutral', external: ['cloudflare:*'], target: 'es2022' });
let mf;
let origin;

function localOptions(suffix = '') {
  return { ...convertV4MiniflareOptions({
    name: 'botdesk-test', modules: true, script: bundle.outputFiles[0].text + suffix,
    compatibilityDate: '2026-09-08', compatibilityFlags: ['nodejs_compat'],
    bindings: { PROVISIONING_SECRET: secret },
    durableObjects: { SESSIONS: { className: 'BotDeskSession', useSQLite: true } },
    cf: false, host: '127.0.0.1', port: 0, log: new Log(LogLevel.ERROR)
  }), telemetry: { enabled: false } };
}
test.before(async () => {
  mf = new Miniflare(localOptions());
  origin = (await mf.ready).origin;
});
test.after(async () => { await mf?.dispose(); });

async function api(route, token, body, overrides = {}) {
  const response = await fetch(origin + route, {
    method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
    headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), 'content-type': 'application/json', 'x-request-id': randomUUID(), ...overrides },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}
async function provision() {
  const credentials = { hostId: 'test-' + randomUUID(), hostToken: randomToken(), ownerToken: randomToken(), botToken: randomToken() };
  const result = await api('/api/provision', secret, credentials);
  assert.equal(result.status, 201, JSON.stringify(result));
  return credentials;
}
function socketFor(c, token = c.hostToken) {
  const socket = new WebSocket(origin.replace('http:', 'ws:') + '/api/host/' + c.hostId + '/socket', { headers: { authorization: 'Bearer ' + token } });
  const messages = [];
  const waiters = [];
  socket.on('message', raw => {
    const message = JSON.parse(raw.toString());
    const index = waiters.findIndex(item => item.type === message.type);
    if (index >= 0) { const waiter = waiters.splice(index, 1)[0]; clearTimeout(waiter.timer); waiter.resolve(message); }
    else messages.push(message);
  });
  socket.on('error', () => {});
  socket.next = type => {
    const index = messages.findIndex(item => item.type === type);
    if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const item = { type, resolve, timer: setTimeout(() => { const i = waiters.indexOf(item); if (i >= 0) waiters.splice(i, 1); reject(new Error('Timed out waiting for ' + type)); }, 25_000) };
      waiters.push(item);
    });
  };
  return socket;
}
async function connected(c, t) {
  const socket = socketFor(c);
  t.after(() => socket.terminate());
  assert.equal((await socket.next('auth_ok')).state.mode, 'off');
  return socket;
}
async function arm(c, socket, mode = 'armed', ack = {}) {
  const requestId = randomUUID();
  const result = api('/api/owner/' + c.hostId + '/state', c.ownerToken, { mode, minutes: 30 }, { 'x-request-id': requestId });
  let message;
  do { message = await socket.next('owner_state'); } while (message.requestId !== requestId);
  socket.send(JSON.stringify({ ...message, type: 'owner_state_result', ok: true, ...ack }));
  return result;
}
async function nextMode(socket, mode) {
  for (;;) { const message = await socket.next('owner_state'); if (message.mode === mode) return message; }
}
async function acceptScheduledArm(socket) {
  const message = await nextMode(socket, 'armed');
  socket.send(JSON.stringify({ ...message, type: 'owner_state_result', ok: true }));
  return message;
}
async function until(check, timeout = 3000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await delay(25); }
  assert.fail('Condition did not become true within ' + timeout + 'ms');
}
const botRoute = c => '/api/bot/' + c.hostId + '/command';
const ownerRoute = c => '/api/owner/' + c.hostId;
const command = (c, name, botId = 'bot-a', extras = {}) => api(botRoute(c), c.botToken, { name, args: {} }, { 'x-bot-id': botId, ...extras });

test('only the owner can reveal the currently paired bot token through the live host',async t=>{
  const c=await provision();
  const config={...c,relayUrl:origin};
  const client=new RelayClient({getConfig:()=>config,onCommand:async()=>({ok:false,error:'not-armed'}),
    onOwnerState:async()=>({ok:false,error:'not-armed'}),onOwnerSecret:()=>c.botToken});
  t.after(()=>client.disconnect());
  const ready=new Promise(resolve=>client.on('status',s=>{if(s.authenticated)resolve();}));client.connect();await ready;
  const route=ownerRoute(c)+'/bot-token';
  assert.equal((await api(route,c.botToken,{})).status,401);
  assert.equal((await api(route,c.hostToken,{})).status,401);
  const requestId=randomUUID();
  const result=await api(route,c.ownerToken,{}, {'x-request-id':requestId});
  assert.equal(result.status,200);assert.equal(result.body.botToken,c.botToken);
  assert.equal((await api(route,c.ownerToken,{}, {'x-request-id':requestId})).body.error,'request-replayed');
  const status=(await api(ownerRoute(c)+'/status',c.ownerToken)).body;
  const botStatus=(await command(c,'status')).body;
  assert.equal(JSON.stringify(status).includes(c.botToken),false);
  assert.equal(JSON.stringify(botStatus).includes(c.botToken),false);
  assert.equal((await api(botRoute(c),c.botToken,{name:'owner_secret',args:{}})).body.error,'invalid-command');
  client.disconnect();
  await until(async()=>!(await api(ownerRoute(c)+'/status',c.ownerToken)).body.hostOnline);
  assert.equal((await api(route,c.ownerToken,{})).body.error,'host-offline');
});

test('relay refuses a saved token that does not match its provisioned bot hash',async t=>{
  const c=await provision();const config={...c,relayUrl:origin};
  const client=new RelayClient({getConfig:()=>config,onCommand:async()=>({ok:false}),onOwnerState:async()=>({ok:false}),onOwnerSecret:()=>randomToken()});
  t.after(()=>client.disconnect());
  const ready=new Promise(resolve=>client.on('status',s=>{if(s.authenticated)resolve();}));client.connect();await ready;
  const result=await api(ownerRoute(c)+'/bot-token',c.ownerToken,{});
  assert.equal(result.status,409);assert.equal(result.body.error,'bot-token-mismatch');
  assert.equal(JSON.stringify(result).includes(c.botToken),false);
});

test('owner can rotate a lost bot token; old bot credential is revoked and fresh token remains revealable',async t=>{
  const c=await provision();let saved='';const config={...c,relayUrl:origin};
  const client=new RelayClient({getConfig:()=>config,onCommand:async()=>({ok:false}),onOwnerState:async()=>({ok:false}),
    onOwnerSecret:()=>saved||'',onRotateOwnerSecret:()=>{saved=randomToken();return saved;}});
  t.after(()=>client.disconnect());
  const ready=new Promise(resolve=>client.on('status',s=>{if(s.authenticated)resolve();}));client.connect();await ready;
  const route=ownerRoute(c)+'/rotate-bot-token';
  assert.equal((await api(route,c.botToken,{})).status,401);
  assert.equal((await api(route,c.hostToken,{})).status,401);
  assert.equal((await api(ownerRoute(c)+'/bot-token',c.ownerToken,{})).body.error,'bot-token-unavailable');
  const rotated=await api(route,c.ownerToken,{});
  assert.equal(rotated.status,200);assert.equal(rotated.body.botToken,saved);
  assert.notEqual(saved,c.botToken);
  assert.equal((await command(c,'status')).status,401);
  assert.equal((await api(botRoute(c),saved,{name:'status',args:{}},{'x-bot-id':'bot-a'})).status,200);
  assert.equal((await api(ownerRoute(c)+'/bot-token',c.ownerToken,{})).body.botToken,saved);
  assert.equal(JSON.stringify((await api(ownerRoute(c)+'/status',c.ownerToken)).body).includes(saved),false);
});

test('owner secret request is a distinct host message, cannot be satisfied by command_result',async t=>{
  const c=await provision();const socket=await connected(c,t);
  const pending=api(ownerRoute(c)+'/bot-token',c.ownerToken,{});
  const request=await socket.next('owner_secret');
  socket.send(JSON.stringify({type:'command_result',commandId:request.requestId,ok:true,result:{botToken:c.botToken}}));
  socket.send(JSON.stringify({type:'owner_secret_result',requestId:request.requestId,ok:true,botToken:c.botToken}));
  assert.equal((await pending).body.botToken,c.botToken);
});

test('owner recovery crosses the real relay, stops access, approves a separate-PID dialog and preserves STOP', async t => {
  const c=await provision();
  const base={handle:'1001',processId:123,processStartedAt:'111',processName:'msedge',title:'Extensions',integrity:'medium',desktop:'default',automationChecked:true,passwordFocused:false,passwordPresent:false,geometry:{x:0,y:0,width:900,height:700}};
  const dialog={...base,handle:'2002',processId:456,processStartedAt:'222',title:'Select the extension directory.'};
  const windows=[base,dialog];let foreground=base;
  const config={...c,relayUrl:origin,allowRemoteArm:true,allowedApps:['msedge']};
  const host=new HostController({configStore:{load:()=>config},auditLog:{write:()=>{}},executor:{
    inspect:async w=>({ok:true,window:structuredClone(windows.find(x=>x.handle===w.handle))}),
    listWindows:async()=>({ok:true,windows}),foreground:async()=>foreground,
    focus:async w=>{foreground=w;return {ok:true};},run:async()=>({ok:true,window:foreground}),recordStop:async()=>({ok:true})}});
  const client=new RelayClient({getConfig:()=>config,onCommand:m=>host.runCommand(m),onOwnerState:m=>host.applyOwnerState(m),onOwnerTarget:m=>host.ownerTarget(m)});
  host.attachRelay(client);host.selectTarget(base);t.after(()=>{host.emergencyStop();client.disconnect();});
  const ready=new Promise(resolve=>client.on('status',s=>{if(s.authenticated)resolve();}));client.connect();await ready;
  await client.ownerState('armed');
  assert.equal((await api(ownerRoute(c)+'/target',c.botToken,{action:'list'})).status,401);
  assert.equal((await command(c,'owner_target')).body.error,'invalid-command');
  const listed=await api(ownerRoute(c)+'/target',c.ownerToken,{action:'list'});assert.equal(listed.status,200,JSON.stringify(listed));
  assert.equal(host.mode,'off');assert.equal((await api(ownerRoute(c)+'/status',c.ownerToken)).body.schedule,null);
  assert.equal((await command(c,'screenshot')).body.error,'not-armed');
  const candidateId=listed.body.result.windows.find(w=>w.processId===456).candidateId;
  assert.equal((await api(ownerRoute(c)+'/target',c.ownerToken,{action:'approve',candidateId,temporary:true})).status,200);
  assert.equal(host.mode,'off');assert.equal(host.targetWindow.handle,'2002');
  const status=(await api(ownerRoute(c)+'/status',c.ownerToken)).body;
  assert.equal(status.target.window.processId,456);assert.equal(status.relayContractVersion,'1.3.0');
  assert.equal((await api(ownerRoute(c)+'/schedule',c.ownerToken,{startsAt:Date.now()+1000,endsAt:Date.now()+60000})).body.error,'temporary-target-no-schedule');
  const armed=await client.ownerState('armed');assert.equal(armed.expiresAt,host.targetDeadline);
  assert.equal((await command(c,'screenshot')).status,200);
  assert.equal((await command(c,'focus')).status,200);
  assert.equal((await api(botRoute(c),c.botToken,{name:'clipboard_write',args:{text:'fixture-path'}},{'x-bot-id':'bot-a'})).status,200);
  await client.ownerState('off');assert.equal(host.targetWindow,null);
  assert.equal((await command(c,'screenshot')).body.error,'not-armed');
});

test('failed target activation cancels automatic schedule retries and keeps the reason',async t=>{
  const c=await provision();const socket=await connected(c,t);
  const pending=api(ownerRoute(c)+'/state',c.ownerToken,{mode:'armed'});
  const message=await nextMode(socket,'armed');
  socket.send(JSON.stringify({...message,type:'owner_state_result',ok:false,error:'target-reselect-required'}));
  assert.equal((await pending).body.error,'target-reselect-required');
  await until(async()=>!(await api(ownerRoute(c)+'/status',c.ownerToken)).body.schedule);
  const status=(await api(ownerRoute(c)+'/status',c.ownerToken)).body;
  assert.equal(status.mode,'off');assert.equal(status.scheduleError,'target-reselect-required');
});

test('STOP & CHOOSE preempts an in-flight bot command and ignores its late result',async t=>{
  const c=await provision();const socket=await connected(c,t);await arm(c,socket);
  const pending=command(c,'screenshot');const capture=await socket.next('command');
  const review=api(ownerRoute(c)+'/target',c.ownerToken,{action:'list'});
  assert.equal((await pending).body.error,'owner-selecting-target');
  const off=await nextMode(socket,'off');assert.equal(off.mode,'off');
  const request=await socket.next('owner_target');
  socket.send(JSON.stringify({type:'command_result',commandId:capture.commandId,ok:true,result:{image:'late-private-frame'}}));
  socket.send(JSON.stringify({type:'command_result',commandId:request.commandId,ok:true,result:{windows:[],expiresAt:Date.now()+60000}}));
  assert.deepEqual((await review).body.result.windows,[]);
  const status=(await api(ownerRoute(c)+'/status',c.ownerToken)).body;assert.equal(status.mode,'off');assert.equal(status.schedule,null);
});

test('exact routes reject unauthenticated provisioning bypass and wrong credentials', async t => {
  const c = { hostId: 'new-' + randomUUID(), hostToken: randomToken(), ownerToken: randomToken(), botToken: randomToken() };
  assert.equal((await api('/api/provision', '', c)).status, 401);
  assert.equal((await api('/api/owner/' + c.hostId + '/provision', '', c)).status, 404);
  assert.equal((await api('/api/bot/' + c.hostId + '/x/provision', '', c)).status, 404);
  assert.equal((await api('/api/host/' + c.hostId + '/provision', '', c)).status, 404);
  assert.equal((await api('/api/provision', secret, c)).status, 201);
  assert.equal((await api('/api/provision', secret, c)).status, 409);
  assert.equal((await api(ownerRoute(c) + '/status', c.botToken)).status, 401);
  assert.equal((await api(ownerRoute(c) + '/state', c.botToken, { mode: 'armed' })).status, 401);
  assert.equal((await api('/api/provision', secret, { ...c, hostId: 'weak', hostToken: 'weak' })).status, 400);
  assert.equal((await api('/api/provision', secret, { ...c, hostId: 'equal', hostToken: c.ownerToken })).status, 400);
  const noAuth = await fetch(origin + '/api/host/' + c.hostId + '/socket');
  assert.equal(noAuth.status, 401);
});

test('host upgrade is authenticated, singleton, and immediately starts off', async t => {
  const c = await provision();
  const wrong = socketFor(c, c.botToken);
  t.after(() => wrong.terminate());
  const rejected = new Promise(resolve => wrong.once('unexpected-response', (_req, res) => { res.resume(); resolve(res.statusCode); }));
  assert.equal(await rejected, 401);
  const socket = await connected(c, t);
  const duplicate = socketFor(c); t.after(() => duplicate.terminate());
  assert.equal(await new Promise(resolve => duplicate.once('unexpected-response', (_req, res) => { res.resume(); resolve(res.statusCode); })), 409);
  socket.send(JSON.stringify({ type: 'heartbeat' }));
  await socket.next('heartbeat_ack');
  assert.equal((await command(c, 'click')).body.error, 'not-armed');
  assert.equal((await api(ownerRoute(c) + '/status', c.ownerToken)).body.hostOnline, true);
});

test('relay cannot claim armed before the host accepts the exact generation and deadline', async t => {
  const c = await provision(); const socket = await connected(c, t);
  const pending = api(ownerRoute(c) + '/state', c.ownerToken, { mode: 'armed' });
  const message = await socket.next('owner_state');
  assert.equal((await api(ownerRoute(c) + '/status', c.ownerToken)).body.mode, 'off');
  assert.equal((await command(c, 'click')).body.error, 'host-busy');
  socket.send(JSON.stringify({ ...message, type: 'owner_state_result', ok: false, mode: 'off', expiresAt: null, error: 'remote-arm-disabled' }));
  assert.equal((await pending).body.error, 'remote-arm-disabled');
  await socket.next('owner_state'); // relay forces off after rejection
  assert.equal((await api(ownerRoute(c) + '/status', c.ownerToken)).body.mode, 'off');
  assert.equal((await arm(c, socket)).body.mode, 'armed');
});

test('single bot lease, single in-flight command, replay denial, owner preview isolation', async t => {
  const c = await provision(); const socket = await connected(c, t);
  assert.equal((await arm(c, socket)).status, 200);
  const id = randomUUID();
  const first = command(c, 'snapshot', 'bot-a', { 'x-request-id': id });
  const message = await socket.next('command');
  assert.equal(message.name, 'snapshot'); assert.ok(message.expiresAt > Date.now());
  assert.equal((await command(c, 'snapshot', 'bot-a')).body.error, 'host-busy');
  assert.equal((await command(c, 'snapshot', 'bot-a', { 'x-request-id': id })).body.error, 'request-replayed');
  socket.send(JSON.stringify({ type: 'command_result', commandId: randomUUID(), ok: true, result: { injected: true } }));
  socket.send(JSON.stringify({ type: 'command_result', commandId: message.commandId, ok: true, result: { snapshotId: 'fixture' } }));
  assert.equal((await first).body.result.snapshotId, 'fixture');
  assert.equal((await command(c, 'click', 'bot-b')).body.error, 'bot-lease-held');
  const preview = api(ownerRoute(c) + '/command', c.ownerToken, { name: 'screenshot', args: {} });
  const previewMessage = await socket.next('command'); assert.equal(previewMessage.ownerPreview, true);
  socket.send(JSON.stringify({ type: 'command_result', commandId: previewMessage.commandId, ok: true, result: { mimeType: 'image/png', data: 'fixture' } }));
  assert.equal((await preview).status, 200);
  assert.equal((await api(ownerRoute(c) + '/status', c.ownerToken)).body.activeBot, 'bot-a');
  assert.equal((await command(c, 'click', 'bot-b')).body.error, 'bot-lease-held');
});

test('drag is a distinct armed SDK command; STOP cancels it and raw button actions stay unavailable', async t => {
  const c = await provision(); const socket = await connected(c, t);
  const args = { snapshotId: 'fresh-drag', points: [{ x: 10, y: 20 }, { x: 60, y: 90 }], durationMs: 500 };
  assert.equal((await api(botRoute(c), c.botToken, { name: 'drag', args }, { 'x-bot-id': 'drag-test' })).body.error, 'not-armed');
  await arm(c, socket);
  const pending = api(botRoute(c), c.botToken, { name: 'drag', args }, { 'x-bot-id': 'drag-test' });
  const message = await socket.next('command');
  assert.equal(message.name, 'drag'); assert.deepEqual(message.args, args);
  assert.equal((await command(c, 'stop_all', 'owner-stop')).body.result.mode, 'off');
  assert.equal((await pending).body.error, 'remote-stop');
  for (const name of ['mouse_down', 'mouse_up', 'release_left']) assert.equal((await command(c, name)).status, 400);
});

test('pause preempts command; late result cannot rearm; stop works without a bot lease', async t => {
  const c = await provision(); const socket = await connected(c, t); await arm(c, socket);
  const first = command(c, 'type'); const message = await socket.next('command');
  const paused = await arm(c, socket, 'paused');
  assert.equal(paused.body.mode, 'paused'); assert.equal((await first).body.error, 'owner-paused');
  socket.send(JSON.stringify({ type: 'command_result', commandId: message.commandId, ok: true, result: 'stale' }));
  assert.equal((await command(c, 'click')).body.error, 'not-armed');
  assert.equal((await command(c, 'stop_all', 'bot-b')).body.result.mode, 'off');
  const off = await socket.next('owner_state'); assert.equal(off.mode, 'off');
  assert.equal((await command(c, 'status')).body.result.mode, 'off');
  const stopRecording = command(c, 'record_stop', 'bot-b');
  const recordMessage = await socket.next('command'); assert.equal(recordMessage.name, 'record_stop');
  socket.send(JSON.stringify({ type: 'command_result', commandId: recordMessage.commandId, ok: true, result: { recording: false } }));
  assert.equal((await stopRecording).status, 200);
});

test('disconnect cancels pending work; a saved owner timer resumes only after a new host acknowledgement', async t => {
  const c = await provision(); const socket = await connected(c, t); await arm(c, socket);
  const pending = command(c, 'snapshot'); await socket.next('command'); socket.close();
  const result = await pending; assert.equal(result.body.error, 'host-disconnected');
  assert.equal((await api(ownerRoute(c) + '/status', c.ownerToken)).body.mode, 'off');
  assert.equal((await command(c, 'snapshot')).body.error, 'host-offline');
  const offlineTimer = await api(ownerRoute(c) + '/state', c.ownerToken, { mode: 'armed' });
  assert.equal(offlineTimer.status, 202); assert.equal(offlineTimer.body.schedulePending, true);
  const second = await connected(c, t);
  await acceptScheduledArm(second);
  await until(async () => (await api(ownerRoute(c) + '/status', c.ownerToken)).body.mode === 'armed');
});

test('bot focus, monitors and clipboard are valid commands; owner preview cannot restore foreground', async () => {
  const c = await provision();
  assert.equal((await command(c, 'focus')).body.error, 'host-offline');
  assert.equal((await command(c, 'list_monitors')).body.error, 'host-offline');
  assert.equal((await command(c, 'clipboard_read')).body.error, 'host-offline');
  assert.equal((await api(ownerRoute(c) + '/command', c.ownerToken, { name: 'focus', args: {} })).body.error, 'owner-command-blocked');
  assert.equal((await api(ownerRoute(c) + '/command', c.ownerToken, { name: 'clipboard_write', args: { text: 'x' } })).body.error, 'owner-command-blocked');
  assert.equal((await api(ownerRoute(c) + '/command', c.ownerToken, { name: 'list_monitors', args: {} })).status, 503);
});

test('invalid bodies, request IDs, query credentials, origin, and unknown commands fail closed', async () => {
  const c = await provision();
  assert.equal((await command(c, 'unknown')).status, 400);
  assert.equal((await command(c, 'status', 'bot-a', { 'x-request-id': '' })).body.error, 'request-id-required');
  assert.equal((await api(ownerRoute(c) + '/status?token=secret', c.ownerToken)).status, 400);
  assert.equal((await api(ownerRoute(c) + '/status', c.ownerToken, undefined, { origin: 'https://other.example' })).status, 403);
  assert.equal((await api(botRoute(c), c.botToken, { name: 'type', args: { text: 'x'.repeat(20_000) } }, { 'x-bot-id': 'bot-a' })).status, 413);
  const malformed = await fetch(origin + botRoute(c), { method: 'POST', headers: { authorization: 'Bearer ' + c.botToken, 'content-type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
  const html = await fetch(origin + '/control/' + c.hostId);
  assert.match(html.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(html.headers.get('referrer-policy'), 'no-referrer');
});

test('silent host cannot leave an arm request authorized after timeout', async t => {
  const c = await provision(); const socket = await connected(c, t);
  const pending = api(ownerRoute(c) + '/state', c.ownerToken, { mode: 'armed' });
  const original = await socket.next('owner_state');
  const result = await pending;
  assert.equal(result.status, 504); assert.equal(result.body.mode, 'off');
  const safety = await socket.next('owner_state'); assert.equal(safety.mode, 'off');
  socket.send(JSON.stringify({ ...original, type: 'owner_state_result', ok: true }));
  await delay(10);
  assert.equal((await api(ownerRoute(c) + '/status', c.ownerToken)).body.mode, 'off');
});

test('concurrent provisioning creates exactly one credential set', async () => {
  const c = { hostId: 'race-' + randomUUID(), hostToken: randomToken(), ownerToken: randomToken(), botToken: randomToken() };
  const second = { ...c, hostToken: randomToken(), ownerToken: randomToken(), botToken: randomToken() };
  const results = await Promise.all([api('/api/provision', secret, c), api('/api/provision', secret, second)]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  const statuses = await Promise.all([api(ownerRoute(c) + '/status', c.ownerToken), api(ownerRoute(c) + '/status', second.ownerToken)]);
  assert.deepEqual(statuses.map(r => r.status).sort(), [200, 401]);
});

test('Worker restart defaults off; explicit owner timer survives and resumes after acknowledgement', async t => {
  const c = await provision(); const socket = await connected(c, t); await arm(c, socket);
  await mf.setOptions(localOptions('\n// restart probe'));
  origin = (await mf.ready).origin;
  const status = await api(ownerRoute(c) + '/status', c.ownerToken);
  assert.equal(status.body.mode, 'off'); assert.equal(status.body.hostOnline, false);
  assert.ok(status.body.schedule);
  assert.equal((await command(c, 'snapshot')).body.error, 'host-offline');
  const replacement = await connected(c, t);
  await acceptScheduledArm(replacement);
  await until(async () => (await api(ownerRoute(c) + '/status', c.ownerToken)).body.mode === 'armed');
  await arm(c, replacement, 'off');
  replacement.close();
  await until(async () => !(await api(ownerRoute(c) + '/status', c.ownerToken)).body.hostOnline);
  await connected(c, t);
  assert.equal((await command(c, 'snapshot')).body.error, 'not-armed');
});

test('real host controller and relay client complete remote arm, snapshot, input, pause and local stop with simulated native calls', async t => {
  const c = await provision();
  const target = { handle: '101', processId: 1001, processStartedAt: '123456', processName: 'notepad', title: 'Test document', integrity: 'medium', desktop: 'default', automationChecked: true, passwordPresent: false, passwordFocused: false, geometry: { x: 0, y: 0, width: 1, height: 1 } };
  const configuration = { ...c, relayUrl: origin, allowRemoteArm: true, allowedApps: ['notepad'] };
  const executed = [];
  let blockInput = false;
  let inputStarted;
  let resolveInputStarted;
  const executor = {
    inspect: async () => ({ ok: true, window: { ...target } }),
    foreground: async () => ({ ...target }),
    run: async (name, args, { signal }) => {
      executed.push(name);
      if (name === 'click' && blockInput) {
        resolveInputStarted();
        await new Promise((_resolve, reject) => { if (signal.aborted) reject(new Error('aborted')); else signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); });
      }
      if (name === 'snapshot' || name === 'screenshot') return { ok: true, window: { ...target }, mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==', width: 1, height: 1 };
      return { ok: true };
    },
    recordStart: async () => ({ ok: true }), recordStop: async () => ({ ok: true, recording: false })
  };
  const controller = new HostController({ configStore: { load: () => configuration }, auditLog: { write: () => {} }, executor });
  const client = new RelayClient({ getConfig: () => configuration, onCommand: m => controller.runCommand(m), onOwnerState: m => controller.applyOwnerState(m) });
  controller.attachRelay(client); controller.selectTarget(target);
  t.after(() => { controller.emergencyStop('test-end'); client.disconnect(); });
  const ready = new Promise(resolve => client.on('status', s => { if (s.authenticated) resolve(); }));
  client.connect(); await ready;
  assert.equal(controller.mode, 'off');
  assert.equal((await client.ownerState('armed')).mode, 'armed');
  assert.equal(controller.mode, 'armed');
  const capture = await command(c, 'snapshot');
  assert.equal(capture.status, 200); assert.ok(capture.body.result.snapshotId);
  const click = await api(botRoute(c), c.botToken, { name: 'click', args: { x: 0, y: 0, snapshotId: capture.body.result.snapshotId } }, { 'x-bot-id': 'bot-a' });
  assert.equal(click.status, 200); assert.deepEqual(executed, ['snapshot', 'click']);
  const secondCapture = await command(c, 'snapshot');
  blockInput = true; inputStarted = new Promise(resolve => { resolveInputStarted = resolve; });
  const blocked = api(botRoute(c), c.botToken, { name: 'click', args: { x: 0, y: 0, snapshotId: secondCapture.body.result.snapshotId } }, { 'x-bot-id': 'bot-a' });
  await inputStarted;
  assert.equal((await client.ownerState('paused')).mode, 'paused');
  assert.equal((await blocked).body.error, 'owner-paused');
  assert.equal(controller.mode, 'paused');
  controller.emergencyStop('test-local-stop');
  await delay(20);
  const rejected = await api(ownerRoute(c) + '/state', c.ownerToken, { mode: 'armed' });
  assert.equal(rejected.body.error, 'local-stop-latched');
  assert.equal(controller.mode, 'off');
  assert.equal((await command(c, 'status')).body.result.mode, 'off');
  controller.clearLocalStop();
  const startsAt = Date.now() + 100;
  await api(ownerRoute(c) + '/schedule', c.ownerToken, { startsAt, endsAt: startsAt + 600 });
  await until(() => controller.mode === 'armed');
  await until(() => controller.mode === 'off');
  await until(async () => !(await api(ownerRoute(c) + '/status', c.ownerToken)).body.schedule);
});

test('owner schedule starts and stops through actual alarms without phone polling or PC confirmation', async t => {
  const c = await provision(); const socket = await connected(c, t);
  const startsAt = Date.now() + 500, endsAt = startsAt + 1500;
  assert.equal((await api(ownerRoute(c) + '/schedule', c.botToken, { startsAt, endsAt })).status, 401);
  assert.equal((await api(ownerRoute(c) + '/schedule', c.ownerToken, { startsAt, endsAt: startsAt + 13 * 3600_000 })).status, 400);
  const saved = await api(ownerRoute(c) + '/schedule', c.ownerToken, { startsAt, endsAt });
  assert.equal(saved.body.saved, true); assert.equal(saved.body.mode, 'off'); assert.equal(saved.body.schedulePending, true);
  const start = await acceptScheduledArm(socket);
  assert.equal(start.expiresAt, endsAt);
  await until(async () => (await api(ownerRoute(c) + '/status', c.ownerToken)).body.mode === 'armed');
  const end = await nextMode(socket, 'off');
  assert.ok(['schedule-ended', 'session-expired'].includes(end.reason));
  await until(async () => !(await api(ownerRoute(c) + '/status', c.ownerToken)).body.schedule);
  assert.equal((await command(c, 'snapshot')).body.error, 'not-armed');
});

test('offline saved schedule can start on connect; phone PAUSE cancels it and prevents reconnect autoarm', async t => {
  const c = await provision(); const startsAt = Date.now() - 100, endsAt = Date.now() + 10_000;
  const saved = await api(ownerRoute(c) + '/schedule', c.ownerToken, { startsAt, endsAt });
  assert.equal(saved.body.hostOnline, false); assert.equal(saved.body.schedulePending, true);
  const socket = await connected(c, t); await acceptScheduledArm(socket);
  await until(async () => (await api(ownerRoute(c) + '/status', c.ownerToken)).body.mode === 'armed');
  assert.equal((await arm(c, socket, 'paused')).body.schedule, null);
  socket.close(); await until(async () => !(await api(ownerRoute(c) + '/status', c.ownerToken)).body.hostOnline);
  await connected(c, t);
  assert.equal((await command(c, 'snapshot')).body.error, 'not-armed');
});

test('local emergency and local-stop rejection cancel saved schedules instead of retrying', async t => {
  const c = await provision(); const socket = await connected(c, t);
  await api(ownerRoute(c) + '/schedule', c.ownerToken, { startsAt: Date.now() + 10_000, endsAt: Date.now() + 20_000 });
  socket.send(JSON.stringify({ type: 'local_state', mode: 'off', source: 'emergency' }));
  await until(async () => !(await api(ownerRoute(c) + '/status', c.ownerToken)).body.schedule);
  await api(ownerRoute(c) + '/schedule', c.ownerToken, { startsAt: Date.now() - 100, endsAt: Date.now() + 10_000 });
  const message = await nextMode(socket, 'armed');
  socket.send(JSON.stringify({ ...message, type: 'owner_state_result', ok: false, error: 'local-stop-latched', mode: 'off', expiresAt: null }));
  await until(async () => !(await api(ownerRoute(c) + '/status', c.ownerToken)).body.schedule);
  assert.equal((await api(ownerRoute(c) + '/status', c.ownerToken)).body.scheduleError, 'local-stop-latched');
});

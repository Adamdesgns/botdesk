import { DurableObject } from 'cloudflare:workers';
import { dashboardHtml } from './dashboard';
import { canBotControl, clampMinutes, DEFAULT_STATE, effectiveState, normalizeMode, type RelayState } from './policy';

type Secrets = { hostHash: string; ownerHash: string; botHash: string };
type RecordValue = Record<string, unknown>;
type OwnerSchedule = { id: string; startsAt: number; endsAt: number };
type Pending = { id: string; kind: 'command' | 'state'; generation: number; mode?: string; expiresAt?: number | null; resolve: (value: Response) => void; timer: ReturnType<typeof setTimeout> };
const HTTP_LIMIT = 16_384;
const FRAME_LIMIT = 10 * 1024 * 1024;
const COMMAND_TIMEOUT = 20_000;
const STATE_TIMEOUT = 5_000;
const HEARTBEAT_TIMEOUT = 30_000;
const COMMANDS = new Set(['status', 'screenshot', 'snapshot', 'list_windows', 'click', 'drag', 'type', 'key', 'scroll', 'record_start', 'record_stop', 'stop_all']);
const TOKEN = /^[A-Za-z0-9_-]{43,128}$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{8,96}$/;
function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' } });
}
function bearer(request: Request): string {
  const header = request.headers.get('authorization') || '';
  const value = header.startsWith('Bearer ') ? header.slice(7) : '';
  return TOKEN.test(value) ? value : '';
}
async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}
function equalHash(left: string, right: string): boolean {
  return left.length === right.length && crypto.subtle.timingSafeEqual(new TextEncoder().encode(left), new TextEncoder().encode(right));
}
function safeHost(value: unknown): string | null {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value) ? value : null;
}
function sessionStub(env: Env, hostId: string): DurableObjectStub<BotDeskSession> {
  // Wrangler 4.130 emits an unparameterized namespace here. The binding is verified by local integration tests.
  return env.SESSIONS.getByName(hostId) as DurableObjectStub<BotDeskSession>;
}
function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
class BodyError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
async function readJson(request: Request): Promise<RecordValue> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new BodyError('json-required', 415);
  if (Number(request.headers.get('content-length')) > HTTP_LIMIT) throw new BodyError('body-too-large', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new BodyError('missing-body', 400);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const deadline = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { void reader.cancel(); reject(new BodyError('body-timeout', 408)); }, 5_000); });
  try {
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      total += value.byteLength;
      if (total > HTTP_LIMIT) { void reader.cancel(); throw new BodyError('body-too-large', 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let value: unknown;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)); }
    catch { throw new BodyError('invalid-json', 400); }
    if (!isRecord(value)) throw new BodyError('json-object-required', 400);
    return value;
  } finally { clearTimeout(timer); reader.releaseLock(); }
}

/** One PC per object. Ordinary sessions start OFF after restart.
 * Only an explicit owner schedule may re-authorize an acknowledged session during its saved time window.
 */
export class BotDeskSession extends DurableObject<Env> {
  private secrets: Secrets | undefined;
  private state: RelayState = { ...DEFAULT_STATE };
  private host: WebSocket | null = null;
  private pending: Pending | null = null;
  private generation = 0;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private seen = new Map<string, number>();
  private schedule: OwnerSchedule | null = null;
  private scheduleRevision = 0;
  private scheduleError: string | null = null;
  private ownerTransition: number | null = null;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.secrets = await ctx.storage.get<Secrets>('secrets');
      this.schedule = await ctx.storage.get<OwnerSchedule>('ownerSchedule') || null;
      if (this.schedule && !await ctx.storage.getAlarm()) await ctx.storage.setAlarm(Math.max(Date.now() + 1, this.schedule.startsAt));
    });
  }
  // Recheck the provisioning secret inside RPC so future HTTP routing cannot bypass it.
  async provision(secret: string, input: RecordValue): Promise<Response> {
    if (!TOKEN.test(secret) || !this.env.PROVISIONING_SECRET || !equalHash(await hashToken(secret), await hashToken(this.env.PROVISIONING_SECRET))) return json({ error: 'unauthorized' }, 401);
    if (!safeHost(input.hostId) || !TOKEN.test(String(input.hostToken || '')) || !TOKEN.test(String(input.ownerToken || '')) || !TOKEN.test(String(input.botToken || ''))) return json({ error: 'invalid-provisioning-input' }, 400);
    if (new Set([input.hostToken, input.ownerToken, input.botToken]).size !== 3) return json({ error: 'tokens-must-differ' }, 400);
    const next: Secrets = { hostHash: await hashToken(String(input.hostToken)), ownerHash: await hashToken(String(input.ownerToken)), botHash: await hashToken(String(input.botToken)) };
    const created = await this.ctx.storage.transaction(async (txn) => {
      if (await txn.get('secrets')) return false;
      await txn.put('secrets', next); return true;
    });
    if (!created) return json({ error: 'already-provisioned' }, 409);
    this.secrets = next;
    return json({ ok: true }, 201);
  }
  // fetch is ONLY the host WebSocket upgrade. HTTP control uses named RPC methods.
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'GET' || !/^\/api\/host\/[a-z0-9][a-z0-9-]{0,63}\/socket$/.test(new URL(request.url).pathname)) return json({ error: 'not-found' }, 404);
    if (!await this.authorized(bearer(request), 'host')) return json({ error: 'unauthorized' }, 401);
    if (request.headers.has('origin')) return json({ error: 'browser-host-connection-blocked' }, 403);
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'websocket-required' }, 426);
    if (this.host && this.host.readyState === WebSocket.OPEN) return json({ error: 'host-already-connected' }, 409);
    const [client, server] = Object.values(new WebSocketPair());
    server.accept(); this.host = server; this.forceOff('host-connected');
    server.addEventListener('message', (event) => this.hostMessage(server, event.data));
    server.addEventListener('close', () => this.disconnectHost(server, 'host-disconnected'));
    server.addEventListener('error', () => this.disconnectHost(server, 'host-error'));
    this.heartbeat();
    server.send(JSON.stringify({ type: 'auth_ok', connectionId: crypto.randomUUID(), state: this.state, controlGeneration: this.generation }));
    if (this.schedule) this.ctx.waitUntil(this.tickSchedule());
    return new Response(null, { status: 101, webSocket: client });
  }
  async ownerStatus(token: string): Promise<Response> {
    if (!await this.authorized(token, 'owner')) return json({ error: 'unauthorized' }, 401);
    return json(this.status());
  }
  async ownerState(token: string, body: RecordValue, requestId: string): Promise<Response> {
    if (!await this.authorized(token, 'owner')) return json({ error: 'unauthorized' }, 401);
    const mode = normalizeMode(body.mode);
    if (!mode || mode === 'running') return json({ error: 'invalid-mode' }, 400);
    const replay = this.reserveId(requestId, mode !== 'armed'); if (replay) return replay;
    if (mode === 'armed' && this.pending) return json({ error: 'host-busy' }, 409);
    this.forceOff(mode === 'armed' ? 'arm-requested' : `owner-${mode}`);
    const generation = this.generation;
    this.ownerTransition = generation;
    if (mode !== 'armed') this.sendSafetyOff(`owner-${mode}`);
    const expiresAt = mode === 'armed' ? Date.now() + clampMinutes(body.minutes) * 60_000 : null;
    const saved = expiresAt ? { id: crypto.randomUUID(), startsAt: Date.now(), endsAt: expiresAt } : null;
    try {
      await this.replaceSchedule(saved);
      if (this.generation !== generation) return json({ error: 'state-superseded' }, 409);
      if (!this.host) return json({ ...this.status(), confirmed: false, saved: Boolean(saved) }, saved ? 202 : 200);
      const responsePromise = this.sendAndWait('state', { type: 'owner_state', requestId, mode, minutes: clampMinutes(body.minutes), expiresAt, controlGeneration: this.generation }, requestId, mode, expiresAt);
      this.ownerTransition = null;
      const response = await responsePromise;
      if (saved) await this.completeScheduleAttempt(saved, response.clone());
      return response;
    } finally { if (this.ownerTransition === generation) this.ownerTransition = null; }
  }
  async ownerSchedule(token: string, body: RecordValue, requestId: string): Promise<Response> {
    if (!await this.authorized(token, 'owner')) return json({ error: 'unauthorized' }, 401);
    const { startsAt, endsAt } = body;
    const now = Date.now();
    if (!Number.isSafeInteger(startsAt) || !Number.isSafeInteger(endsAt) ||
      typeof startsAt !== 'number' || typeof endsAt !== 'number' || startsAt >= endsAt || endsAt <= now ||
      endsAt - startsAt > 720 * 60_000 || startsAt > now + 30 * 86_400_000) return json({ error: 'invalid-schedule-window' }, 400);
    const replay = this.reserveId(requestId); if (replay) return replay;
    this.forceOff('owner-schedule-saved'); this.sendSafetyOff('owner-schedule-saved');
    const generation = this.generation; this.ownerTransition = generation;
    const next = { id: crypto.randomUUID(), startsAt, endsAt };
    try { await this.replaceSchedule(next); }
    finally { if (this.ownerTransition === generation) this.ownerTransition = null; }
    if (this.schedule?.id !== next.id) return json({ error: 'schedule-superseded' }, 409);
    this.ctx.waitUntil(this.tickSchedule());
    return json({ ...this.status(), saved: true });
  }
  async alarm(): Promise<void> { await this.tickSchedule(); }
  private async replaceSchedule(next: OwnerSchedule | null): Promise<void> {
    const revision = ++this.scheduleRevision;
    this.schedule = next; this.scheduleError = null;
    try {
      await this.ctx.storage.transaction(async txn => {
        if (revision !== this.scheduleRevision) return;
        if (next) {
          await txn.put('ownerSchedule', next);
          await txn.setAlarm(Math.max(Date.now() + 1, next.startsAt));
        } else {
          await txn.delete('ownerSchedule'); await txn.deleteAlarm();
        }
      });
    } catch (error) {
      if (revision === this.scheduleRevision) { this.schedule = null; this.forceOff('schedule-storage-failed'); this.sendSafetyOff('schedule-storage-failed'); }
      throw error;
    }
  }
  private async tickSchedule(): Promise<void> {
    const saved = this.schedule;
    if (!saved) return;
    const now = Date.now();
    if (now >= saved.endsAt) {
      this.forceOff('schedule-ended'); this.sendSafetyOff('schedule-ended'); await this.replaceSchedule(null); return;
    }
    if (now < saved.startsAt) { await this.ctx.storage.setAlarm(saved.startsAt); return; }
    if (!this.host || this.pending || this.ownerTransition !== null) { await this.ctx.storage.setAlarm(Math.min(now + 30_000, saved.endsAt)); return; }
    if (['armed', 'running'].includes(this.state.mode) && this.state.expiresAt === saved.endsAt) {
      await this.ctx.storage.setAlarm(saved.endsAt); return;
    }
    this.forceOff('scheduled-arm');
    const requestId = crypto.randomUUID();
    const response = await this.sendAndWait('state', {
      type: 'owner_state', requestId, mode: 'armed', expiresAt: saved.endsAt,
      minutes: Math.max(1, Math.ceil((saved.endsAt - now) / 60_000)), controlGeneration: this.generation
    }, requestId, 'armed', saved.endsAt);
    await this.completeScheduleAttempt(saved, response);
  }
  private async completeScheduleAttempt(saved: OwnerSchedule, response: Response): Promise<void> {
    if (this.schedule?.id !== saved.id) return;
    if (response.ok) { this.scheduleError = null; await this.ctx.storage.setAlarm(saved.endsAt); return; }
    const result = await response.json<{ error?: string }>();
    if (this.schedule?.id !== saved.id) return;
    this.scheduleError = result.error || 'scheduled-arm-rejected';
    if (['local-stop-latched', 'remote-arm-disabled', 'local-stop'].includes(this.scheduleError)) {
      const error = this.scheduleError; await this.replaceSchedule(null); this.scheduleError = error; return;
    }
    await this.ctx.storage.setAlarm(Math.min(Date.now() + 30_000, saved.endsAt));
  }
  async command(token: string, role: 'owner' | 'bot', body: RecordValue, botId: string, requestId: string): Promise<Response> {
    if (!['owner', 'bot'].includes(role) || !await this.authorized(token, role)) return json({ error: 'unauthorized' }, 401);
    const name = body.name;
    if (typeof name !== 'string' || !COMMANDS.has(name) || (body.args !== undefined && !isRecord(body.args))) return json({ error: 'invalid-command' }, 400);
    if (role === 'owner' && !['status', 'screenshot', 'snapshot', 'stop_all', 'record_stop'].includes(name)) return json({ error: 'owner-command-blocked' }, 403);
    if (role === 'bot' && (!/^[A-Za-z0-9_-]{1,80}$/.test(botId) || botId === 'owner-preview')) return json({ error: 'invalid-bot-id' }, 400);
    const replay = this.reserveId(requestId, name === 'stop_all' || name === 'record_stop'); if (replay) return replay;
    if (name === 'status') return json({ ok: true, result: this.status() });
    if (name === 'stop_all') { this.forceOff('remote-stop'); this.sendSafetyOff('remote-stop'); await this.replaceSchedule(null); return json({ ok: true, result: this.status() }); }
    if (!this.host) return json({ error: 'host-offline' }, 503);
    if (this.pending) return json({ error: 'host-busy' }, 409);
    this.refreshState();
    if (name !== 'record_stop') {
      if (role === 'owner') {
        if (!['armed', 'running'].includes(this.state.mode)) return json({ error: 'not-armed' }, 409);
      } else {
        const verdict = canBotControl(this.state, botId);
        if (!verdict.allowed || !verdict.next) return json({ error: verdict.error }, 409);
        this.state = verdict.next;
      }
    }
    const commandId = crypto.randomUUID();
    return this.sendAndWait('command', { type: 'command', commandId, name, args: body.args || {}, botId: role === 'owner' ? 'owner-preview' : botId, ownerPreview: role === 'owner', expiresAt: Math.min(Date.now() + COMMAND_TIMEOUT, this.state.expiresAt || Infinity), controlGeneration: this.generation }, commandId);
  }
  private async authorized(token: string, role: 'owner' | 'bot' | 'host'): Promise<boolean> {
    if (!TOKEN.test(token) || !this.secrets) return false;
    return equalHash(await hashToken(token), this.secrets[`${role}Hash`]);
  }
  private reserveId(id: string, safetyStop = false): Response | null {
    if (!REQUEST_ID.test(id)) return json({ error: 'request-id-required' }, 400);
    const now = Date.now();
    for (const [key, expires] of this.seen) { if (expires <= now) this.seen.delete(key); }
    if (this.seen.has(id)) return json({ error: 'request-replayed' }, 409);
    // A saturated command budget must never prevent the owner from stopping access.
    if (this.seen.size >= 2048) return safetyStop ? null : json({ error: 'request-rate-limit' }, 429);
    this.seen.set(id, now + 5 * 60_000); return null;
  }
  private status() {
    this.refreshState();
    return { ...this.state, hostOnline: this.host !== null, controlGeneration: this.generation, pending: this.pending?.kind || null,
      schedule: this.schedule ? { startsAt: this.schedule.startsAt, endsAt: this.schedule.endsAt } : null,
      schedulePending: Boolean(this.schedule && (Date.now() < this.schedule.startsAt || !['armed', 'running'].includes(this.state.mode))),
      liveEndsAt: this.state.expiresAt, scheduleError: this.scheduleError };
  }
  private refreshState(): void {
    const current = effectiveState(this.state);
    if (this.state.mode !== 'off' && current.mode === 'off') { this.forceOff('session-expired'); this.sendSafetyOff('session-expired'); }
    else this.state = current;
  }
  private sendAndWait(kind: 'command' | 'state', payload: RecordValue, id: string, mode?: string, expiresAt?: number | null): Promise<Response> {
    return new Promise((resolve) => {
      const generation = this.generation;
      const timer = setTimeout(() => {
        if (this.pending?.id !== id) return;
        this.pending = null; this.forceOff(`${kind}-timeout`); this.sendSafetyOff(`${kind}-timeout`);
        resolve(json({ error: `${kind}-timeout`, ...this.status() }, 504));
      }, kind === 'state' ? STATE_TIMEOUT : COMMAND_TIMEOUT);
      this.pending = { id, kind, generation, mode, expiresAt, resolve, timer };
      try { this.host!.send(JSON.stringify(payload)); } catch { this.disconnectHost(this.host!, 'host-send-failed'); }
    });
  }
  private settle(response: Response): void {
    const pending = this.pending; this.pending = null;
    if (pending) { clearTimeout(pending.timer); pending.resolve(response); }
  }
  private forceOff(reason: string): void {
    this.generation++; clearTimeout(this.expiryTimer);
    this.state = { ...DEFAULT_STATE, hostLastSeen: this.state.hostLastSeen };
    this.settle(json({ error: reason }, 409));
  }
  private sendSafetyOff(reason: string): void {
    try { this.host?.send(JSON.stringify({ type: 'owner_state', requestId: crypto.randomUUID(), mode: 'off', expiresAt: null, controlGeneration: this.generation, reason })); }
    catch { if (this.host) this.disconnectHost(this.host, 'host-send-failed'); }
  }
  private heartbeat(): void {
    clearTimeout(this.heartbeatTimer); this.state.hostLastSeen = Date.now();
    const host = this.host;
    this.heartbeatTimer = setTimeout(() => { if (host) this.disconnectHost(host, 'host-heartbeat-timeout'); }, HEARTBEAT_TIMEOUT);
  }
  private disconnectHost(socket: WebSocket, reason: string): void {
    if (this.host !== socket) return;
    this.host = null; clearTimeout(this.heartbeatTimer); this.forceOff(reason);
    try { socket.close(1001, reason); } catch { /* already disconnected */ }
  }
  private hostMessage(socket: WebSocket, raw: string | ArrayBuffer): void {
    if (socket !== this.host) return;
    if (typeof raw !== 'string' || raw.length > FRAME_LIMIT) return this.disconnectHost(socket, 'invalid-host-frame');
    let message: unknown;
    try { message = JSON.parse(raw); } catch { return this.disconnectHost(socket, 'invalid-host-json'); }
    if (!isRecord(message)) return this.disconnectHost(socket, 'invalid-host-message');
    if (message.type === 'heartbeat') { this.heartbeat(); socket.send(JSON.stringify({ type: 'heartbeat_ack', controlGeneration: this.generation })); return; }
    if (message.type === 'local_state' && (message.mode === 'off' || message.mode === 'paused')) {
      if (this.pending?.kind === 'state' && this.pending.generation === message.controlGeneration && this.pending.mode === message.mode) return;
      const reconnect = message.source === 'relay-disconnected';
      const expiry = message.source === 'expiry';
      this.forceOff(reconnect ? 'host-disconnected' : expiry ? 'session-expired' : 'local-stop'); this.state.mode = message.mode;
      if (message.mode === 'paused' || (!reconnect && !expiry)) this.ctx.waitUntil(this.replaceSchedule(null));
      return;
    }
    const pending = this.pending;
    if (!pending || pending.generation !== this.generation) return;
    if (message.type === 'owner_state_result' && pending.kind === 'state' && message.requestId === pending.id) {
      if (message.ok !== true || message.mode !== pending.mode || message.expiresAt !== pending.expiresAt || message.controlGeneration !== pending.generation) {
        this.settle(json({ error: typeof message.error === 'string' ? message.error.slice(0, 160) : 'owner-state-rejected', ...this.status() }, 409));
        this.forceOff('owner-state-rejected'); this.sendSafetyOff('owner-state-rejected'); return;
      }
      if (pending.mode === 'armed' && (pending.expiresAt || 0) <= Date.now()) {
        this.settle(json({ error: 'owner-state-expired' }, 409)); this.forceOff('owner-state-expired'); this.sendSafetyOff('owner-state-expired'); return;
      }
      this.state = { ...this.state, mode: pending.mode as RelayState['mode'], expiresAt: pending.expiresAt ?? null, activeBot: null, leaseEndsAt: null };
      if (this.state.expiresAt) this.expiryTimer = setTimeout(() => { this.forceOff('session-expired'); this.sendSafetyOff('session-expired'); }, Math.max(1, this.state.expiresAt - Date.now()));
      this.settle(json({ ...this.status(), pending: null, confirmed: true })); return;
    }
    if (message.type === 'command_result' && pending.kind === 'command' && message.commandId === pending.id) {
      this.settle(message.ok === true ? json({ ok: true, result: message.result }) : json({ error: typeof message.error === 'string' ? message.error.slice(0, 160) : 'command-failed', message: typeof message.message === 'string' ? message.message.slice(0, 500) : undefined }, 409));
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.search) return json({ error: 'query-parameters-not-accepted' }, 400);
      if (request.headers.has('origin') && request.headers.get('origin') !== url.origin) return json({ error: 'cross-origin-request-blocked' }, 403);
      if (request.method === 'GET' && url.pathname === '/health') return json({ ok: true, service: 'botdesk-relay' });
      const dashboard = /^\/control\/([a-z0-9][a-z0-9-]{0,63})$/.exec(url.pathname);
      if (request.method === 'GET' && dashboard) return new Response(dashboardHtml(dashboard[1]), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" } });
      if (request.method === 'POST' && url.pathname === '/api/provision') {
        const token = bearer(request);
        if (!token || !env.PROVISIONING_SECRET || !equalHash(await hashToken(token), await hashToken(env.PROVISIONING_SECRET))) return json({ error: 'unauthorized' }, 401);
        const body = await readJson(request); const hostId = safeHost(body.hostId);
        if (!hostId) return json({ error: 'invalid-host' }, 400);
        return sessionStub(env, hostId).provision(token, body);
      }
      const host = /^\/api\/host\/([a-z0-9][a-z0-9-]{0,63})\/socket$/.exec(url.pathname);
      if (host && request.method === 'GET') return sessionStub(env, host[1]).fetch(request);
      const owner = /^\/api\/owner\/([a-z0-9][a-z0-9-]{0,63})\/(status|state|command|schedule)$/.exec(url.pathname);
      const bot = /^\/api\/bot\/([a-z0-9][a-z0-9-]{0,63})\/command$/.exec(url.pathname);
      if (owner || bot) {
        const token = bearer(request); if (!token) return json({ error: 'unauthorized' }, 401);
        const stub = sessionStub(env, (owner || bot)![1]);
        if (owner?.[2] === 'status' && request.method === 'GET') return stub.ownerStatus(token);
        if (request.method !== 'POST' || owner?.[2] === 'status') return json({ error: 'method-not-allowed' }, 405);
        const body = await readJson(request); const requestId = request.headers.get('x-request-id') || '';
        if (owner?.[2] === 'state') return stub.ownerState(token, body, requestId);
        if (owner?.[2] === 'schedule') return stub.ownerSchedule(token, body, requestId);
        return stub.command(token, owner ? 'owner' : 'bot', body, request.headers.get('x-bot-id') || '', requestId);
      }
      return json({ error: 'not-found' }, 404);
    } catch (error) { return json({ error: error instanceof BodyError ? error.message : 'relay-error' }, error instanceof BodyError ? error.status : 500); }
  }
} satisfies ExportedHandler<Env>;

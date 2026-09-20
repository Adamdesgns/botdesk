/** Stable BotDesk error codes for bots and operators. Never include secret values. */
export const ERROR_CODES = Object.freeze({
  CREDENTIAL_MISSING: 'credential-missing',
  AUTHENTICATION_REJECTED: 'authentication-rejected',
  HOST_OFFLINE: 'host-offline',
  SESSION_EXPIRED: 'session-expired',
  NOT_ARMED: 'not-armed',
  COMMAND_TIMEOUT: 'command-timeout',
  PAYLOAD_TOO_LARGE: 'payload-too-large',
  HOST_BUSY: 'host-busy',
  BOT_LEASE_HELD: 'bot-lease-held',
  CANCELLED: 'command-cancelled',
  MISCONFIGURED: 'misconfigured',
  UNKNOWN: 'unknown-error'
});

const RELAY_MAP = Object.freeze({
  unauthorized: ERROR_CODES.AUTHENTICATION_REJECTED,
  'host-offline': ERROR_CODES.HOST_OFFLINE,
  'not-armed': ERROR_CODES.NOT_ARMED,
  expired: ERROR_CODES.SESSION_EXPIRED,
  'session-expired': ERROR_CODES.SESSION_EXPIRED,
  'command-timeout': ERROR_CODES.COMMAND_TIMEOUT,
  'state-timeout': ERROR_CODES.COMMAND_TIMEOUT,
  'host-busy': ERROR_CODES.HOST_BUSY,
  'bot-lease-held': ERROR_CODES.BOT_LEASE_HELD,
  'payload-too-large': ERROR_CODES.PAYLOAD_TOO_LARGE,
  'capture-too-large': ERROR_CODES.PAYLOAD_TOO_LARGE,
  'invalid-host-frame': ERROR_CODES.PAYLOAD_TOO_LARGE
});

export function classifyRelayError(status, payload = {}) {
  const raw = String(payload?.error || payload?.message || '').trim();
  if (status === 401 || status === 403) return ERROR_CODES.AUTHENTICATION_REJECTED;
  if (status === 503) return ERROR_CODES.HOST_OFFLINE;
  if (status === 504) return ERROR_CODES.COMMAND_TIMEOUT;
  if (RELAY_MAP[raw]) return RELAY_MAP[raw];
  if (/timed out|timeout/i.test(raw)) return ERROR_CODES.COMMAND_TIMEOUT;
  if (/not.?armed/i.test(raw)) return ERROR_CODES.NOT_ARMED;
  if (/offline/i.test(raw)) return ERROR_CODES.HOST_OFFLINE;
  if (/expir/i.test(raw)) return ERROR_CODES.SESSION_EXPIRED;
  if (/unauthor|forbidden|invalid.?token/i.test(raw)) return ERROR_CODES.AUTHENTICATION_REJECTED;
  if (/too.?large|frame|payload/i.test(raw)) return ERROR_CODES.PAYLOAD_TOO_LARGE;
  return raw || ERROR_CODES.UNKNOWN;
}

export function formatBotError(code, detail = '') {
  const cleanDetail = String(detail || '').replace(/[A-Za-z0-9_-]{20,}/g, '[redacted]').slice(0, 240);
  const hints = {
    [ERROR_CODES.CREDENTIAL_MISSING]: 'Set BOTDESK_BOT_TOKEN via the platform secret-request or MCP env. Do not rely on a homemade secrets file alone.',
    [ERROR_CODES.AUTHENTICATION_REJECTED]: 'The bot token was rejected by the relay. Confirm the existing botToken (not hostToken/ownerToken) and do not rotate unless authorized.',
    [ERROR_CODES.HOST_OFFLINE]: 'The Windows host is not connected to the relay. Start BotDesk on the PC and wait for authenticated status.',
    [ERROR_CODES.SESSION_EXPIRED]: 'The armed session expired. Ask the owner to arm a new window; do not replay prior clicks.',
    [ERROR_CODES.NOT_ARMED]: 'Access is OFF or paused. Wait for an owner GO LIVE before input or capture.',
    [ERROR_CODES.COMMAND_TIMEOUT]: 'The relay did not receive a timely result. Abort; retake a fresh screenshot before any input. Do not assume the prior action applied.',
    [ERROR_CODES.PAYLOAD_TOO_LARGE]: 'The screenshot or result exceeded transport limits. Capture again; the host should compress large frames.',
    [ERROR_CODES.HOST_BUSY]: 'Another command is in flight. Wait and retry once; do not queue clicks.',
    [ERROR_CODES.BOT_LEASE_HELD]: 'Another bot holds the lease. Do not fight the active controller.',
    [ERROR_CODES.CANCELLED]: 'The command was cancelled by STOP, disconnect, or expiry. Held inputs should be released; do not replay.',
    [ERROR_CODES.MISCONFIGURED]: 'BOTDESK_RELAY_URL, BOTDESK_HOST_ID and BOTDESK_BOT_TOKEN must all be set to valid values.'
  };
  const hint = hints[code] || 'Inspect status, then recover explicitly. Do not replay uncertain input.';
  return cleanDetail ? `${code}: ${cleanDetail} — ${hint}` : `${code}: ${hint}`;
}

export const CONTRACT_VERSION = '1.1.0';

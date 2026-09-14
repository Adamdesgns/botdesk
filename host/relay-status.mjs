// Stable reason codes and owner-readable text for the host's relay connection.
// Inputs are socket errors and close frames only; token values never reach this module.
const UNREACHABLE = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'ENETDOWN', 'EPIPE', 'ECONNABORTED']);
const DNS = new Set(['ENOTFOUND', 'EAI_AGAIN', 'EAI_FAIL', 'EAI_NONAME']);
const TLS = /^(ERR_TLS_|CERT_|UNABLE_TO_|SELF_SIGNED|DEPTH_ZERO|EPROTO$|HOSTNAME_MISMATCH|ERR_SSL_)/;
const SAFE_CODE = /^[A-Z0-9_]{1,40}$/;

export function classifySocketError(error) {
  const message = String(error?.message || '');
  const code = SAFE_CODE.test(String(error?.code || '')) ? String(error.code) : '';
  const http = /Unexpected server response: (\d{3})/.exec(message);
  if (http) {
    const httpStatus = Number(http[1]);
    if (httpStatus === 401) return { reason: 'unauthorized', httpStatus };
    if (httpStatus === 409) return { reason: 'host-already-connected', httpStatus };
    if (httpStatus === 404) return { reason: 'relay-route-missing', httpStatus };
    if (httpStatus >= 500) return { reason: 'relay-error', httpStatus };
    return { reason: 'relay-rejected', httpStatus };
  }
  if (/handshake has timed out/i.test(message)) return { reason: 'handshake-timeout' };
  if (DNS.has(code)) return { reason: 'dns-failure', code };
  if (UNREACHABLE.has(code)) return { reason: 'relay-unreachable', code };
  if (TLS.test(code)) return { reason: 'tls-error', code };
  return code ? { reason: 'connection-failed', code } : { reason: 'connection-failed' };
}

const TEXT = {
  'setup-required': ['Not configured', 'Paste the host pairing JSON, choose FILL PAIRING SETTINGS, then SAVE SETTINGS to connect this PC.'],
  'invalid-relay-url': ['Invalid relay URL', 'The relay URL must be an HTTPS origin such as https://your-relay.workers.dev, with no path. Local testing may use http://127.0.0.1:8787.'],
  connecting: ['Connecting', 'Contacting the relay.'],
  authenticating: ['Authenticating', 'The relay accepted the connection and is checking this PC\u2019s host token.'],
  authenticated: ['Securely connected', 'This PC is connected to its relay. Remote arming still requires a selected window and the remote-arm setting.'],
  unauthorized: ['Rejected by relay', 'The relay does not recognise this host ID and host token together. Re-import the completed pairing file (provisioningStatus "complete") and save again. A pairing that failed part-way cannot connect.'],
  'host-already-connected': ['Another copy is connected', 'Another Bot Door host is already connected with this host ID. Quit the other copy (check the tray on each PC) and this one will reconnect automatically.'],
  'relay-route-missing': ['Relay route missing', 'The relay answered 404. Check the relay URL points at the Bot Door relay origin itself, not another site.'],
  'relay-rejected': ['Relay refused the connection', 'The relay refused the host connection. Check the relay URL and try again.'],
  'relay-error': ['Relay error', 'The relay returned a server error. It will be retried automatically.'],
  'handshake-timeout': ['Relay not responding', 'The relay was reached but did not complete the WebSocket handshake within 10 seconds. Check the relay URL scheme (https vs http) and any proxy.'],
  'dns-failure': ['Relay address not found', 'The relay hostname could not be resolved. Check the relay URL for typos and confirm this PC has internet access.'],
  'relay-unreachable': ['Relay unreachable', 'This PC could not open a connection to the relay. Check internet access, firewall rules, or whether the local relay is still running.'],
  'tls-error': ['Secure connection failed', 'The relay\u2019s TLS certificate could not be verified. Check the relay URL and this PC\u2019s date and time.'],
  'heartbeat-timeout': ['Connection lost', 'The relay stopped answering heartbeats. Reconnecting automatically.'],
  disconnected: ['Disconnected', 'The relay closed the connection. Reconnecting automatically.'],
  stopped: ['Offline', 'The relay connection is stopped.'],
  'connection-failed': ['Connection failed', 'The relay connection failed. Reconnecting automatically.']
};

function detailSuffix(status) {
  const parts = [];
  if (status.code) parts.push(status.code);
  if (status.httpStatus) parts.push('HTTP ' + status.httpStatus);
  if (status.closeReason) parts.push('relay said: ' + status.closeReason);
  return parts.length ? ' (' + parts.join(', ') + ')' : '';
}

// Owner-facing text for relay error codes returned to GO LIVE / PAUSE requests. The code stays in
// parentheses so the troubleshooting guide can be searched by code.
const OWNER_ERRORS = {
  unauthorized: 'The relay rejected the owner token saved on this PC. Re-import the completed pairing file and save again.',
  'host-busy': 'The relay is still waiting on a previous request for this PC. Wait a few seconds and try again.',
  'state-timeout': 'This PC did not acknowledge the request within 5 seconds. Confirm Bot Door shows "Securely connected" and the approved window is still open, then try again.',
  'remote-arm-disabled': 'Remote arming is turned off on this PC. Enable "Allow remote arming" in Bot Door and save.',
  'local-stop-latched': 'The local stop is locked on this PC. Choose UNLOCK LOCAL STOP in Bot Door before starting access again.',
  'select-a-window-first': 'No approved window is selected on this PC. Choose REFRESH WINDOWS and select the app the bot should use.',
  'focus-refused': 'Windows refused to bring the approved window to the front. Click that window once on the PC and try again.',
  'target-not-foreground': 'The approved window is not in the foreground. Bring it to the front on the PC and try again.',
  'expired-arm-request': 'The request had already expired when it reached this PC. Check this PC\u2019s date and time.',
  'request-replayed': 'The relay saw this request before. Try again.',
  'request-rate-limit': 'Too many requests were sent to the relay recently. Wait a minute and try again.',
  'owner-state-rejected': 'This PC rejected the request. Check the Bot Door window for the reason.',
  'owner-state-failed': 'The relay did not accept the owner request.'
};

export function describeOwnerError(code) {
  const clean = String(code || 'owner-state-failed').slice(0, 80);
  const text = OWNER_ERRORS[clean];
  return text ? text + ' (' + clean + ')' : 'The relay reported: ' + clean;
}

export function describeRelayStatus(status = {}) {
  const key = status.authenticated ? 'authenticated' : status.connected ? 'authenticating' : (status.reason || 'connection-failed');
  const [label, text] = TEXT[key] || TEXT['connection-failed'];
  return { key, label, detail: text + (key === 'authenticated' ? '' : detailSuffix(status)) };
}

export function retryText(status = {}, now = Date.now()) {
  if (status.authenticated || !Number.isFinite(status.nextRetryAt)) return '';
  const seconds = Math.max(0, Math.ceil((status.nextRetryAt - now) / 1000));
  return (seconds ? 'Next attempt in ' + seconds + 's' : 'Reconnecting now') + (status.attempts > 1 ? ' (attempt ' + status.attempts + ')' : '') + '.';
}

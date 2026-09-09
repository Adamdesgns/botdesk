export const SETUP_STEPS = Object.freeze(['pair', 'window', 'phone']);

// Use only the persisted public configuration, never unsaved form values.
export function deriveReadiness(config = {}, status = {}) {
  const paired = Boolean(config.relayUrl && config.hostId && config.hostToken === 'saved' && config.ownerToken === 'saved');
  const connected = status.relay?.authenticated === true;
  const selected = Boolean(status.targetWindow?.handle && Number.isInteger(status.targetWindow?.processId) && status.targetWindow.processId > 0);
  const remoteEnabled = config.allowRemoteArm === true;
  const completed = { pair: paired && connected, window: selected, phone: paired && remoteEnabled };
  const count = Object.values(completed).filter(Boolean).length;
  const nextIncomplete = SETUP_STEPS.find((step) => !completed[step]) || 'phone';
  const connection = !paired ? 'Pairing needed' : connected ? 'PC connected' : status.relay?.connected ? 'Verifying connection' : 'Waiting for relay';
  let next;
  if (status.stopLatched) next = 'Unlock the local stop on this PC before starting access.';
  else if (!paired) next = 'Save your private pairing details to connect this PC.';
  else if (!connected) next = 'Wait for the relay connection, or check the saved connection settings.';
  else if (!selected) next = 'Choose the app window your bot should use.';
  else if (!remoteEnabled) next = 'Save phone access so you can start a session while away.';
  else next = 'Ready to go live or set a time window from your phone.';
  let goLiveHint;
  if (status.stopLatched) goLiveHint = 'Unlock the local stop here first.';
  else if (!selected) goLiveHint = 'Choose a window before you go live.';
  else if (!paired) goLiveHint = 'Save this PC’s pairing details first.';
  else if (!connected) goLiveHint = 'Connect the relay before going live.';
  else goLiveHint = remoteEnabled ? 'Starts an eight-hour session. Pause or stop at any time.' : 'Starts an eight-hour session and enables phone access.';
  return { paired, connected, selected, remoteEnabled, completed, count, nextIncomplete, connection, next, goLiveHint,
    ready: count === SETUP_STEPS.length && !status.stopLatched,
    labels: { pair: connection, window: selected ? 'Window selected' : 'Choose a window', phone: completed.phone ? 'Enabled and saved' : 'Phone access off' }
  };
}

export function formatSessionClock(expiresAt, now = Date.now()) {
  if (!Number.isFinite(expiresAt) || !Number.isFinite(now)) return '—';
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  return [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60].map((part) => String(part).padStart(2, '0')).join(':');
}

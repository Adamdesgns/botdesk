export const MODES = Object.freeze({
  OFF: 'off',
  ARMED: 'armed',
  PAUSED: 'paused',
  RUNNING: 'running'
});

export const COMMANDS = Object.freeze([
  'status',
  'capabilities',
  'screenshot',
  'snapshot',
  'list_windows',
  'list_monitors',
  'focus',
  'click',
  'move',
  'drag',
  'type',
  'key',
  'scroll',
  'clipboard_read',
  'clipboard_write',
  'record_start',
  'record_stop',
  'stop_all'
]);

/** Owner-visible product capabilities reported by status/capabilities. */
export const CAPABILITY_FLAGS = Object.freeze({
  selectedWindowControl: true,
  fullDesktopMode: false,
  accessibilitySnapshot: true,
  dragPaths: true,
  horizontalScroll: true,
  clipboard: true,
  fileOperations: false,
  terminalExecution: false,
  launchApplications: false,
  multiMonitorCapture: false,
  uacBypass: false
});

export function isCommand(value) {
  return COMMANDS.includes(String(value || ''));
}

export function clampArmMinutes(value) {
  const parsed = Number.parseInt(String(value ?? '480'), 10);
  if (!Number.isFinite(parsed)) return 480;
  return Math.min(720, Math.max(5, parsed));
}

export function sanitizeHostId(value) {
  const clean = String(value || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 64);
  return clean || null;
}

export function safeJsonParse(value) {
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

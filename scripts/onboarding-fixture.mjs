import { app, BrowserWindow, ipcMain } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
app.setPath('userData', process.env.BOTDESK_TEST_DATA);
app.on('window-all-closed', () => app.quit());

// Synthetic IPC state only. No native-window helper, relay, real clipboard,
// credential persistence, startup settings, or actual desktop capture is used.
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 980, height: 830, show: false, useContentSize: true, paintWhenInitiallyHidden: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true, preload: path.join(root, 'host/preload.cjs') } });
  const target = { handle: '1001', processId: 123, processName: 'msedge', title: 'Synthetic demo workspace', integrity: 'medium', desktop: 'default', passwordPresent: false, passwordFocused: false, automationChecked: true, geometry: { x: 0, y: 0, width: 1000, height: 600 } };
  const studioTarget = { ...target, handle: '1002', processId: 456, processName: 'RobloxStudioBeta', title: 'Synthetic Kingsmarch - Roblox Studio' };
  let config = { relayUrl: '', hostId: '', hostToken: '', ownerToken: '', botToken: '', allowRemoteArm: false, startAtLogin: false, allowedApps: ['msedge'] };
  let status = { mode: 'off', relay: { connected: false, authenticated: false }, hostId: null, targetWindow: null, expiresAt: null, stopLatched: false, recording: false, activeBot: null };
  let heldSave = null, holdNextSave = false;
  const counts = { copied: 0, stopped: 0, saved: 0, selected: 0, studioSaved: 0, modes: [], armMinutes: [] };
  const publicConfig = () => ({ ...config, ...Object.fromEntries(['hostToken', 'ownerToken', 'botToken'].map((key) => [key, config[key] ? 'saved' : ''])) });
  const currentStatus = () => ({ ...status, allowRemoteArm: config.allowRemoteArm });
  const emit = () => window.webContents.send('botdesk:status', currentStatus());
  const handle = (name, fn) => ipcMain.handle('botdesk:' + name, (event, ...args) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted fixture sender');
    return fn(...args);
  });
  handle('get-state', () => ({ status: currentStatus(), config: publicConfig(), version: '0.1.0-synthetic' }));
  handle('save-config', async (input) => {
    if (holdNextSave) { holdNextSave = false; await new Promise((resolve) => { heldSave = resolve; }); }
    config = { ...config, ...input, ...Object.fromEntries(['hostToken', 'ownerToken', 'botToken'].map((key) => {
      const incoming = typeof input[key] === 'string' ? input[key].trim() : '';
      return [key, incoming === 'saved' || incoming === '' ? config[key] : incoming];
    })) };
    counts.saved++;
    const paired = Boolean(config.relayUrl && config.hostId && config.hostToken && config.ownerToken);
    status = { ...status, hostId: config.hostId || null, relay: { connected: paired, authenticated: paired } };
    emit(); return { ok: true, config: publicConfig() };
  });
  const availableWindows = () => [target, studioTarget].filter((candidate) => config.allowedApps.includes(candidate.processName.toLowerCase()));
  handle('windows', () => ({ ok: true, windows: availableWindows() }));
  handle('set-studio-access', (enabled) => {
    if (typeof enabled !== 'boolean') return { ok: false, error: 'Invalid Studio access preference.' };
    config = { ...config, allowedApps: [...config.allowedApps.filter((name) => name !== 'robloxstudiobeta'), ...(enabled ? ['robloxstudiobeta'] : [])] };
    counts.studioSaved++;
    status = { ...status, mode: 'off', expiresAt: null, targetWindow: null, stopLatched: true };
    emit(); return { ok: true, status: currentStatus(), config: publicConfig() };
  });
  handle('select-window', (id) => {
    const selected = availableWindows().find((candidate) => candidate.handle === id);
    if (!selected) return { ok: false, error: 'Choose an enabled synthetic fixture window.' };
    counts.selected++; status = { ...status, mode: 'off', expiresAt: null, targetWindow: selected }; emit(); return { ok: true, status: currentStatus() };
  });
  handle('set-mode', ({ mode, minutes = 480 }) => {
    if (mode === 'armed' && !status.targetWindow) return { ok: false, error: 'Choose a window first.' };
    if (mode === 'armed' && status.stopLatched) return { ok: false, error: 'Unlock the local stop first.' };
    if (mode === 'armed') { config.allowRemoteArm = true; counts.armMinutes.push(minutes); }
    counts.modes.push(mode);
    status = { ...status, mode, expiresAt: mode === 'armed' ? Date.now() + minutes * 60_000 : null }; emit(); return { ok: true, status: currentStatus() };
  });
  handle('stop', () => { counts.stopped++; status = { ...status, mode: 'off', expiresAt: null, stopLatched: true }; emit(); return { ok: true, status: currentStatus() }; });
  handle('clear-stop', () => { status.stopLatched = false; emit(); return { ok: true }; });
  handle('copy-owner-link', () => { counts.copied++; return { ok: true }; });
  handle('captures', () => ({ ok: true }));
  handle('show', () => ({ ok: true }));
  handle('record-chunk', () => ({ ok: false, error: 'Recording is not used by this fixture.' }));
  handle('record-done', () => ({ ok: true }));
  globalThis.botdeskOnboardingFixture = {
    state: () => ({ status: currentStatus(), config: publicConfig(), counts: structuredClone(counts), pendingSave: Boolean(heldSave) }),
    pairingMatches: (expected) => ['relayUrl', 'hostId', 'hostToken', 'ownerToken', 'botToken'].every((key) => config[key] === expected[key]),
    emitStatus: (update = {}) => { status = { ...status, ...update }; emit(); },
    holdSave: () => { holdNextSave = true; },
    releaseSave: () => { const resolve = heldSave; heldSave = null; resolve?.(); }
  };
  await window.loadFile(path.join(root, 'host/ui/index.html'));
}).catch((error) => { console.error(error); app.exit(1); });

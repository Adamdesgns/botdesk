import { deriveReadiness, formatSessionClock, SETUP_STEPS } from './readiness.mjs';

const byId = (id) => document.getElementById(id);
const fields = ['relayUrl', 'hostId', 'hostToken', 'ownerToken', 'botToken'];
const feedback = { pair: 'pairFeedback', window: 'windowFeedback', phone: 'phoneFeedback', copy: 'copyPhoneFeedback' };
const pending = new Map();
let savedConfig = {};
let latestStatus = { mode: 'off', relay: {} };
let initialStepChosen = false;

function setText(id, text) {
  const element = byId(id);
  if (element && element.textContent !== text) element.textContent = text;
}
function notice(text, section, kind = 'info') {
  for (const id of ['saveResult', feedback[section]].filter(Boolean)) {
    setText(id, text);
    const element = byId(id);
    if (element) element.dataset.kind = kind;
  }
}
function checked(result) {
  if (result?.ok === false) throw new Error(result.error || 'Action failed');
  return result;
}

function showStep(step, { focusTab = false, focusPanel = false } = {}) {
  if (!SETUP_STEPS.includes(step)) return;
  const tabs = [...document.querySelectorAll('#setupTabs [data-step]')];
  const panels = [...document.querySelectorAll('[data-panel]')];
  for (const tab of tabs) {
    const active = tab.dataset.step === step;
    const panel = panels.find((item) => item.dataset.panel === tab.dataset.step);
    tab.id ||= 'setup-tab-' + tab.dataset.step;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    tab.dataset.active = String(active);
    tab.classList.toggle('active', active);
    if (panel) {
      panel.id ||= 'setup-panel-' + panel.dataset.panel;
      tab.setAttribute('aria-controls', panel.id);
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', tab.id);
      panel.tabIndex = -1;
      panel.hidden = !active;
      if (active && focusPanel) panel.focus({ preventScroll: true });
    }
    if (active && focusTab) tab.focus();
  }
}

const setupTabs = byId('setupTabs');
if (setupTabs) {
  setupTabs.setAttribute('role', 'tablist');
  setupTabs.setAttribute('aria-label', 'Prepare this PC');
  setupTabs.addEventListener('click', (event) => {
    const tab = event.target.closest('button[data-step]');
    if (tab && setupTabs.contains(tab)) showStep(tab.dataset.step);
  });
  setupTabs.addEventListener('keydown', (event) => {
    const tab = event.target.closest('button[data-step]');
    if (!tab) return;
    const index = SETUP_STEPS.indexOf(tab.dataset.step);
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % SETUP_STEPS.length;
    else if (event.key === 'ArrowLeft') next = (index + SETUP_STEPS.length - 1) % SETUP_STEPS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = SETUP_STEPS.length - 1;
    else return;
    event.preventDefault();
    showStep(SETUP_STEPS[next], { focusTab: true });
  });
}
byId('continueWindow')?.addEventListener('click', () => showStep('window', { focusPanel: true }));
byId('continuePhone')?.addEventListener('click', () => showStep('phone', { focusPanel: true }));

function setBusy(ids, busy, label) {
  for (const id of ids) {
    // The emergency stop never waits behind another operation.
    if (id === 'stopButton' || id === 'quickStopButton') continue;
    const element = byId(id);
    if (!element) continue;
    if (busy) {
      let state = pending.get(id);
      if (!state) {
        state = { count: 0, disabled: element.disabled, nodes: element.tagName === 'BUTTON' ? [...element.childNodes] : null };
        pending.set(id, state);
      }
      state.count++;
      element.disabled = true;
      element.setAttribute('aria-busy', 'true');
      if (label && element.tagName === 'BUTTON') element.textContent = label;
    } else {
      const state = pending.get(id);
      if (!state || --state.count > 0) continue;
      element.disabled = state.disabled;
      element.removeAttribute('aria-busy');
      if (state.nodes) element.replaceChildren(...state.nodes);
      pending.delete(id);
    }
  }
}
async function action(fn, { ids = [], label, section } = {}) {
  if (ids.some((id) => pending.has(id))) return null;
  setBusy(ids, true, label);
  try { return checked(await fn()); }
  catch (error) {
    notice(error instanceof Error ? error.message : 'The action could not finish. Try again.', section, 'error');
    return null;
  } finally { setBusy(ids, false); }
}

function readDraft() {
  return { ...Object.fromEntries(fields.map((id) => [id, byId(id).value.trim()])),
    allowRemoteArm: byId('remoteArm').checked,
    startAtLogin: byId('startAtLogin').checked,
    allowedApps: byId('allowedApps').value.split(',').map((value) => value.trim()).filter(Boolean)
  };
}
function draftChanged() {
  const draft = readDraft();
  return fields.some((id) => draft[id] !== (savedConfig[id] || '')) ||
    draft.allowRemoteArm !== Boolean(savedConfig.allowRemoteArm) ||
    draft.startAtLogin !== Boolean(savedConfig.startAtLogin) ||
    JSON.stringify(draft.allowedApps) !== JSON.stringify(savedConfig.allowedApps || []);
}
function renderReadiness() {
  const readiness = deriveReadiness(savedConfig, latestStatus);
  setText('setupProgress', `${readiness.count} of 3 steps prepared`);
  setText('readinessCount', `${readiness.count} / 3`);
  setText('nextStep', readiness.next);
  setText('connectionSummary', readiness.connection);
  setText('goLiveHint', readiness.goLiveHint);
  for (const step of SETUP_STEPS) {
    setText(step + 'StepState', readiness.labels[step]);
    const label = byId(step + 'StepState');
    if (label) label.dataset.complete = String(readiness.completed[step]);
    const tab = document.querySelector('#setupTabs [data-step="' + step + '"]');
    if (tab) tab.dataset.complete = String(readiness.completed[step]);
  }
  const progress = byId('setupProgress');
  if (progress) progress.dataset.ready = String(readiness.ready);
  return readiness;
}
function updateClock() {
  const live = ['armed', 'running'].includes(latestStatus.mode);
  setText('sessionClock', live ? formatSessionClock(latestStatus.expiresAt) : '—');
}
function render(status) {
  latestStatus = status || { mode: 'off', relay: {} };
  const mode = latestStatus.mode || 'off';
  byId('modeBadge').className = 'mode ' + mode;
  setText('modeBadge', mode.toUpperCase());
  const titles = { off: 'Bot access is off', armed: 'Waiting for an approved bot', running: 'A bot is controlling this window', paused: 'Bot access is paused' };
  setText('statusTitle', titles[mode] || mode);
  setText('statusDetail', latestStatus.stopLatched ? 'Local stop is locked. Unlock it here before remote arming.' : latestStatus.expiresAt ? 'Access expires ' + new Date(latestStatus.expiresAt).toLocaleTimeString() + '.' : 'Bot commands are rejected until you arm a session.');
  setText('relayState', latestStatus.relay?.authenticated ? 'Securely connected' : latestStatus.relay?.connected ? 'Authenticating' : 'Offline');
  setText('hostState', latestStatus.hostId || 'Not configured');
  setText('recordingState', latestStatus.recording ? 'Recording selected window' : 'Stopped');
  byId('unlockButton').hidden = !latestStatus.stopLatched;
  const target = latestStatus.targetWindow;
  setText('selectedWindowName', target ? target.title + ' · ' + target.processName : 'No window selected');
  setText('targetDetail', target ? 'Selected: ' + target.title + ' (' + target.processName + '). BotDesk checks this window before every action.' : 'Choose an app window before arming. Only that window is captured and controlled.');
  setText('botActivity', mode === 'running' ? 'An approved bot is acting in the selected window.' : mode === 'armed' ? 'Waiting for an approved bot to request an action.' : 'Bot commands are not enabled.');
  renderReadiness();
  updateClock();
}
async function load({ fillForm = true } = {}) {
  const state = checked(await window.botdesk.getState());
  if (!state?.config || !state?.status) throw new Error('Could not read this PC’s current setup.');
  savedConfig = { ...state.config };
  if (fillForm) {
    for (const id of fields) byId(id).value = savedConfig[id] || '';
    byId('allowedApps').value = (savedConfig.allowedApps || []).join(', ');
    byId('remoteArm').checked = savedConfig.allowRemoteArm === true;
    byId('startAtLogin').checked = savedConfig.startAtLogin === true;
  }
  render(state.status);
  if (!initialStepChosen) {
    showStep(deriveReadiness(savedConfig, latestStatus).nextIncomplete);
    initialStepChosen = true;
  }
  return state;
}
async function refreshState(options) {
  try { await load(options); }
  catch (error) { notice(error.message || 'Could not refresh this PC’s status.', undefined, 'error'); }
}

byId('armButton').onclick = async () => {
  const preserveDraft = draftChanged();
  const result = await action(() => window.botdesk.setMode('armed', 480), { ids: ['armButton'], label: 'STARTING…' });
  if (result) await refreshState({ fillForm: !preserveDraft });
};
byId('pauseButton').onclick = async () => {
  if (await action(() => window.botdesk.setMode('paused'), { ids: ['pauseButton'], label: 'PAUSING…' })) await refreshState({ fillForm: false });
};
async function emergencyStop() {
  if (await action(() => window.botdesk.emergencyStop())) {
    notice('Bot access stopped. Unlock the local stop here before starting again.', undefined, 'success');
    await refreshState({ fillForm: false });
  }
}
byId('stopButton').onclick = emergencyStop;
byId('quickStopButton')?.addEventListener('click', emergencyStop);
byId('unlockButton').onclick = async () => {
  if (await action(() => window.botdesk.clearStop(), { ids: ['unlockButton'], label: 'UNLOCKING…' })) {
    notice('Local stop unlocked. Access remains off until you go live.', undefined, 'success');
    await refreshState({ fillForm: false });
  }
};
byId('copyOwnerLink').onclick = async () => {
  if (await action(() => window.botdesk.copyOwnerLink(), { ids: ['copyOwnerLink'], label: 'COPYING…', section: 'copy' })) notice('Private phone link copied. Keep it for your own phone.', 'copy', 'success');
};
byId('openCaptures').onclick = () => action(() => window.botdesk.openCaptures(), { ids: ['openCaptures'], label: 'OPENING…' });
byId('refreshWindows').onclick = async () => {
  const result = await action(() => window.botdesk.listWindows(), { ids: ['refreshWindows', 'targetWindow'], label: 'CHECKING WINDOWS…', section: 'window' });
  if (!result) return;
  const windows = Array.isArray(result.windows) ? result.windows : [];
  const select = byId('targetWindow');
  select.replaceChildren(new Option('Choose an app window', ''));
  for (const window of windows) select.add(new Option(window.processName + ' — ' + window.title, window.handle));
  const selected = windows.find((window) => window.handle === latestStatus.targetWindow?.handle);
  if (selected) select.value = selected.handle;
  if (!windows.length) notice('No verified app windows available. Open an ordinary browser page or Notepad, then refresh.', 'window');
  else notice(`${windows.length} verified app window${windows.length === 1 ? '' : 's'} available. Choose the one your bot should use.`, 'window');
};
byId('targetWindow').onchange = async () => {
  if (!byId('targetWindow').value) return;
  if (await action(() => window.botdesk.selectWindow(byId('targetWindow').value), { ids: ['targetWindow', 'refreshWindows'], section: 'window' })) {
    notice('Window selected. Access stays off until you go live.', 'window', 'success');
    await refreshState({ fillForm: false });
  }
};
byId('importPairing').onclick = () => {
  try {
    const parsed = JSON.parse(byId('pairingJson').value);
    const config = parsed?.config || parsed?.hostConfig || parsed;
    if (!config || typeof config !== 'object' || Array.isArray(config) || !['relayUrl', 'hostId', 'hostToken', 'ownerToken'].every((id) => typeof config[id] === 'string' && config[id].trim())) throw new Error('Invalid pairing');
    for (const id of fields) byId(id).value = typeof config[id] === 'string' ? config[id] : '';
    byId('pairingJson').value = '';
    notice('Pairing details read. Save & connect to store them on this PC.', 'pair');
  } catch { notice('Paste the host pairing JSON from your private provisioning file. Nothing has been saved.', 'pair', 'error'); }
};

const configControls = [...fields, 'allowedApps', 'remoteArm', 'startAtLogin', 'pairingJson', 'importPairing', 'saveButton', 'savePhoneButton'];
async function saveSettings(section) {
  if (configControls.some((id) => pending.has(id))) return;
  const config = readDraft();
  notice('Saving settings on this PC…', section);
  await action(async () => {
    const result = checked(await window.botdesk.saveConfig(config));
    await load();
    notice(section === 'phone'
      ? savedConfig.allowRemoteArm ? 'Phone access enabled and saved. Copy your private phone link when you’re ready.' : 'Phone access is off. The preference is saved on this PC.'
      : 'Pairing settings saved with Windows encryption. Connection status is shown above.', section, 'success');
    return result;
  }, { ids: configControls, section });
}
byId('saveButton').onclick = () => saveSettings('pair');
byId('savePhoneButton')?.addEventListener('click', () => saveSettings('phone'));
for (const id of ['remoteArm', 'startAtLogin']) {
  byId(id).addEventListener('change', () => {
    const changed = byId('remoteArm').checked !== Boolean(savedConfig.allowRemoteArm) || byId('startAtLogin').checked !== Boolean(savedConfig.startAtLogin);
    if (changed) notice('Changes are not saved. Phone access remains ' + (savedConfig.allowRemoteArm ? 'enabled' : 'off') + ' until you save these preferences.', 'phone');
    else setText('phoneFeedback', 'These preferences match the saved settings.');
    renderReadiness();
  });
}
for (const id of [...fields, 'allowedApps']) byId(id).addEventListener('change', () => {
  if (draftChanged()) notice('Connection changes are not saved yet.', 'pair');
});
const clock = byId('sessionClock');
if (clock) clock.setAttribute('aria-live', 'off');
setInterval(updateClock, 1000);
window.botdesk.onStatus(render);

// Existing guarded frame-to-WebM recorder behavior is unchanged.
let recording=null;
window.botdesk.onRecord('record-start',({id})=>{recording={id,canvas:document.createElement('canvas'),recorder:null,writes:Promise.resolve(),stopping:false};});
window.botdesk.onRecord('record-frame',async({id,image})=>{
  const r=recording;if(!r||r.id!==id||r.stopping)return;
  const img=new Image();img.src='data:'+image.mimeType+';base64,'+image.data;
  await img.decode();if(recording!==r||r.stopping)return;
  if(!r.recorder){
    r.canvas.width=image.width;r.canvas.height=image.height;
    r.canvas.getContext('2d').drawImage(img,0,0);
    r.stream=r.canvas.captureStream(2);
    const mimeType=MediaRecorder.isTypeSupported('video/webm;codecs=vp9')?'video/webm;codecs=vp9':'video/webm';
    r.recorder=new MediaRecorder(r.stream,{mimeType,videoBitsPerSecond:1500000});
    r.recorder.ondataavailable=e=>{if(e.data.size)r.writes=r.writes.then(async()=>checked(await window.botdesk.recordingChunk({id,bytes:new Uint8Array(await e.data.arrayBuffer())})));};
    r.recorder.onstop=async()=>{try{await r.writes;}finally{r.stream.getTracks().forEach(t=>t.stop());await window.botdesk.recordingDone(id);if(recording===r)recording=null;}};
    r.recorder.start(1000);
  }else r.canvas.getContext('2d').drawImage(img,0,0,r.canvas.width,r.canvas.height);
});
window.botdesk.onRecord('record-stop',async({id})=>{
  const r=recording;if(!r||r.id!==id)return window.botdesk.recordingDone(id);
  r.stopping=true;if(r.recorder&&r.recorder.state==='recording')r.recorder.stop();
  else {await window.botdesk.recordingDone(id);if(recording===r)recording=null;}
});
load().then(() => { document.documentElement.dataset.botdeskUiLoaded = 'true'; }).catch((error) => notice(error.message || 'Could not load this PC’s setup.', undefined, 'error'));

import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyWindow, validateCommand, DEFAULT_APP_ALLOWLIST, isAllowedWindow } from '../host/guard.mjs';
const window = Object.freeze({handle:'100',processId:23,processName:'msedge',title:'Example document',integrity:'medium',desktop:'default',automationChecked:true,passwordFocused:false,passwordPresent:false,geometry:{x:-100,y:20,width:1000,height:600}});
const context = () => ({mode:'armed',now:1000,expiresAt:2000,targetWindow:window,foreground:window});

test('blocks credential, financial, system and elevated windows', () => {
  for (const [change,category] of [[{title:'Sign in to account'},'credential'],[{title:'Stripe Dashboard'},'financial'],[{title:'Windows Security'},'system'],[{title:'Developer Tools'},'system'],[{integrity:'high'},'elevated'],[{integrity:'medium-plus'},'elevated']]) {
    assert.equal(classifyWindow({...window,...change}).category,category);
  }
});
test('unknown desktop integrity or UIA evidence fails closed', () => {
  assert.equal(classifyWindow(window).allowed,true);
  for (const change of [{integrity:'unknown'},{integrity:undefined},{desktop:'secure'},{desktop:undefined},{automationChecked:false},{automationChecked:undefined},{passwordFocused:true},{passwordPresent:true},{passwordPresent:undefined},{handle:null},{processId:0},{title:''}]) {
    assert.equal(classifyWindow({...window,...change}).allowed,false,JSON.stringify(change));
  }
});
test('requires arm, expiry and an explicitly approved foreground HWND plus process', () => {
  assert.equal(validateCommand('click',{x:1,y:2},context()).allowed,true);
  for (const update of [{mode:'off'},{expiresAt:1000},{expiresAt:undefined},{targetWindow:null},{foreground:{...window,handle:'101'}},{foreground:{...window,processId:24}},{allowedApps:['firefox']}]) {
    assert.equal(validateCommand('click',{x:1,y:2},{...context(),...update}).allowed,false);
  }
  assert.equal(validateCommand('status',{},{}).allowed,true);
  assert.equal(validateCommand('stop_all',{},{}).allowed,true);
});
test('only screenshot-relative integer coordinates inside target are permitted', () => {
  for (const coordinates of [{x:-1,y:0},{x:1000,y:0},{x:0,y:600},{x:1.5,y:1},{x:NaN,y:1}]) {
    assert.equal(validateCommand('click',coordinates,context()).category,'bad-arguments');
  }
  assert.equal(validateCommand('click',{x:999,y:599},context()).allowed,true);
});
test('rejects dangerous system shortcuts; blocks control characters and executable URI text', () => {
  for (const key of ['CTRL+ALT+DELETE','WIN+R','F12','CTRL+SHIFT+I','ALT+F4']) assert.equal(validateCommand('key',{key},context()).category,'key-blocked');
  for (const key of ['CTRL+C','CTRL+V','CTRL+X','CTRL+S','E','W','A','S','D','SPACE','TAB']) assert.equal(validateCommand('key',{key},context()).allowed,true);
  for (const text of ['', 'x'.repeat(4001),'first\nsecond','one\ttwo','javascript:alert(1)','file:///C:/secret','ms-settings:privacy']) assert.equal(validateCommand('type',{text},context()).category,'bad-arguments');
  assert.equal(validateCommand('type',{text:'Hello, world — 123'},context()).allowed,true);
});
test('focus may restore the approved target when another window is foreground', () => {
  const other = { ...window, handle: '200', processId: 99, processName: 'chrome', title: 'Unrelated tab' };
  assert.equal(validateCommand('focus', {}, { ...context(), foreground: other }).allowed, true);
  assert.equal(validateCommand('focus', {}, { ...context(), mode: 'off', foreground: other }).category, 'not-armed');
  assert.equal(validateCommand('focus', {}, { ...context(), targetWindow: null, foreground: other }).category, 'target-required');
  assert.equal(validateCommand('focus', {}, { ...context(), targetWindow: { ...window, title: 'Sign in to account' }, foreground: other }).category, 'credential');
  assert.equal(validateCommand('focus', {}, { ...context(), targetWindow: { ...window, processName: 'firefox' }, foreground: other, allowedApps: ['msedge'] }).category, 'app-blocked');
  assert.equal(validateCommand('click', { x: 1, y: 2 }, { ...context(), foreground: other }).category, 'target-changed');
});

test('configured allowlist cannot permit shell or code editor processes', () => {
  for (const processName of ['powershell','pwsh','cmd','code','explorer','regedit']) {
    const candidate={...window,processName};
    assert.equal(validateCommand('type',{text:'hello'},{...context(),foreground:candidate,allowedApps:[processName]}).allowed,false);
    assert.equal(DEFAULT_APP_ALLOWLIST.includes(processName),false);
  }
});

test('focus may restore the approved target when another window is foreground', () => {
  const other = { ...window, handle: '200', processId: 99, processName: 'chrome', title: 'Unrelated tab' };
  assert.equal(validateCommand('focus', {}, { ...context(), foreground: other }).allowed, true);
  assert.equal(validateCommand('focus', {}, { ...context(), mode: 'off', foreground: other }).category, 'not-armed');
  assert.equal(validateCommand('focus', {}, { ...context(), targetWindow: null, foreground: other }).category, 'target-required');
  assert.equal(validateCommand('focus', {}, { ...context(), targetWindow: { ...window, title: 'Sign in to account' }, foreground: other }).category, 'credential');
  assert.equal(validateCommand('focus', {}, { ...context(), targetWindow: { ...window, processName: 'firefox' }, foreground: other, allowedApps: ['msedge'] }).category, 'app-blocked');
  assert.equal(validateCommand('click', { x: 1, y: 2 }, { ...context(), foreground: other }).category, 'target-changed');
});

test('list_monitors is armed-only and does not require the approved window to stay foreground', () => {
  const other = { ...window, handle: '200', processId: 99, processName: 'chrome', title: 'Unrelated tab' };
  assert.equal(validateCommand('list_monitors', {}, context()).allowed, true);
  assert.equal(validateCommand('list_monitors', {}, { ...context(), foreground: other }).allowed, true);
  assert.equal(validateCommand('list_monitors', {}, { ...context(), mode: 'off' }).category, 'not-armed');
  assert.equal(validateCommand('list_monitors', {}, { ...context(), expiresAt: 1000 }).category, 'expired');
});

test('clipboard write is bounded plain text; dangerous keys stay blocked while E/WASD and CTRL+C/V/S are allowed', () => {
  assert.equal(validateCommand('clipboard_write', { text: 'hello' }, context()).allowed, true);
  assert.equal(validateCommand('clipboard_write', { text: '' }, context()).category, 'bad-arguments');
  assert.equal(validateCommand('clipboard_write', { text: 'x'.repeat(4001) }, context()).category, 'bad-arguments');
  assert.equal(validateCommand('clipboard_write', { text: 'line\u0000break' }, context()).category, 'bad-arguments');
  for (const key of ['CTRL+C', 'CTRL+V', 'CTRL+X', 'CTRL+S', 'E', 'W', 'A', 'S', 'D', 'SPACE']) {
    assert.equal(validateCommand('key', { key }, context()).allowed, true);
  }
});

test('Studio is eligible only after opt-in, without weakening sensitive-window checks', () => {
  const studio = { ...window, processName: 'RobloxStudioBeta', title: 'WorldGame-dev - Roblox Studio' };
  assert.equal(isAllowedWindow(studio), false);
  assert.equal(isAllowedWindow(studio, ['robloxstudiobeta']), true);
  assert.equal(validateCommand('screenshot', {}, { ...context(), foreground: studio, allowedApps: ['robloxstudiobeta'] }).allowed, true);
  for (const patch of [{ title: 'Sign in - Roblox Studio' }, { passwordPresent: true }, { integrity: 'high' }, { processName: 'unknown' }, { processName: 'code' }]) {
    const candidate = { ...studio, ...patch };
    assert.equal(isAllowedWindow(candidate, ['robloxstudiobeta', 'unknown', 'code']), false);
    assert.equal(validateCommand('screenshot', {}, { ...context(), foreground: candidate, allowedApps: ['robloxstudiobeta', 'unknown', 'code'] }).allowed, false);
  }
});

test('drag independently validates every point, exact shape and bounded duration', () => {
  const args = { snapshotId: 'snapshot-1', points: [{ x: 2, y: 3 }, { x: 999, y: 599 }], durationMs: 500 };
  assert.equal(validateCommand('drag', args, context()).allowed, true);
  const bad = [
    { durationMs: 99 }, { durationMs: 2001 }, { durationMs: 100.5 }, { button: 'right' }, { snapshotId: '' },
    { points: [{ x: 0, y: 0 }] }, { points: [{ x: 0, y: 0 }, { x: 0, y: 0 }] },
    { points: [{ x: 0, y: 0 }, { x: 1, y: 600 }] }, { points: [{ x: -1, y: 0 }, { x: 1, y: 1 }] },
    { points: [{ x: 0.5, y: 0 }, { x: 1, y: 1 }] }, { points: [{ x: 0, y: 0, extra: true }, { x: 1, y: 1 }] },
    { points: Array.from({ length: 65 }, (_, x) => ({ x, y: 0 })) }
  ];
  for (const patch of bad) assert.equal(validateCommand('drag', { ...args, ...patch }, context()).category, 'bad-arguments', JSON.stringify(patch));
});

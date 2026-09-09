import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyWindow, validateCommand, DEFAULT_APP_ALLOWLIST } from '../host/guard.mjs';
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
test('rejects clipboard, shell and devtools shortcuts; blocks control characters and executable URI text', () => {
  for (const key of ['CTRL+ALT+DELETE','WIN+R','CTRL+V','CTRL+C','CTRL+X','F12','CTRL+SHIFT+I','ALT+F4']) assert.equal(validateCommand('key',{key},context()).category,'key-blocked');
  assert.equal(validateCommand('key',{key:'TAB'},context()).allowed,true);
  for (const text of ['', 'x'.repeat(4001),'first\nsecond','one\ttwo','javascript:alert(1)','file:///C:/secret','ms-settings:privacy']) assert.equal(validateCommand('type',{text},context()).category,'bad-arguments');
  assert.equal(validateCommand('type',{text:'Hello, world — 123'},context()).allowed,true);
});
test('configured allowlist cannot permit shell or code editor processes', () => {
  for (const processName of ['powershell','pwsh','cmd','code','explorer','regedit']) {
    const candidate={...window,processName};
    assert.equal(validateCommand('type',{text:'hello'},{...context(),foreground:candidate,allowedApps:[processName]}).allowed,false);
    assert.equal(DEFAULT_APP_ALLOWLIST.includes(processName),false);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../relay/src/dashboard.ts',import.meta.url),'utf8');
function render(state){
  const nodes=new Map();
  const context=vm.createContext({Date,Intl,state,document:{querySelector(selector){if(!nodes.has(selector))nodes.set(selector,{textContent:'',value:'',disabled:false});return nodes.get(selector);}},clearScreen(){}});
  vm.runInContext('let current=null,syncedSchedule=false;const hasToken=true,controlBusy=false,previewBusy=false,scheduleBusy=false;'+source.match(/^function (?:alertMessage|localDateValue|countdown|render)\(.*$/gm).join('\n')+';render(state);',context);
  return nodes;
}
test('online failed activation is BLOCKED and never claims waiting for a connection',()=>{
  const nodes=render({mode:'off',hostOnline:true,schedulePending:true,scheduleError:'focus-refused',schedule:{startsAt:Date.now()-1000,endsAt:Date.now()+60000}});
  assert.equal(nodes.get('#mode').textContent,'BLOCKED');
  assert.equal(nodes.get('#detail').textContent,'PC ONLINE');
  assert.equal(nodes.get('#countdown').textContent,'Activation failed. Access is OFF.');
  assert.match(nodes.get('#alert').textContent,/Windows would not bring/);
  assert.equal(nodes.get('#preview').disabled,true);
});
test('pending connection, pending activation, future schedule and live remain distinct',()=>{
  const base={mode:'off',schedulePending:true,schedule:{startsAt:Date.now()-1000,endsAt:Date.now()+60000}};
  assert.equal(render({...base,hostOnline:false}).get('#countdown').textContent,'Waiting for the PC to connect');
  assert.equal(render({...base,hostOnline:true}).get('#countdown').textContent,'Waiting for the PC to activate the selected window');
  assert.match(render({...base,schedule:{startsAt:Date.now()+60000,endsAt:Date.now()+120000}}).get('#countdown').textContent,/^Starts in /);
  const live=render({mode:'armed',hostOnline:true,liveEndsAt:Date.now()+60000});
  assert.equal(live.get('#mode').textContent,'LIVE');assert.match(live.get('#countdown').textContent,/^Live for /);
});

function dashboardFn(name){
  const line=source.match(new RegExp('^function '+name+'\\(.*$','m'));
  assert.ok(line, name+' must be a line-start dashboard helper');
  return line[0];
}
function credentialView(state){
  const context=vm.createContext({});
  return vm.runInContext(dashboardFn('maskBotCredential')+';'+dashboardFn('botCredentialView')+';botCredentialView('+JSON.stringify(state)+')',context);
}

test('phone bot-token UI is present and masked by default',()=>{
  assert.match(source,/<input id="bot-token-display" type="password"/);
  assert.match(source,/<button id="show-bot-token"[^>]*disabled>SHOW<\/button>/);
  assert.match(source,/<button id="copy-bot-token"[^>]*disabled>COPY<\/button>/);
  assert.match(source,/\/api\/owner\/'\+host\+'\/bot-credential/);
  assert.doesNotMatch(source,/botTokenCache=location/);
  const locked=credentialView({hasToken:false,revealed:false,token:'',error:''});
  assert.equal(locked.inputType,'password');
  assert.equal(locked.display,'');
  assert.equal(locked.disabled,true);
  assert.equal(locked.showLabel,'SHOW');
  const masked=credentialView({hasToken:true,revealed:false,token:'existing-bot-token-value-should-stay-hidden',error:''});
  assert.equal(masked.inputType,'password');
  assert.equal(masked.display,'');
  assert.equal(masked.disabled,false);
  assert.equal(masked.showLabel,'SHOW');
  assert.equal(masked.display.includes('existing-bot-token-value-should-stay-hidden'),false);
});

test('phone Show reveals only after owner auth; Hide remasks',()=>{
  const token='owner-visible-bot-token-value-for-phone-ui-tests';
  const locked=credentialView({hasToken:false,revealed:true,token,error:''});
  assert.equal(locked.disabled,true);
  assert.equal(locked.display,'');
  assert.equal(locked.inputType,'password');
  const shown=credentialView({hasToken:true,revealed:true,token,error:''});
  assert.equal(shown.disabled,false);
  assert.equal(shown.display,token);
  assert.equal(shown.inputType,'text');
  assert.equal(shown.showLabel,'HIDE');
  const hidden=credentialView({hasToken:true,revealed:false,token,error:''});
  assert.equal(hidden.display,'');
  assert.equal(hidden.inputType,'password');
  assert.equal(hidden.showLabel,'SHOW');
});

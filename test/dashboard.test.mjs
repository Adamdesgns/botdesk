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
  const header='function '+name+'(';
  const start=source.indexOf(header);
  assert.ok(start>=0&&(start===0||source[start-1]==='\n'),name+' must be a line-start dashboard helper');
  let parens=0,index=start+header.length-1;
  for(;index<source.length;index++){
    if(source[index]==='(')parens++;
    else if(source[index]===')'){parens--;if(parens===0)break;}
  }
  let depth=0;
  for(index=source.indexOf('{',index);index<source.length;index++){
    if(source[index]==='{')depth++;
    else if(source[index]==='}'){depth--;if(depth===0)return source.slice(start,index+1);}
  }
  assert.fail('unclosed '+name);
}
function credentialView(state){
  const context=vm.createContext({});
  return vm.runInContext(dashboardFn('maskBotCredential')+';'+dashboardFn('botCredentialView')+';botCredentialView('+JSON.stringify(state)+')',context);
}
const SYNTHETIC='synthetic-dashboard-token-value-for-tests-01';
function deferred(){
  let resolve,reject;
  const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});
  return {promise,resolve,reject};
}
function credentialSession({hasToken=true,request,clipboard,message}={}){
  const fetches=[];
  const copied=[];
  const pending=[];
  const context=vm.createContext({AbortController,Promise,Error,Object,String,Boolean});
  vm.runInContext(dashboardFn('botCredentialView')+';'+dashboardFn('createBotCredentialSession'),context);
  const session=vm.runInContext('createBotCredentialSession',context)({
    hasToken,
    request:request||(()=>{fetches.push(1);const next=deferred();pending.push(next);return next.promise;}),
    clipboard:clipboard||(async(value)=>{copied.push(value);}),
    message:message||((code)=>code)
  });
  return {session,fetches,copied,pending};
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

test('Hide clears the cached bot token so the next Show retrieves again',async()=>{
  const {session,fetches,pending}=credentialSession();
  const showing=session.show();
  pending[0].resolve({token:SYNTHETIC});
  assert.equal((await showing).action,'show');
  assert.equal(session.state().cache,SYNTHETIC);
  assert.equal(fetches.length,1);
  const hidden=session.hide();
  assert.equal(hidden.action,'hide');
  assert.equal(session.state().cache,null);
  assert.equal(session.state().revealed,false);
  assert.equal(hidden.view.display,'');
  const again=session.show();
  assert.equal(fetches.length,2);
  pending[1].resolve({token:SYNTHETIC});
  assert.equal((await again).fromCache,false);
  assert.equal((await again).action,'show');
});

test('stale Show after Hide does not reveal or repopulate the cache',async()=>{
  const {session,pending}=credentialSession();
  const showing=session.show();
  session.hide();
  pending[0].resolve({token:SYNTHETIC});
  const result=await showing;
  assert.equal(result.action,'stale');
  assert.equal(result.view.display,'');
  assert.equal(session.state().cache,null);
  assert.equal(session.state().revealed,false);
});

test('a second Show during an in-flight retrieve cancels like Hide',async()=>{
  const {session,pending}=credentialSession();
  const first=session.show();
  const second=session.show();
  assert.equal((await second).action,'hide');
  pending[0].resolve({token:SYNTHETIC});
  assert.equal((await first).action,'stale');
  assert.equal(session.state().cache,null);
  assert.equal(session.state().revealed,false);
});

test('rapid Show/Hide sequences drop every in-flight retrieve',async()=>{
  const {session,pending}=credentialSession();
  const first=session.show();
  session.hide();
  const second=session.show();
  session.hide();
  pending[0].resolve({token:SYNTHETIC});
  pending[1].resolve({token:SYNTHETIC});
  assert.equal((await first).action,'stale');
  assert.equal((await second).action,'stale');
  assert.equal(session.state().cache,null);
  assert.equal(session.state().revealed,false);
  assert.equal(session.snapshot().display,'');
});

test('stale Copy after Hide does not write the clipboard or keep the token',async()=>{
  const {session,pending,copied}=credentialSession();
  const copying=session.copy();
  session.hide();
  pending[0].resolve({token:SYNTHETIC});
  const result=await copying;
  assert.equal(result.action,'stale');
  assert.deepEqual(copied,[]);
  assert.equal(session.state().cache,null);
});

test('Copy after a refused first write asks for a second tap and does not refetch',async()=>{
  const fetches=[];
  const copied=[];
  let refuse=true;
  const {session,pending}=credentialSession({
    request(){fetches.push(1);const next=deferred();pending.push(next);return next.promise;},
    async clipboard(value){
      if(refuse){refuse=false;const error=new Error('NotAllowedError');error.name='NotAllowedError';throw error;}
      copied.push(value);
    }
  });
  const first=session.copy();
  pending[0].resolve({token:SYNTHETIC});
  const refused=await first;
  assert.equal(refused.action,'copy-gesture-required');
  assert.equal(refused.copied,false);
  assert.equal(session.state().cache,SYNTHETIC);
  assert.equal(fetches.length,1);
  const second=await session.copy();
  assert.equal(second.action,'copied');
  assert.deepEqual(copied,[SYNTHETIC]);
  assert.equal(fetches.length,1);
});

test('dashboard Hide, pagehide, and visibility loss invalidate the retrieve session',()=>{
  assert.match(source,/pagehide/);
  assert.match(source,/visibilitychange/);
  assert.match(source,/createBotCredentialSession/);
  assert.match(source,/botCredential\.hide\(\)/);
});

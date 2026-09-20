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

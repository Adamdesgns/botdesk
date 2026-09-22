import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { HostController } from '../host/controller.mjs';

const window = (overrides = {}) => ({ handle:'1001',processId:123,processStartedAt:'111',processName:'msedge',title:'Extensions',
  geometry:{x:0,y:0,width:900,height:700},integrity:'medium',desktop:'default',automationChecked:true,passwordFocused:false,passwordPresent:false,...overrides });
function setup(t) {
  let now=1000, windows=[window(),window({handle:'2002',processId:456,processStartedAt:'222',title:'Select the extension directory.'})], foreground=windows[0];
  const calls=[];
  const executor={inspect:async w=>{const current=windows.find(x=>x.handle===w.handle);return current?{ok:true,window:structuredClone(current)}:{ok:false,error:'target-changed'};},
    listWindows:async()=>({ok:true,windows:structuredClone(windows)}),foreground:async()=>foreground,
    focus:async w=>{calls.push('focus');foreground=windows.find(x=>x.handle===w.handle);return {ok:true};},
    run:async name=>{calls.push(name);return {ok:true,window:foreground};},recordStop:async()=>({ok:true})};
  const settings={allowRemoteArm:true,allowedApps:['msedge']};
  const host=new HostController({executor,configStore:{load:()=>settings},auditLog:{write:()=>{}},clock:()=>now});
  t.after(()=>host.setMode('off'));
  host.selectTarget(windows[0]);
  const cmd=(name,args={})=>host.runCommand({name,args,commandId:randomUUID(),botId:'bot',controlGeneration:1,expiresAt:now+20000});
  const list=async()=>{const result=await host.ownerTarget({action:'list'});assert.equal(result.ok,true,JSON.stringify(result));return result.result.windows;};
  return {host,executor,settings,calls,cmd,list,windows,advance:ms=>{now+=ms;},arm:()=>host.setMode('armed',{generation:1})};
}

test('separate-PID dialog needs explicit owner approval, remains OFF and requires a new snapshot',async t=>{
  const s=setup(t);s.arm();const old=(await s.cmd('screenshot')).result.snapshotId;
  assert.equal((await s.host.ownerTarget({action:'list'})).error,'stop-before-selecting');
  s.host.setMode('off');const choices=await s.list();
  assert.equal(choices.length,2);assert.equal('image' in choices[1],false);
  assert.equal((await s.cmd('owner_select_target',{candidateId:choices[1].candidateId})).ok,false);
  const approved=await s.host.ownerTarget({action:'approve',candidateId:choices[1].candidateId,temporary:true});
  assert.equal(approved.ok,true);assert.equal(s.host.mode,'off');assert.equal(s.host.targetWindow.processId,456);
  assert.equal((await s.cmd('screenshot')).ok,false);assert.equal(s.calls.filter(x=>x==='focus').length,0);
  s.arm();assert.equal(s.host.expiresAt,301000);
  assert.equal((await s.cmd('screenshot')).ok,true);
  assert.equal((await s.cmd('type',{text:'fixture',snapshotId:old})).error,'fresh-snapshot-required');
  const snapshot=(await s.cmd('screenshot')).result.snapshotId;
  assert.equal((await s.cmd('type',{text:'fixture',snapshotId:snapshot})).ok,true);
  s.advance(300001);assert.equal(s.host.getStatus().mode,'off');assert.equal(s.host.targetWindow,null);
  assert.equal((await s.cmd('screenshot')).ok,false);
});

test('stale identity, unsafe contents and inaccessible native inspection revoke access before focus or pixels',async t=>{
  for(const change of [{handle:'999'}, {processId:999}, {processStartedAt:'reused'}, {processName:'chrome'}, {title:'Sign in'}, {passwordPresent:true}, {desktop:'unknown'}, {integrity:'high'}]){
    const s=setup(t);s.arm();Object.assign(s.windows[0],change);
    const result=await s.cmd('screenshot');assert.equal(result.error,'target-reselect-required',JSON.stringify(change));
    assert.equal(s.host.mode,'off');assert.equal(s.host.getStatus().targetHealth.state,'reselect-required');assert.deepEqual(s.calls,[]);
  }
  const s=setup(t);s.arm();s.executor.inspect=async()=>{throw new Error('native failure');};
  assert.equal((await s.host.revalidateTarget()).error,'target-reselect-required');assert.equal(s.host.targetWindow,null);
});

test('normal title and geometry changes retain identity but expire old screenshot input',async t=>{
  const s=setup(t);s.arm();const snapshotId=(await s.cmd('screenshot')).result.snapshotId;
  // The native fixture returns independent snapshot data just like the real helper.
  s.windows[0]={...s.windows[0],title:'Ordinary page',geometry:{x:1,y:0,width:900,height:700}};
  s.executor.foreground=async()=>s.windows[0];
  assert.equal((await s.cmd('type',{text:'test',snapshotId})).error,'window-moved-retake-snapshot');
  assert.equal(s.host.targetHealth.state,'ready');
});

test('review rejects changed, expired, forged and replayed candidates',async t=>{
  for(const mutate of [s=>{s.windows[1].title='Different dialog';},s=>{s.windows[1].processStartedAt='333';},s=>{s.windows[1].passwordPresent=true;},s=>{s.advance(60001);}]){
    const s=setup(t);const choices=await s.list();mutate(s);
    assert.equal((await s.host.ownerTarget({action:'approve',candidateId:choices[1].candidateId,temporary:true})).ok,false);
    assert.equal(s.host.targetWindow.handle,'1001');assert.deepEqual(s.calls,[]);
  }
  const s=setup(t);const choices=await s.list();
  assert.equal((await s.host.ownerTarget({action:'approve',candidateId:'forged',temporary:true})).ok,false);
  assert.equal((await s.host.ownerTarget({action:'approve',candidateId:choices[1].candidateId,temporary:true})).ok,false);
  const fresh=await s.list();const approval={action:'approve',candidateId:fresh[1].candidateId,temporary:false};
  assert.equal((await s.host.ownerTarget(approval)).ok,true);assert.equal((await s.host.ownerTarget(approval)).ok,false);
});

test('STOP or disconnect during owner approval cancels its late result',async t=>{
  for(const interrupt of ['stop','disconnect']){
    const s=setup(t);const relay=new EventEmitter();relay.send=()=>{};s.host.attachRelay(relay);
    const choices=await s.list();let resolve,started;
    const pending=new Promise(r=>{resolve=r;});const begun=new Promise(r=>{started=r;});
    s.executor.inspect=async()=>{started();return pending;};
    const approval=s.host.ownerTarget({action:'approve',candidateId:choices[1].candidateId,temporary:true});await begun;
    if(interrupt==='stop')s.host.emergencyStop();else relay.emit('status',{authenticated:false});
    resolve({ok:true,window:s.windows[1]});assert.equal((await approval).error,'target-review-cancelled');
    assert.equal(s.host.mode,'off');assert.equal(s.host.targetWindow.handle,'1001');
  }
});

test('local opt-in and local STOP cannot be bypassed by owner recovery',async t=>{
  const s=setup(t);s.settings.allowRemoteArm=false;assert.equal((await s.host.ownerTarget({action:'list'})).error,'remote-arm-disabled');
  s.settings.allowRemoteArm=true;const choices=await s.list();s.host.emergencyStop();
  assert.equal((await s.host.ownerTarget({action:'approve',candidateId:choices[1].candidateId,temporary:true})).error,'local-stop-latched');
});

test('temporary grant is revoked by STOP, pause and disconnect with no automatic return to parent',async t=>{
  for(const end of ['off','paused','disconnect']){
    const s=setup(t);const choices=await s.list();await s.host.ownerTarget({action:'approve',candidateId:choices[1].candidateId,temporary:true});s.arm();
    if(end==='disconnect'){const relay=new EventEmitter();relay.send=()=>{};s.host.attachRelay(relay);relay.emit('status',{authenticated:false});}
    else s.host.setMode(end);
    assert.equal(s.host.targetWindow,null);assert.equal(s.host.targetHealth.state,'reselect-required');
  }
});

test('arm checks actual target and rejects a requested duration beyond temporary approval',async t=>{
  const s=setup(t);const choices=await s.list();await s.host.ownerTarget({action:'approve',candidateId:choices[1].candidateId,temporary:true});
  const request={mode:'armed',expiresAt:1000000,controlGeneration:1};
  assert.equal((await s.host.applyOwnerState(request)).error,'temporary-target-limit');assert.equal(s.host.mode,'off');
  assert.equal((await s.host.applyOwnerState({...request,expiresAt:301000})).ok,true);
  s.windows[1].processStartedAt='new-process';assert.equal((await s.host.applyOwnerState({...request,expiresAt:301000})).error,'target-reselect-required');
});

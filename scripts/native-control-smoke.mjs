import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {EventEmitter} from 'node:events';
import assert from 'node:assert/strict';
import {HostController} from '../host/controller.mjs';
import {DesktopExecutor} from '../host/executor.mjs';
import {foregroundWindow,focus} from '../host/windows.mjs';
const execute=promisify(execFile);
const powershell=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
const helper=path.resolve('scripts/native-smoke-helper.ps1');
const fixture=path.join(os.tmpdir(),`botdesk-native-proof-${randomUUID()}.txt`);
const evidence=path.resolve('evidence');
let owned,controller;
const report={startedAt:new Date().toISOString(),ok:false,checks:[],source:'A new Notepad process with a uniquely named empty test document. Only that active test document is controlled.'};
async function ps(mode,options={}){
  const args=['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',helper,'-Mode',mode];
  if(mode!=='baseline')args.push('-FixtureFile',fixture);
  if(options.pid)args.push('-OwnedPid',String(options.pid));
  if(options.startTicks)args.push('-StartTicks',options.startTicks);
  const {stdout}=await execute(powershell,args,{timeout:15000,windowsHide:true});
  return JSON.parse(stdout);
}
const request=(name,args={})=>({name,args,commandId:randomUUID(),expiresAt:Date.now()+20000,controlGeneration:controller.controlGeneration??3,botId:'native-smoke'});
try{
  await fs.mkdir(evidence,{recursive:true});
  const baseline=new Set((await ps('baseline')).pids);
  await fs.writeFile(fixture,'',{flag:'wx'});
  report.launch=await ps('start');
  let target;
  for(let attempt=0;attempt<10;attempt++){
    const found=(await ps('find')).windows;
    if(found.length===1){
      assert.ok(!baseline.has(found[0].pid),'Notepad reused an existing process; aborting without input.');
      owned=found[0];
      await focus({expectedWindow:{handle:owned.handle,processId:owned.pid}});
    }
    const candidate=await foregroundWindow();
    if(candidate.processName?.toLowerCase()==='notepad'&&candidate.title?.includes(path.basename(fixture,'.txt'))){
      assert.ok(!baseline.has(candidate.processId),'Notepad reused an existing process; aborting without input.');
      const identity=await ps('inspect',{pid:candidate.processId});
      assert.equal(identity.handle,candidate.handle);
      owned=identity;
      assert.ok(identity.texts.every(text=>!text.trim()),'The new fixture is not empty.');
      target=candidate;break;
    }
    await new Promise(resolve=>setTimeout(resolve,300));
  }
  assert.ok(target,'A new uniquely owned Notepad window did not become foreground; no input sent.');
  report.target={processId:target.processId,handle:target.handle,integrity:target.integrity,desktop:target.desktop,automationChecked:target.automationChecked,passwordPresent:target.passwordPresent};
  report.checks.push('new-pid-unique-title-empty-document');
  const executor=new DesktopExecutor({recorder:{stop:async()=>({ok:true,recording:false})}});
  const audit=[];const relay=new EventEmitter();relay.send=()=>true;
  controller=new HostController({executor,configStore:{load:()=>({allowRemoteArm:true,allowedApps:['notepad']})},auditLog:{write:event=>audit.push(event)}});
  controller.attachRelay(relay);controller.selectTarget(target);
  const armed=await controller.applyOwnerState({mode:'armed',minutes:5,expiresAt:Date.now()+300000,controlGeneration:1,requestId:randomUUID()});
  assert.equal(armed.ok,true,JSON.stringify(armed));report.checks.push('real-target-arm');
  const initial=await controller.runCommand(request('screenshot'));
  assert.equal(initial.ok,true,JSON.stringify(initial));assert.ok(initial.result.snapshotId);report.checks.push('guarded-native-screenshot');
  const text='BOTDESK NATIVE CONTROL PROOF 2026-09-08';
  const typed=await controller.runCommand(request('type',{snapshotId:initial.result.snapshotId,text}));
  assert.equal(typed.ok,true,JSON.stringify(typed));
  const after=await ps('inspect',owned);assert.ok(after.texts.some(value=>value.trim()===text),'Native text did not reach the owned document.');report.checks.push('real-native-text-confirmed-by-UIA');
  const captured=await controller.runCommand(request('screenshot'));assert.equal(captured.ok,true,JSON.stringify(captured));
  // Modern Notepad can restore inactive saved tabs even in a new process. Never
  // persist its full-window image: use the in-memory capture to prove dimensions.
  report.capture={saved:false,bytes:Buffer.byteLength(captured.result.image.data,'base64'),width:captured.result.image.width,height:captured.result.image.height};
  report.privacyNote='Modern Notepad may restore inactive saved tabs in a newly launched process. No unrelated tab is selected or edited; full-window screenshots remain in memory and are not saved.';
  await controller.applyOwnerState({mode:'paused',controlGeneration:2,requestId:randomUUID()});
  const paused=await controller.runCommand(request('type',{snapshotId:captured.result.snapshotId,text:'MUST NOT TYPE'}));assert.equal(paused.ok,false);report.pausedError=paused.error;
  assert.ok((await ps('inspect',owned)).texts.some(value=>value.trim()===text));report.checks.push('pause-denies-input-document-unchanged');
  controller.emergencyStop('native-smoke-stop');
  const stopped=await controller.runCommand(request('type',{snapshotId:captured.result.snapshotId,text:'MUST NOT TYPE'}));assert.equal(stopped.ok,false);report.stoppedError=stopped.error;
  const rearm=await controller.applyOwnerState({mode:'armed',expiresAt:Date.now()+300000,controlGeneration:3,requestId:randomUUID()});assert.equal(rearm.error,'local-stop-latched');
  assert.ok((await ps('inspect',owned)).texts.some(value=>value.trim()===text));report.checks.push('emergency-stop-latches-denies-input-and-remote-rearm');
  report.ok=true;report.audit=audit;
}catch(error){report.error=error.message;process.exitCode=1;}
finally{
  controller?.emergencyStop('native-smoke-finished');
  if(owned){
    try{report.cleanup=await ps('cleanup',owned);}catch(error){report.cleanupError=error.message;report.ok=false;process.exitCode=1;}
  }
  await fs.rm(fixture,{force:true});
  report.finishedAt=new Date().toISOString();
  await fs.mkdir(evidence,{recursive:true});await fs.writeFile(path.join(evidence,'native-control-proof.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}

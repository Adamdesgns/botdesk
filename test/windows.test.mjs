import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeHelperError, helperSelfTest, runWindowsAction } from '../host/windows.mjs';
function fixture() {
  const child=new EventEmitter();
  child.stdin=new PassThrough(); child.stdout=new PassThrough(); child.stderr=new PassThrough();
  child.killed=0; child.kill=()=>{child.killed++;};
  let options,command,argv;
  return {child,spawnImpl:(cmd,args,opts)=>{command=cmd;argv=args;options=opts;return child;},details:()=>({options,command,argv})};
}
test('focus asks only for the supplied HWND/PID and never enumerates replacements', async () => {
  const f=fixture(); let input=''; f.child.stdin.on('data',chunk=>{input+=chunk;});
  const result=runWindowsAction('focus',{expectedWindow:{handle:'1001',processId:123}},{spawnImpl:f.spawnImpl});
  f.child.stdout.end('{"ok":false,"error":"focus-refused"}'); f.child.emit('close',0);
  assert.deepEqual(await result,{ok:false,error:'focus-refused'});
  const request=JSON.parse(input);
  assert.equal(request.action,'focus');
  assert.deepEqual(request.args.expectedWindow,{handle:'1001',processId:123});
  assert.equal(Object.hasOwn(request.args,'handle'),false);
});

test('passes JSON over stdin, never evaluates input as shell text', async () => {
  const f=fixture(); let input=''; f.child.stdin.on('data',chunk=>{input+=chunk;});
  const result=runWindowsAction('type',{text:'$(danger); & shell',expectedWindow:{handle:'100',processId:23}},{spawnImpl:f.spawnImpl});
  f.child.stdout.end('{"ok":true}'); f.child.emit('close',0);
  assert.deepEqual(await result,{ok:true});
  assert.equal(JSON.parse(input).args.text,'$(danger); & shell');
  assert.equal(f.details().options.shell,false);
  assert.equal(f.details().options.windowsHide,true);
  assert.equal(f.details().argv.some(arg=>arg.includes('danger')),false);
});
test('stop aborts the active native helper and ignores late output', async () => {
  const f=fixture(),controller=new AbortController();
  const result=runWindowsAction('click',{},{spawnImpl:f.spawnImpl,signal:controller.signal});
  controller.abort();
  f.child.stdout.end('{"ok":true}'); f.child.emit('close',0);
  assert.equal((await result).error,'windows-helper-aborted'); assert.equal(f.child.killed,1);
});
test('pre-aborted actions never spawn, unknown actions never spawn', async () => {
  const controller=new AbortController();controller.abort();
  const spawnImpl=()=>{throw new Error('must not spawn');};
  assert.equal((await runWindowsAction('key',{}, {signal:controller.signal,spawnImpl})).error,'windows-helper-aborted');
  assert.equal((await runWindowsAction('shell',{}, {spawnImpl})).error,'unknown-action');
});
test('native timeout kills helper, invalid responses and failures stay generic', async () => {
  const timeout=fixture();
  assert.equal((await runWindowsAction('capture',{}, {spawnImpl:timeout.spawnImpl,timeoutMs:5})).error,'windows-helper-timeout');
  assert.equal(timeout.child.killed,1);
  const invalid=fixture(); const response=runWindowsAction('foreground',{}, {spawnImpl:invalid.spawnImpl});
  invalid.child.stdout.end('{"secret":"do not pass"}');invalid.child.emit('close',0);
  assert.equal((await response).error,'windows-helper-invalid-response');
  const failure=fixture(); const failed=runWindowsAction('foreground',{}, {spawnImpl:failure.spawnImpl});
  failure.child.stderr.end('PRIVATE INPUT');failure.child.emit('close',1);
  assert.equal((await failed).error,'windows-helper-failed');
});
test('helper self-test compiles only, never sends a request, and explains each failure', async () => {
  const helperFile=fileURLToPath(new URL('../scripts/windows-helper.ps1',import.meta.url));
  const unsupported=await helperSelfTest({platform:'linux',spawnImpl:()=>{throw new Error('must not spawn');}});
  assert.equal(unsupported.error,'unsupported-platform'); assert.match(unsupported.message,/Windows only/);
  const missing=await helperSelfTest({platform:'win32',helperFile:helperFile+'.does-not-exist',spawnImpl:()=>{throw new Error('must not spawn');}});
  assert.equal(missing.error,'windows-helper-missing'); assert.match(missing.message,/unpack scripts\/windows-helper.ps1/);
  const ok=fixture(); let wroteInput=false; ok.child.stdin.on('data',()=>{wroteInput=true;});
  const passing=helperSelfTest({platform:'win32',helperFile,spawnImpl:ok.spawnImpl});
  ok.child.stdout.end('{"ok":true,"compiled":true}'); ok.child.emit('close',0);
  const result=await passing;
  assert.equal(result.ok,true); assert.equal(result.compiled,true); assert.equal(wroteInput,false);
  assert.ok(ok.details().argv.includes('-CompileOnly')); assert.equal(ok.details().options.shell,false);
  assert.equal(ok.details().options.stdio[0],'ignore');
  const failing=fixture(); const failed=helperSelfTest({platform:'win32',helperFile,spawnImpl:failing.spawnImpl});
  failing.child.stderr.end('Add-Type : Cannot add type. \u001b[31mCompilation errors occurred.\u001b[0m'); failing.child.stdout.end(''); failing.child.emit('close',1);
  const failure=await failed;
  assert.equal(failure.error,'windows-helper-failed'); assert.equal(failure.exitCode,1);
  assert.match(failure.message,/Constrained Language Mode/); assert.equal(failure.stderrExcerpt,'Add-Type : Cannot add type. [31mCompilation errors occurred.[0m');
  const slow=fixture(); const timedOut=await helperSelfTest({platform:'win32',helperFile,spawnImpl:slow.spawnImpl,timeoutMs:5});
  assert.equal(timedOut.error,'windows-helper-timeout'); assert.equal(slow.child.killed,1);
  const odd=fixture(); const invalid=helperSelfTest({platform:'win32',helperFile,spawnImpl:odd.spawnImpl});
  odd.child.stdout.end('Transcript started, output file is C:\\x.txt'); odd.child.emit('close',0);
  assert.equal((await invalid).error,'windows-helper-invalid-response');
  const noShell=await helperSelfTest({platform:'win32',helperFile,spawnImpl:()=>{throw new Error('ENOENT');}});
  assert.equal(noShell.error,'windows-helper-start-failed');
  assert.match(describeHelperError('made-up-code'),/reported an error\. \(made-up-code\)$/);
  assert.match(describeHelperError('focus-refused'),/Click that window once/);
});

test('native C# compiles on Windows without observing or controlling any apps', {skip:process.platform!=='win32',timeout:30000}, () => {
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const executable=path.join(process.env.SystemRoot || 'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  const output=execFileSync(executable,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts/windows-helper.ps1'),'-CompileOnly'],{encoding:'utf8',timeout:25000,windowsHide:true});
  assert.deepEqual(JSON.parse(output),{ok:true,compiled:true});
});

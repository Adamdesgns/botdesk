import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWindowsAction } from '../host/windows.mjs';
function fixture() {
  const child=new EventEmitter();
  child.stdin=new PassThrough(); child.stdout=new PassThrough(); child.stderr=new PassThrough();
  child.killed=0; child.kill=()=>{child.killed++;};
  let options,command,argv;
  return {child,spawnImpl:(cmd,args,opts)=>{command=cmd;argv=args;options=opts;return child;},details:()=>({options,command,argv})};
}
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
test('native C# compiles on Windows without observing or controlling any apps', {skip:process.platform!=='win32',timeout:30000}, () => {
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const executable=path.join(process.env.SystemRoot || 'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  const output=execFileSync(executable,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts/windows-helper.ps1'),'-CompileOnly'],{encoding:'utf8',timeout:25000,windowsHide:true});
  assert.deepEqual(JSON.parse(output),{ok:true,compiled:true});
});

test('native helper source includes JPEG large-window capture, monitors, clipboard and E/WASD keys', () => {
  const source = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts/windows-helper.ps1'), 'utf8');
  assert.match(source, /useJpeg/);
  assert.match(source, /image\/jpeg/);
  assert.match(source, /list_monitors/);
  assert.match(source, /ClipboardRead/);
  assert.match(source, /ClipboardWrite/);
  assert.match(source, /"E","W","A","S","D","SPACE"/);
  assert.doesNotMatch(source, /scale factor|ScaleFactor/);
});

test('native guard errors are precise but foreign exception content stays private', {skip:process.platform!=='win32',timeout:30000}, () => {
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const script = `. '${path.join(root,'scripts/windows-helper.ps1').replaceAll("'","''")}' -CompileOnly; $method=[BotDeskNative].GetMethod('Block',[Reflection.BindingFlags]'NonPublic,Static'); $guard=$method.Invoke($null,@('focus-refused')); $wrapped=New-Object Exception('private outer', $guard); $foreign=New-Object Exception('private window title'); @{guard=[BotDeskNative]::SafeError($wrapped);foreign=[BotDeskNative]::SafeError($foreign)} | ConvertTo-Json -Compress`;
  const executable=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  const output=execFileSync(executable,['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',windowsHide:true,timeout:25000});
  assert.deepEqual(JSON.parse(output.trim().split(/\r?\n/).at(-1)),{guard:'focus-refused',foreign:'native-action-blocked'});
  assert.equal(output.includes('private'),false);
});

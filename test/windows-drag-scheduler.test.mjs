import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('native drag scheduling budgets slow checks without skipping waypoints or overrunning cancellation', { skip: process.platform !== 'win32', timeout: 30000 }, () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  // Execute the actual compiled scheduler with fake time and inert callbacks.
  // This never reads a window or sends input to the desktop.
  const script = `
. '${path.join(root, 'scripts/windows-helper.ps1').replaceAll("'", "''")}' -CompileOnly
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Reflection;
public static class DragScheduleFixture {
  public static object Run(MethodInfo scheduler,int segments,int duration,int budget,int cost,int stopAt,int failCheck) {
    return RunCosts(scheduler,segments,duration,budget,new int[]{cost},stopAt,failCheck);
  }
  public static object RunCosts(MethodInfo scheduler,int segments,int duration,int budget,int[] costs,int stopAt,int failCheck) {
    long clock=0; int calls=0; string error=null;
    var checks=new List<object>(); var moves=new List<object>();
    Action active=delegate() {
      if(stopAt>=0 && clock>=stopAt) throw new Exception("cancelled");
      if(clock>duration+250) throw new Exception("deadline");
    };
    try {
      scheduler.Invoke(null,new object[]{segments,duration,(long)budget,
        new Func<long>(delegate() { return clock; }),
        new Action<int>(delegate(int ms) { clock+=ms; }),
        new Action<int,double>(delegate(int segment,double fraction) {
          calls++; checks.Add(new {segment=segment,fraction=fraction}); clock+=costs[Math.Min(calls-1,costs.Length-1)];
          if(calls==failCheck) throw new Exception("target-changed");
        }),
        new Action<int,double>(delegate(int segment,double fraction) {
          moves.Add(new {segment=segment,fraction=fraction,at=clock});
        }),active});
    } catch(TargetInvocationException ex) { error=ex.InnerException.Message; }
    return new {elapsed=clock,error=error,checks=checks,moves=moves};
  }
}
'@
$method=[BotDeskNative].GetMethod('RunDragSchedule',[Reflection.BindingFlags]'NonPublic,Static')
@{
  slow=[DragScheduleFixture]::Run($method,1,2000,90,90,-1,-1)
  learning=[DragScheduleFixture]::Run($method,1,2000,1,90,-1,-1)
  fast=[DragScheduleFixture]::Run($method,1,2000,1,1,-1,-1)
  declining=[DragScheduleFixture]::Run($method,1,2000,500,1,-1,-1)
  overbudget=[DragScheduleFixture]::Run($method,1,2000,2500,1,-1,-1)
  corners=[DragScheduleFixture]::Run($method,4,2000,90,90,-1,-1)
  studioRecorded=[DragScheduleFixture]::RunCosts($method,1,2000,422,[int[]]@(374,683,783,718),-1,-1)
  studioUnrecorded=[DragScheduleFixture]::RunCosts($method,1,2000,400,[int[]]@(360,779,653),-1,-1)
  dense=[DragScheduleFixture]::Run($method,63,1000,90,90,-1,-1)
  stopped=[DragScheduleFixture]::Run($method,1,2000,90,90,450,-1)
  stoppedWait=[DragScheduleFixture]::Run($method,1,2000,1,1,15,-1)
  stoppedHold=[DragScheduleFixture]::Run($method,1,2000,2500,1,450,-1)
  changed=[DragScheduleFixture]::Run($method,1,2000,90,90,-1,2)
  stalled=[DragScheduleFixture]::Run($method,1,2000,90,2500,-1,-1)
} | ConvertTo-Json -Depth 8 -Compress
`;
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const output = execFileSync(executable, ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 25000 });
  const cases = JSON.parse(output.trim().split(/\r?\n/).at(-1));
  for (const name of ['slow', 'learning', 'fast', 'declining', 'overbudget', 'corners', 'studioRecorded', 'studioUnrecorded']) {
    const result = cases[name];
    assert.equal(result.error, null);
    assert.ok(result.elapsed >= 2000 && result.elapsed <= 2250, `${name}: ${result.elapsed}ms`);
    assert.equal(result.checks.length, result.moves.length);
    assert.deepEqual(result.checks, result.moves.map(({ segment, fraction }) => ({ segment, fraction })));
    assert.equal(result.moves.at(-1).fraction, 1);
  }
  assert.ok(cases.slow.moves.length < 30, 'slow checks must not accumulate all 63 interpolation samples');
  assert.equal(cases.studioRecorded.checks.length, 3, 'reserve the final waypoint instead of adding a fourth expensive check');
  assert.equal(cases.studioUnrecorded.checks.length, 3);
  assert.deepEqual(cases.corners.moves.filter(move => move.fraction === 1).map(move => move.segment), [0, 1, 2, 3]);
  assert.equal(cases.dense.error, 'deadline');
  assert.ok(cases.dense.moves.every(move => move.at <= 1250));
  assert.deepEqual(cases.dense.moves.map(move => move.segment), cases.dense.moves.map((_, index) => index));
  assert.equal(cases.stopped.error, 'cancelled');
  assert.ok(cases.stopped.moves.every(move => move.at < 450));
  assert.equal(cases.stopped.checks.length, cases.stopped.moves.length + 1, 'STOP during checking must prevent that move');
  assert.equal(cases.stoppedWait.error, 'cancelled');
  assert.equal(cases.stoppedWait.checks.length, 0);
  assert.equal(cases.stoppedWait.moves.length, 0);
  assert.equal(cases.stoppedHold.error, 'cancelled');
  assert.equal(cases.stoppedHold.moves.length, 1);
  assert.equal(cases.stoppedHold.checks.length, 1);
  assert.ok(cases.stoppedHold.elapsed >= 450 && cases.stoppedHold.elapsed <= 460);
  assert.equal(cases.changed.error, 'target-changed');
  assert.equal(cases.changed.checks.length, 2);
  assert.equal(cases.changed.moves.length, 1);
  assert.equal(cases.stalled.error, 'deadline');
  assert.equal(cases.stalled.moves.length, 0);
});

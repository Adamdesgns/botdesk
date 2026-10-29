import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

test('production Focus sequence verifies exact foreground despite provider exceptions', {
  skip: process.platform !== 'win32', timeout: 30_000,
}, () => {
  const source = readFileSync(new URL('../scripts/windows-helper.ps1', import.meta.url), 'utf8');
  const start = source.indexOf('  public static void Focus(string handle,uint pid) {');
  assert.notEqual(start, -1);
  const end = source.indexOf('\n  public static ', start + 1);
  assert.notEqual(end, -1);
  // Execute the production method, replacing only its qualified sleeping dependency.
  // Every other referenced API resolves to an inert fixture; none can touch Windows.
  const method = source.slice(start, end).replaceAll('System.Threading.Thread.Sleep', 'Thread.Sleep');
  const fixture = readFileSync(new URL('./fixtures/focus-sequence.cs', import.meta.url), 'utf8')
    .replace('/* PRODUCTION_FOCUS */', method);
  const scenarios = {
    'already-foreground': [null, 0, 0, 0, 1],
    'native-immediate': [null, 0, 1, 0, 1],
    'native-delayed': [null, 75, 1, 0, 1],
    'provider-success': [null, 0, 1, 1, 1],
    'provider-throws-after-activation': [null, 0, 1, 1, 1],
    'provider-throws-before-delayed-activation': [null, 75, 1, 1, 1],
    'transient-null': [null, 50, 1, 0, 1],
    'native-refusal': ['focus-refused', 1000, 1, 1, 0],
    'provider-throws-without-activation': ['focus-refused', 1000, 1, 1, 0],
    'native-true-without-activation': ['focus-refused', 1000, 1, 0, 0],
    'different-window': ['focus-refused', 1000, 1, 0, 0],
    'stale-before-attempt': ['target-changed', 0, 0, 0, 0],
    'stale-during-observation': ['target-changed', 50, 1, 0, 0],
    'protected-after-provider-exception': ['credential', 0, 1, 1, 1],
    'foreground-lost-at-final-check': ['target-not-foreground', 0, 1, 0, 1],
  };
  const temp = mkdtempSync(join(tmpdir(), 'botdesk-focus-fixture-'));
  try {
    const csPath = join(temp, 'fixture.cs');
    writeFileSync(csPath, fixture);
    const quote = value => `'${value.replaceAll("'", "''")}'`;
    const script = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; Add-Type -Path ${quote(csPath)}; @(${Object.keys(scenarios).map(name => `[FocusSequenceFixture]::Run(${quote(name)})`).join(';')}) | ConvertTo-Json -Depth 4 -Compress`;
    const executable = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const rows = JSON.parse(execFileSync(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
      encoding: 'utf8', timeout: 25_000, windowsHide: true,
    }));
    assert.equal(rows.length, Object.keys(scenarios).length);
    for (const row of rows) {
      assert.deepEqual([row.error, row.elapsed, row.nativeCalls, row.providerCalls, row.finalChecks], scenarios[row.scenario], row.scenario);
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

param([string]$Artifact = (Join-Path $PSScriptRoot '..\dist\BotDesk-0.1.0-portable.exe'))
$ErrorActionPreference = 'Stop'
$botdeskArtifact = (Resolve-Path -LiteralPath $Artifact).Path
$botdeskTestDir = Join-Path ([IO.Path]::GetTempPath()) ('botdesk-plain-launch-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $botdeskTestDir | Out-Null
$botdeskPriorData = $env:BOTDESK_TEST_DATA
$botdeskPriorNode = $env:ELECTRON_RUN_AS_NODE
$env:BOTDESK_TEST_DATA = $botdeskTestDir
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$botdeskLaunch = $null
$botdeskOwned = @()
try {
  # No inspector, remote-debugging, no-sandbox or GPU flags. This is the portable launcher itself.
  $botdeskLaunch = Start-Process -FilePath $botdeskArtifact -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $botdeskTestDir 'stdout.log') -RedirectStandardError (Join-Path $botdeskTestDir 'stderr.log')
  Start-Sleep -Seconds 12
  $botdeskProcesses = @(Get-CimInstance Win32_Process)
  $botdeskIds = [Collections.Generic.HashSet[int]]::new()
  [void]$botdeskIds.Add($botdeskLaunch.Id)
  do {
    $botdeskAdded = $false
    foreach ($botdeskProcess in $botdeskProcesses) {
      if ($botdeskIds.Contains([int]$botdeskProcess.ParentProcessId) -and $botdeskIds.Add([int]$botdeskProcess.ProcessId)) { $botdeskAdded = $true }
    }
  } while ($botdeskAdded)
  $botdeskOwned = @($botdeskProcesses | Where-Object { $botdeskIds.Contains([int]$_.ProcessId) })
  $botdeskWindows = @($botdeskOwned | ForEach-Object {
    Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -eq 'BotDesk' }
  })
  if ($botdeskWindows.Count -ne 1) { throw 'Expected exactly one responding BotDesk main window after ordinary portable startup.' }
  if (-not $botdeskWindows[0].Responding) { throw 'BotDesk main window is not responding.' }
  $botdeskLog = Get-Content -LiteralPath (Join-Path $botdeskTestDir 'stderr.log') -Raw
  if ($botdeskLog -match 'FATAL|GPU process isn.t usable|BotDesk startup failed') { throw 'Fatal startup error in packaged launch log.' }
  $botdeskResult = [ordered]@{ok=$true;artifact=[IO.Path]::GetFileName($botdeskArtifact);sha256=(Get-FileHash -LiteralPath $botdeskArtifact -Algorithm SHA256).Hash;inspector=$false;runtimeSeconds=12;mainWindow='BotDesk';responding=$true;remoteConfigured=$false;cleanup='Own test process tree terminated after observation';logsSavedLocally=$true}
  $botdeskEvidence = Join-Path $PSScriptRoot '..\evidence\portable-launch-smoke.json'
  $botdeskResult | ConvertTo-Json | Set-Content -LiteralPath $botdeskEvidence -Encoding utf8
  $botdeskResult | ConvertTo-Json
} finally {
  # Stop only the exact descendants created by our launcher, with creation time checked against PID reuse.
  foreach ($botdeskOwnedProcess in ($botdeskOwned | Sort-Object ProcessId -Descending)) {
    $botdeskCurrent = Get-CimInstance Win32_Process -Filter "ProcessId=$($botdeskOwnedProcess.ProcessId)" -ErrorAction SilentlyContinue
    if ($botdeskCurrent -and $botdeskCurrent.CreationDate -eq $botdeskOwnedProcess.CreationDate -and $botdeskCurrent.ExecutablePath -eq $botdeskOwnedProcess.ExecutablePath) {
      Stop-Process -Id $botdeskCurrent.ProcessId -Force -ErrorAction SilentlyContinue
    }
  }
  if ($botdeskLaunch -and -not $botdeskLaunch.HasExited) { $botdeskLaunch.Kill() }
  if ($null -eq $botdeskPriorData) { Remove-Item Env:\BOTDESK_TEST_DATA -ErrorAction SilentlyContinue } else { $env:BOTDESK_TEST_DATA = $botdeskPriorData }
  if ($null -eq $botdeskPriorNode) { Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue } else { $env:ELECTRON_RUN_AS_NODE = $botdeskPriorNode }
}

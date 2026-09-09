param([ValidateSet('baseline','start','find','inspect','cleanup')][string]$Mode,[string]$FixtureFile,[int]$OwnedPid,[string]$StartTicks)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
if($Mode -eq 'baseline') {
  @{pids=@(Get-Process -Name notepad -ErrorAction SilentlyContinue | ForEach-Object {$_.Id})} | ConvertTo-Json -Compress
  return
}
$full=[IO.Path]::GetFullPath($FixtureFile)
$temp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath())
if(-not $full.StartsWith($temp,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($full) -notmatch '^botdesk-native-proof-[a-f0-9-]+\.txt$') { throw 'Unsafe fixture path' }
if($Mode -eq 'start') {
  $process=Start-Process -FilePath ([IO.Path]::Combine($env:SystemRoot,'System32','notepad.exe')) -ArgumentList ('"'+$full+'"') -PassThru
  @{launchPid=$process.Id} | ConvertTo-Json -Compress
  return
}
if($Mode -eq 'find') {
  $token=[IO.Path]::GetFileNameWithoutExtension($full)
  @{windows=@(Get-Process -Name notepad -ErrorAction SilentlyContinue | Where-Object {$_.MainWindowTitle.Contains($token)} | ForEach-Object {@{pid=$_.Id;handle=[string]$_.MainWindowHandle;startTicks=[string]$_.StartTime.ToUniversalTime().Ticks}})} | ConvertTo-Json -Compress -Depth 5
  return
}
$process=Get-Process -Id $OwnedPid -ErrorAction SilentlyContinue
if(-not $process) { @{gone=$true}|ConvertTo-Json -Compress; return }
$process.Refresh()
$token=[IO.Path]::GetFileNameWithoutExtension($full)
if($process.ProcessName -ne 'notepad' -or -not $process.MainWindowTitle.Contains($token)) { throw 'Fixture identity mismatch' }
$ticks=[string]$process.StartTime.ToUniversalTime().Ticks
if($StartTicks -and $StartTicks -ne $ticks) { throw 'Fixture PID was reused' }
if($Mode -eq 'cleanup') {
  # Termination is restricted to the new test PID, exact start time and unique fixture title.
  if(-not $StartTicks){throw 'Fixture start time is required'}
  Stop-Process -Id $OwnedPid -Force
  @{stopped=$true;pid=$OwnedPid}|ConvertTo-Json -Compress
  return
}
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,WindowsBase
$root=[System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
if($root.Current.ProcessId -ne $OwnedPid){throw 'Fixture UIA mismatch'}
$condition=New-Object System.Windows.Automation.OrCondition @(
  (New-Object System.Windows.Automation.PropertyCondition ([System.Windows.Automation.AutomationElement]::ControlTypeProperty),([System.Windows.Automation.ControlType]::Document)),
  (New-Object System.Windows.Automation.PropertyCondition ([System.Windows.Automation.AutomationElement]::ControlTypeProperty),([System.Windows.Automation.ControlType]::Edit))
)
$elements=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,$condition)
$texts=@()
foreach($element in $elements){
  if($element.Current.IsPassword){throw 'Unexpected credential control'}
  $pattern=$null
  if($element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern,[ref]$pattern)){$texts+=([System.Windows.Automation.TextPattern]$pattern).DocumentRange.GetText(1000)}
  elseif($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$pattern)){$texts+=([System.Windows.Automation.ValuePattern]$pattern).Current.Value}
}
@{pid=$OwnedPid;handle=[string]$process.MainWindowHandle;startTicks=$ticks;texts=$texts}|ConvertTo-Json -Compress -Depth 5

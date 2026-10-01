param([Parameter(Mandatory=$true)][string]$PortablePath)
$ErrorActionPreference = 'Stop'
$resolved = (Resolve-Path -LiteralPath $PortablePath).ProviderPath
if ([IO.Path]::GetExtension($resolved) -ne '.exe') { throw 'Select the BotDoor portable executable.' }
if (Get-Process -Name BotDesk -ErrorAction SilentlyContinue) {
  throw 'Quit BotDesk from its tray menu first. This launcher never kills an existing session.'
}
# Windows presents its normal local consent prompt. No UAC policy is modified.
Start-Process -FilePath $resolved -Verb RunAs -WindowStyle Hidden

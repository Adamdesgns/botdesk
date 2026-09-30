Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$taskRepoRoot = Split-Path $PSScriptRoot -Parent
$taskPluginRoot = Join-Path $taskRepoRoot 'dist\botdoor-plugin'
$taskZipPath = Join-Path $taskRepoRoot 'dist\BotDoor-1.6.0-codex-local.zip'
$taskFiles = @('plugin.json', 'mcp.json', 'README.md', 'THIRD-PARTY-NOTICES.txt', 'assets/icon.png', 'runtime/server.mjs', 'skills/botdoor/SKILL.md')
Add-Type -AssemblyName System.IO.Compression
$taskStream = [System.IO.File]::Open($taskZipPath, [System.IO.FileMode]::Create)
$taskArchive = [System.IO.Compression.ZipArchive]::new($taskStream, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($taskFile in $taskFiles) {
        $taskEntry = $taskArchive.CreateEntry($taskFile)
        $taskEntryStream = $taskEntry.Open()
        try {
            $taskBytes = [System.IO.File]::ReadAllBytes((Join-Path $taskPluginRoot $taskFile))
            $taskEntryStream.Write($taskBytes, 0, $taskBytes.Length)
        } finally { $taskEntryStream.Dispose() }
    }
} finally { $taskArchive.Dispose(); $taskStream.Dispose() }
$taskHasher = [System.Security.Cryptography.SHA256]::Create()
try { $taskHash = [BitConverter]::ToString($taskHasher.ComputeHash([System.IO.File]::ReadAllBytes($taskZipPath))).Replace('-', '') }
finally { $taskHasher.Dispose() }
Set-Content -LiteralPath "$taskZipPath.sha256" -Value "$taskHash  BotDoor-1.6.0-codex-local.zip"
$taskReadStream = [System.IO.File]::OpenRead($taskZipPath)
$taskReadArchive = [System.IO.Compression.ZipArchive]::new($taskReadStream, [System.IO.Compression.ZipArchiveMode]::Read)
try {
    if ($taskReadArchive.Entries.Count -ne $taskFiles.Count) { throw 'ZIP file count mismatch' }
    foreach ($taskEntry in $taskReadArchive.Entries) {
        if ($taskFiles -notcontains $taskEntry.FullName) { throw 'Unexpected ZIP entry' }
        $taskBuffer = [System.IO.MemoryStream]::new()
        $taskEntryStream = $taskEntry.Open()
        try {
            $taskEntryStream.CopyTo($taskBuffer)
            $taskExpected = [System.IO.File]::ReadAllBytes((Join-Path $taskPluginRoot $taskEntry.FullName))
            if ([Convert]::ToBase64String($taskBuffer.ToArray()) -cne [Convert]::ToBase64String($taskExpected)) { throw 'ZIP bytes mismatch' }
        } finally { $taskEntryStream.Dispose(); $taskBuffer.Dispose() }
    }
} finally { $taskReadArchive.Dispose(); $taskReadStream.Dispose() }
Write-Output "Local ZIP verified: 7 allowed files; SHA256 $taskHash"

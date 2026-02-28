$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$tasksPath = Join-Path $root "tasks\\tasks.json"
$scriptPath = Join-Path $root "scripts\\monday_sync.py"

if (!(Test-Path $tasksPath)) {
  throw "Missing tasks/tasks.json"
}

Write-Host "Watching $tasksPath"

$fsw = New-Object System.IO.FileSystemWatcher
$fsw.Path = Split-Path $tasksPath
$fsw.Filter = [System.IO.Path]::GetFileName($tasksPath)
$fsw.NotifyFilter = [System.IO.NotifyFilters]::LastWrite
$fsw.EnableRaisingEvents = $true

Register-ObjectEvent $fsw Changed -Action {
  Start-Sleep -Milliseconds 200
  & python $using:scriptPath
} | Out-Null

while ($true) {
  Start-Sleep -Seconds 1
}

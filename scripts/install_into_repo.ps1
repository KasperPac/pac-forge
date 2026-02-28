param(
  [Parameter(Mandatory = $true)]
  [string]$TargetPath
)

$ErrorActionPreference = "Stop"

function Ensure-LineInFile($file, $line) {
  if (!(Test-Path $file)) {
    New-Item -ItemType File -Path $file | Out-Null
  }
  $content = Get-Content $file -Raw
  if ($content -notmatch [regex]::Escape($line)) {
    Add-Content -Path $file -Value $line
  }
}

$sourceRoot = Split-Path -Parent $PSScriptRoot
$targetRoot = (Resolve-Path $TargetPath).Path

Write-Host "Installing Monday Integration into $targetRoot"

# Copy scripts
New-Item -ItemType Directory -Force -Path (Join-Path $targetRoot "scripts") | Out-Null
Copy-Item -Path (Join-Path $sourceRoot "scripts\\*.py") -Destination (Join-Path $targetRoot "scripts") -Force
Copy-Item -Path (Join-Path $sourceRoot "scripts\\*.ps1") -Destination (Join-Path $targetRoot "scripts") -Force

# Copy tasks folder
New-Item -ItemType Directory -Force -Path (Join-Path $targetRoot "tasks") | Out-Null
Copy-Item -Path (Join-Path $sourceRoot "tasks\\tasks.json") -Destination (Join-Path $targetRoot "tasks\\tasks.json") -Force

# Copy config and reset repo-specific ids
$config = Get-Content (Join-Path $sourceRoot "monday.config.json") -Raw | ConvertFrom-Json
$config.board_id = $null
$config.columns.status = $null
$config.columns.description = $null
$config.columns.improvements = $null
$config.columns.comments = $null

# keep overview shared ids
if ($null -eq $config.overview) {
  $config | Add-Member -NotePropertyName overview -NotePropertyValue @{ }
}

($config | ConvertTo-Json -Depth 10) | Set-Content -Path (Join-Path $targetRoot "monday.config.json")

# Copy .env if missing
$envPath = Join-Path $targetRoot ".env"
if (!(Test-Path $envPath)) {
  Copy-Item -Path (Join-Path $sourceRoot ".env") -Destination $envPath -Force
}

# Ensure .gitignore entries
$gitignorePath = Join-Path $targetRoot ".gitignore"
Ensure-LineInFile $gitignorePath ".env"
Ensure-LineInFile $gitignorePath "tasks/tasks.json"

Write-Host "Done."

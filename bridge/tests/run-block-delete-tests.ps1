param([string]$BridgeDirectory, [string]$NativeCapture)
$ErrorActionPreference = 'Stop'
$taskTestExe = Join-Path $env:TEMP ('PacForge-BlockDeleteTests-' + [guid]::NewGuid().ToString('N') + '.exe')
try {
    & "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /r:System.Xml.Linq.dll "/out:$taskTestExe" (Join-Path $PSScriptRoot 'BlockDeleteTests.cs') (Join-Path $PSScriptRoot '..\PacForgeBridge\BlockDeletePolicy.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Test compilation failed' }
    & $taskTestExe
    if ($LASTEXITCODE -ne 0) { throw 'Block deletion tests failed' }
    if ($BridgeDirectory) {
        $taskBuild = (Resolve-Path -LiteralPath $BridgeDirectory).Path
        $taskContractExe = Join-Path $taskBuild ('BlockDeleteContractTests-' + [guid]::NewGuid().ToString('N') + '.exe')
        try {
            & "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo "/out:$taskContractExe" "/r:$taskBuild\PacForgeBridge.V21.exe" "/r:$taskBuild\Newtonsoft.Json.dll" (Join-Path $PSScriptRoot 'BlockDeleteContractTests.cs')
            if ($LASTEXITCODE -ne 0) { throw 'Contract test compilation failed' }
            if ($NativeCapture) { & $taskContractExe $NativeCapture } else { & $taskContractExe }
            if ($LASTEXITCODE -ne 0) { throw 'Contract/native-fixture tests failed' }
        } finally {
            if (Test-Path -LiteralPath $taskContractExe) { Remove-Item -LiteralPath $taskContractExe }
        }
    }
} finally {
    if (Test-Path -LiteralPath $taskTestExe) { Remove-Item -LiteralPath $taskTestExe }
}

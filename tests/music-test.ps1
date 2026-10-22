param([string]$NativeTrack)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$output = Join-Path $env:TEMP ('KarmaMusicTests-' + [guid]::NewGuid().ToString('N') + '.exe')
& $compiler /nologo /target:exe "/out:$output" "$repo\client\Launcher\MenuMusic.cs" "$PSScriptRoot\MenuMusicTests.cs"
if ($LASTEXITCODE -ne 0) { throw 'Music test build failed' }
try {
    if ($NativeTrack) { & $output (Resolve-Path -LiteralPath $NativeTrack).Path } else { & $output }
    if ($LASTEXITCODE -ne 0) { throw 'Music tests failed' }
} finally { Remove-Item -LiteralPath $output -ErrorAction SilentlyContinue }

$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$output = Join-Path $env:TEMP ('KarmaUpdateTests-' + [guid]::NewGuid().ToString('N') + '.exe')
& $compiler /nologo /target:exe /nowarn:0649 "/out:$output" /reference:System.Web.Extensions.dll "$repo\client\Launcher\ReleaseUpdate.cs" "$repo\client\Launcher\ReleaseTrust.cs" "$PSScriptRoot\ReleaseUpdateTests.cs"
if ($LASTEXITCODE -ne 0) { throw 'Update test build failed' }
try { & $output; if ($LASTEXITCODE -ne 0) { throw 'Update tests failed' } }
finally { Remove-Item -LiteralPath $output -ErrorAction SilentlyContinue }

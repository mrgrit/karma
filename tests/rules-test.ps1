$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$output = Join-Path $env:TEMP ('KarmaRulesTests-' + [guid]::NewGuid().ToString('N') + '.exe')
& $compiler /nologo /target:exe "/out:$output" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll "$repo\client\Launcher\AuthDialog.cs" "$PSScriptRoot\RulesDialogTests.cs"
if ($LASTEXITCODE -ne 0) { throw 'Rules test build failed' }
try { & $output "$repo\client\Launcher"; if ($LASTEXITCODE -ne 0) { throw 'Rules tests failed' } }
finally { Remove-Item -LiteralPath $output -ErrorAction SilentlyContinue }

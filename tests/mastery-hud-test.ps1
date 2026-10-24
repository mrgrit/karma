param([string]$RenderPath)
$ErrorActionPreference='Stop'
$repo=Split-Path $PSScriptRoot -Parent
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$output=Join-Path ([IO.Path]::GetTempPath()) ('karma-mastery-hud-'+[Guid]::NewGuid().ToString('N')+'.exe')
try {
 $sources=(Get-ChildItem (Join-Path $repo 'client\Launcher') -Filter '*.cs').FullName
 & $compiler /nologo /target:exe /main:MasteryHudTests "/out:$output" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll $sources (Join-Path $PSScriptRoot 'MasteryHudTests.cs')
 if($LASTEXITCODE -ne 0){throw 'HUD test compilation failed'}
 if($RenderPath){& $output $RenderPath (Join-Path $repo 'client')}else{& $output}
 if($LASTEXITCODE -ne 0){throw 'HUD tests failed'}
} finally {if(Test-Path -LiteralPath $output){Remove-Item -LiteralPath $output}}

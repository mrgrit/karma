param([string]$GameRoot)
$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
$client = Join-Path $repo 'client'
$source = Join-Path $client 'Launcher'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $compiler /nologo /target:winexe /optimize+ "/out:$client\KarmaLauncher.exe" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll "$source\KarmaLauncher.cs" "$source\LoadoutDialog.cs" "$source\AuthDialog.cs"
if ($LASTEXITCODE -ne 0) { throw 'C# build failed' }
if ($GameRoot) {
    $target = (Resolve-Path -LiteralPath $GameRoot).Path
    if (!(Test-Path -LiteralPath (Join-Path $target 'App_Executables\Karma.exe'))) { throw 'GameRoot must be an extracted Karma release' }
    Copy-Item -LiteralPath (Join-Path $client 'KarmaLauncher.exe') -Destination $target
    Get-ChildItem -LiteralPath $source -File | Copy-Item -Destination (Join-Path $target 'Launcher')
}
Write-Host 'KarmaLauncher build complete.'

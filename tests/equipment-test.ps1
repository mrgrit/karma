
$ErrorActionPreference='Stop'
$repo=Split-Path $PSScriptRoot -Parent
$source=Join-Path $repo 'client\Launcher'
$output=Join-Path ([IO.Path]::GetTempPath()) ('karma-equipment-validation-'+[Guid]::NewGuid().ToString('N')+'.exe')
$compiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
try {
  & $compiler /nologo /target:exe /main:LoadoutEquipmentTests "/out:$output" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll "$source\KarmaLauncher.cs" "$source\LoadoutDialog.cs" "$source\AuthDialog.cs" "$source\CoinHud.cs" "$source\RoomDirectory.cs" "$source\ResultsWindow.cs" "$source\Chat.cs" "$source\KillFeed.cs" "$source\MenuMusic.cs" "$source\ReleaseUpdate.cs" "$source\UpdateWindow.cs" "$source\ReleaseTrust.cs" "$PSScriptRoot\LoadoutEquipmentTests.cs"
  if($LASTEXITCODE-ne 0){throw 'Equipment test compilation failed'}
  & $output $source
  if($LASTEXITCODE-ne 0){throw 'Equipment UI validation failed'}
} finally {if(Test-Path -LiteralPath $output){Remove-Item -LiteralPath $output}}

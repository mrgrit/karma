param([string]$RenderPath)
$ErrorActionPreference='Stop'
$repo=Split-Path $PSScriptRoot -Parent
$source=Join-Path $repo 'client\Launcher'
$output=Join-Path ([IO.Path]::GetTempPath()) ('karma-lobby-validation-'+[Guid]::NewGuid().ToString('N')+'.exe')
$compiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
try {
  & $compiler /nologo /target:exe /main:KarmaLobbyValidation "/out:$output" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll "$source\KarmaLauncher.cs" "$source\LoadoutDialog.cs" "$source\AuthDialog.cs" "$source\CoinHud.cs" "$source\RoomDirectory.cs" "$PSScriptRoot\lobby_ui_test.cs"
  if($LASTEXITCODE-ne 0){throw 'Lobby test compilation failed'}
  if($RenderPath){& $output $RenderPath}else{& $output}
  if($LASTEXITCODE-ne 0){throw 'Lobby UI validation failed'}
} finally {if(Test-Path -LiteralPath $output){Remove-Item -LiteralPath $output}}

$ErrorActionPreference='Stop'
$repo=Split-Path $PSScriptRoot -Parent
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
# ChatFiles.Support follows the executable directory: isolate every mailbox.
$tempParent=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$testRoot=Join-Path $tempParent ('karma-chat-tests-'+[Guid]::NewGuid().ToString('N'))
$output=Join-Path $testRoot 'ChatUiTests.exe'
New-Item -ItemType Directory -Path $testRoot | Out-Null
try {
  & $compiler /nologo /target:exe "/out:$output" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll "$repo\client\Launcher\Chat.cs" "$repo\client\Launcher\KillFeed.cs" "$PSScriptRoot\ChatUiTests.cs"
  if($LASTEXITCODE -ne 0){throw 'Chat test compilation failed'}
  & $output
  if($LASTEXITCODE -ne 0){throw 'Chat UI validation failed'}
} finally {
  $resolved=[IO.Path]::GetFullPath($testRoot)
  if(-not $resolved.StartsWith($tempParent+'\',[StringComparison]::OrdinalIgnoreCase) -or (Split-Path $resolved -Leaf) -notlike 'karma-chat-tests-*'){throw 'Unexpected test cleanup path'}
  Remove-Item -LiteralPath $resolved -Recurse -Force
}

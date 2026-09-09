param(
  [string]$Version = '0.3.0'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$workspaceRoot = Split-Path -Parent $projectRoot
$outputRoot = Join-Path $workspaceRoot 'PixelProof发布包'
$packageName = "PixelProof-Companion-Windows-x64-v$Version"
$packageDirectory = Join-Path $outputRoot $packageName
$zipPath = Join-Path $outputRoot "$packageName.zip"
$compiler = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$nodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source
$nodeLicense = Join-Path (Split-Path -Parent $nodeExecutable) 'LICENSE'
$playwrightDirectory = Join-Path $projectRoot 'node_modules\playwright-core'
$buildDirectory = Join-Path $PSScriptRoot 'bin'
$iconMaker = Join-Path $buildDirectory 'IconMaker.exe'
$iconPath = Join-Path $buildDirectory 'PixelProof-Companion.ico'

foreach ($requiredPath in @($compiler, $nodeExecutable, $nodeLicense, $playwrightDirectory)) {
  if (-not (Test-Path -LiteralPath $requiredPath)) {
    throw "Missing build dependency: $requiredPath"
  }
}

if (Test-Path -LiteralPath $packageDirectory) {
  throw "Package directory already exists: $packageDirectory"
}
if (Test-Path -LiteralPath $zipPath) {
  throw "Package archive already exists: $zipPath"
}

New-Item -ItemType Directory -Path $buildDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $packageDirectory -Force | Out-Null
$runtimeDirectory = New-Item -ItemType Directory -Path (Join-Path $packageDirectory 'runtime') -Force
$appDirectory = New-Item -ItemType Directory -Path (Join-Path $packageDirectory 'app') -Force
$companionDirectory = New-Item -ItemType Directory -Path (Join-Path $appDirectory.FullName 'companion') -Force

& $compiler /nologo /target:exe /platform:x64 /out:$iconMaker /reference:System.Drawing.dll $PSScriptRoot\IconMaker.cs
if ($LASTEXITCODE -ne 0) { throw 'Icon compilation failed.' }
& $iconMaker $iconPath
if ($LASTEXITCODE -ne 0) { throw 'Icon generation failed.' }

$launcherPath = Join-Path $packageDirectory 'PixelProof Companion.exe'
& $compiler /nologo /target:winexe /platform:x64 /out:$launcherPath /win32icon:$iconPath /reference:System.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll $PSScriptRoot\Program.cs
if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed.' }

Copy-Item -LiteralPath $nodeExecutable -Destination (Join-Path $runtimeDirectory.FullName 'node.exe')
Copy-Item -LiteralPath $nodeLicense -Destination (Join-Path $runtimeDirectory.FullName 'NODE-LICENSE.txt')
Copy-Item -LiteralPath (Join-Path $projectRoot 'companion\server.cjs') -Destination (Join-Path $companionDirectory.FullName 'server.cjs')
Copy-Item -LiteralPath (Join-Path $projectRoot 'node_modules') -Destination (Join-Path $appDirectory.FullName 'node_modules') -Recurse
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '使用说明.txt') -Destination (Join-Path $packageDirectory '使用说明.txt')

Compress-Archive -LiteralPath $packageDirectory -DestinationPath $zipPath -CompressionLevel Optimal
$hash = Get-FileHash -Algorithm SHA256 -LiteralPath $zipPath
$hashLine = $hash.Hash.ToLowerInvariant() + "  " + (Split-Path -Leaf $zipPath)
[System.IO.File]::WriteAllText((Join-Path $outputRoot "$packageName.sha256.txt"), $hashLine + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))

$size = (Get-Item -LiteralPath $zipPath).Length
[pscustomobject]@{
  Package = $zipPath
  SizeMiB = [math]::Round($size / 1MB, 2)
  Sha256 = $hash.Hash.ToLowerInvariant()
}

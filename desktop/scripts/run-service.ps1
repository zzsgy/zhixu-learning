<#
.SYNOPSIS
Start the Zhixu service supervisor with a stable local runtime.
#>

$ErrorActionPreference = "Stop"
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDirectory = Split-Path -Parent $scriptDirectory
$runnerPath = Join-Path $projectDirectory "service-runner.mjs"
$electronPath = Join-Path $projectDirectory "node_modules\electron\dist\electron.exe"
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$nodePath = if ($nodeCommand -and $nodeCommand.Source -notmatch '\\.cache\\codex-runtimes\\') {
  $nodeCommand.Source
} else {
  $null
}

if (-not (Test-Path -LiteralPath $runnerPath)) {
  throw "The Zhixu service runner was not found: $runnerPath"
}

if ($nodePath) {
  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  & $nodePath --disable-warning=ExperimentalWarning $runnerPath
  exit $LASTEXITCODE
}

if (-not (Test-Path -LiteralPath $electronPath)) {
  throw "Neither a stable Node.js installation nor the local Electron runtime is available."
}

$env:ELECTRON_RUN_AS_NODE = "1"
$electronProcess = Start-Process `
  -FilePath $electronPath `
  -ArgumentList @("--disable-warning=ExperimentalWarning", $runnerPath) `
  -WindowStyle Hidden `
  -Wait `
  -PassThru
exit $electronProcess.ExitCode

<#
.SYNOPSIS
Install the Zhixu automatic-start task for the current Windows user.

.DESCRIPTION
The scheduled task starts service-runner.mjs when the user logs on.
The runner restarts the local service after a crash, while Task Scheduler
restores the runner after a Windows restart. The task keeps limited privileges.
#>

$ErrorActionPreference = "Stop"

# taskName is the stable name shown in Windows Task Scheduler.
$taskName = "ZhixuLocalKnowledge"
# scriptFilePath is the absolute path reported by Windows PowerShell.
$scriptFilePath = $MyInvocation.MyCommand.Path
# projectDirectory falls back to the current directory for restricted hosts.
$projectDirectory = if ($scriptFilePath) {
  Split-Path -Parent (Split-Path -Parent $scriptFilePath)
} else {
  (Get-Location).Path
}
# runnerPath is the absolute path of the Zhixu service supervisor.
$runnerPath = Join-Path $projectDirectory "service-runner.mjs"
# nodeCommand contains the Node.js executable available to the current user.
$nodeCommand = Get-Command node.exe -ErrorAction Stop
# nodePath is the absolute executable path stored in the scheduled task.
$nodePath = $nodeCommand.Source

if (-not (Test-Path -LiteralPath $runnerPath)) {
  throw "The Zhixu service runner was not found: $runnerPath"
}

# actionArguments are the arguments passed to Node.js by Task Scheduler.
$actionArguments = "--disable-warning=ExperimentalWarning `"$runnerPath`""
# taskAction is the local process started after Windows logon.
$taskAction = New-ScheduledTaskAction `
  -Execute $nodePath `
  -Argument $actionArguments `
  -WorkingDirectory $projectDirectory
# taskTrigger starts Zhixu whenever the current user logs on.
$taskTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
# taskSettings enable delayed recovery, crash retries, and single-instance behavior.
$taskSettings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew
# taskPrincipal limits execution to the current interactive user without elevation.
$taskPrincipal = New-ScheduledTaskPrincipal `
  -UserId $env:USERNAME `
  -LogonType Interactive `
  -RunLevel Limited
# scheduledTask combines the action, trigger, settings, and user identity.
$scheduledTask = New-ScheduledTask `
  -Action $taskAction `
  -Trigger $taskTrigger `
  -Settings $taskSettings `
  -Principal $taskPrincipal `
  -Description "Zhixu local knowledge service with automatic recovery."

Register-ScheduledTask `
  -TaskName $taskName `
  -InputObject $scheduledTask `
  -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

# installedTask is the final registered task state.
$installedTask = Get-ScheduledTask -TaskName $taskName
Write-Host "Zhixu automatic start is installed."
Write-Host "Task name: $($installedTask.TaskName)"
Write-Host "Current state: $($installedTask.State)"

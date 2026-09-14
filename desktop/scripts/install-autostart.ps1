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
# serviceLauncherPath selects a stable Node or the project Electron runtime.
$serviceLauncherPath = Join-Path $projectDirectory "scripts\run-service.ps1"
# powershellPath is the stable inbox Windows host used by Task Scheduler.
$powershellPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"

if (-not (Test-Path -LiteralPath $serviceLauncherPath)) {
  throw "The Zhixu service launcher was not found: $serviceLauncherPath"
}

# actionArguments keep the scheduled process hidden and independent of profile PATH changes.
$actionArguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$serviceLauncherPath`""
# taskAction is the local process started after Windows logon.
$taskAction = New-ScheduledTaskAction `
  -Execute $powershellPath `
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

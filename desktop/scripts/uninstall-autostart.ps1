<#
.SYNOPSIS
Remove the Zhixu automatic-start task for the current Windows user.
#>

$ErrorActionPreference = "Stop"

# taskName must match the stable name used by the installer.
$taskName = "ZhixuLocalKnowledge"
# existingTask is the optional registered Zhixu task.
$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($null -eq $existingTask) {
  Write-Host "The Zhixu automatic-start task is not installed."
  exit 0
}

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
Write-Host "The Zhixu automatic-start task has been removed."

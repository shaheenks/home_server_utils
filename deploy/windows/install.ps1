#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Install/update the status agent on Windows as a startup scheduled task running as SYSTEM.
.EXAMPLE
    .\deploy\windows\install.ps1 -Config config\windows.json
#>
param(
    [Parameter(Mandatory)] [string]$Config,
    # python.exe installed for all users; SYSTEM can't run the Microsoft Store alias
    [string]$Python = (Get-Command python -ErrorAction SilentlyContinue).Source
)
$ErrorActionPreference = 'Stop'

$repo     = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$agentDir = Join-Path $env:ProgramFiles 'status-agent'
$etcDir   = Join-Path $env:ProgramData 'status-agent'
$taskName = 'status-agent'

if (-not $Python -or $Python -like '*\WindowsApps\*') {
    throw 'Pass -Python with the full path to a python.exe installed for all users, e.g. -Python C:\Python314\python.exe'
}
$Config = (Resolve-Path $Config).Path

New-Item -ItemType Directory -Force $agentDir, $etcDir | Out-Null
# The config dir holds the power token: SYSTEM and Administrators only.
icacls $etcDir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
Copy-Item (Join-Path $repo 'agent\agent.py') $agentDir -Force
Copy-Item $Config (Join-Path $etcDir 'config.json') -Force

$arguments = "`"$agentDir\agent.py`" --config `"$etcDir\config.json`" --log `"$etcDir\agent.log`""
$action    = New-ScheduledTaskAction -Execute $Python -Argument $arguments -WorkingDirectory $agentDir
$trigger   = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings  = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $taskName
}
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

Start-Sleep -Seconds 2
Invoke-RestMethod http://127.0.0.1:8765/ping | ConvertTo-Json -Compress
Write-Host 'Installed. Now route /agent/ to http://127.0.0.1:8765 in the Cloudflare Tunnel (see README).'

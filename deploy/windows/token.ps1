#Requires -RunAsAdministrator
# Generate a new power token (enables shutdown/reboot) and restart the agent.
$ErrorActionPreference = 'Stop'

$tokenFile = Join-Path $env:ProgramData 'status-agent\power_token'
$bytes = [byte[]]::new(32)
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$token = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
# Inherits the SYSTEM/Administrators-only ACL set on the folder by install.ps1.
Set-Content -Path $tokenFile -Value $token -NoNewline -Encoding ascii

Stop-ScheduledTask -TaskName 'status-agent'
Start-ScheduledTask -TaskName 'status-agent'
Write-Host 'New power token (save it in your password manager):'
Write-Host $token

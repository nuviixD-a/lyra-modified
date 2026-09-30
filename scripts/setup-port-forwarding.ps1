# One-time setup (run as Administrator):
#   powershell -ExecutionPolicy Bypass -File scripts/setup-port-forwarding.ps1
#
# - forwards Windows :80/:443 to the current WSL IP (lyra's Caddy)
# - opens Windows Firewall for inbound 80/443
# - registers a logon task that re-points the forwards when WSL's IP changes

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot   # repo root when script lives in scripts/
$refresh = Join-Path $repo "scripts\update-portproxy.ps1"

# 1. initial forwards
& powershell -ExecutionPolicy Bypass -File $refresh

# 2. firewall: allow inbound 80/443 (TCP + HTTP/3 quic not needed for caddy h2)
foreach ($port in 80, 443) {
    $name = "lyra-port$port"
    if (-not (Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName $name -Direction Inbound -Action Allow `
            -Protocol TCP -LocalPort $port | Out-Null
        Write-Host "firewall rule added: $name"
    } else {
        Write-Host "firewall rule exists: $name"
    }
}

# 3. logon task to refresh forwards on reboot / wsl ip change
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$refresh`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest

if (Get-ScheduledTask -TaskName "LyraWslPortProxy" -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName "LyraWslPortProxy" -Confirm:$false
}
Register-ScheduledTask -TaskName "LyraWslPortProxy" -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal -Description "Refresh WSL port forwards for lyra" | Out-Null
Write-Host "scheduled task 'LyraWslPortProxy' registered (runs at logon, as admin)"

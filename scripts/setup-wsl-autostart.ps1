# Registers a logon task that starts the lyra WSL VM at Windows boot
# (hidden, no console window). WSL systemd then brings up pm2 (lyra,
# cloudsync, isao, tls-approval), caddy, nuru/mochi workers, and eturnal
# automatically. Does NOT need admin.
#
# Run: powershell -ExecutionPolicy Bypass -File scripts/setup-wsl-autostart.ps1

$ErrorActionPreference = "Stop"

$vbsPath = Join-Path $env:APPDATA "lyra-wsl-start.vbs"
Set-Content -Path $vbsPath -Value @'
' hidden WSL boot - keeps the lyra VM running from logon
Set shell = CreateObject("WScript.Shell")
' hold a session open forever so WSL never idles out
shell.Run "wsl.exe -e bash -lc ""exec sleep infinity""", 0, False
' early health poke so the stack warms up immediately
shell.Run "wsl.exe -e bash -lc ""sleep 10; curl -fs http://127.0.0.1:4444/health > /dev/null 2>&1 || true""", 0, False
' pm2 resurrect restores lyra/cloudsync/isao/tls-approval from its dump;
' caddy/eturnal/nuru/mochi are systemd-enabled and start with WSL systemd
'@
Write-Host "vbs written: $vbsPath"

$taskName = "LyraWslAutostart"
$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$vbsPath`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Seconds 30) -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 1)

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings | Out-Null
Write-Host "scheduled task '$taskName' registered (starts WSL + lyra stack at logon)"

# start it now so we do not have to wait for the next logon
Start-ScheduledTask -TaskName $taskName
Write-Host "task started"

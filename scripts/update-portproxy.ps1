# Re-points the Windows -> WSL port forwards for lyra (ports 80/443).
# Run at logon via Task Scheduler, or manually:
#   powershell -ExecutionPolicy Bypass -File update-portproxy.ps1

$ErrorActionPreference = "Stop"

function Get-WslIp {
    $output = (wsl.exe hostname -I) 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $output) { return $null }
    $firstToken = ($output -split "\s+") | Where-Object { $_ } | Select-Object -First 1
    if (-not $firstToken) { return $null }
    return $firstToken.Trim()
}

$wslIp = Get-WslIp
if (-not $wslIp -or $wslIp -notmatch '^\d+\.\d+\.\d+\.\d+$') {
    Write-Warning "WSL is not running or reported no IPv4 address; skipping."
    exit 1
}

Write-Host "WSL IP: $wslIp"

$existing = netsh interface portproxy show all | Out-String
foreach ($port in 80, 443) {
    $ruleExists = $existing -match "0\.0\.0\.0\s+$port\s+.*$wslIp\s+$port"
    if ($ruleExists) {
        Write-Host "port $port -> ${wslIp}:$port already configured"
        continue
    }
    netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=$port 2>$null | Out-Null
    netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=$port connectaddress=$wslIp connectport=$port | Out-Null
    Write-Host "port $port -> ${wslIp}:$port configured"
}

netsh interface portproxy show all

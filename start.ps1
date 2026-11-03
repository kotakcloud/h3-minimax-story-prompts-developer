$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

$Port = 38217

function Get-PortPids([int]$ListenPort) {
  $pids = @()
  try {
    $pids = @(
      Get-NetTCPConnection -LocalPort $ListenPort -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique
    )
  } catch {
    $pids = @()
  }

  if ($pids.Count -eq 0) {
    $matches = netstat -ano | Select-String -Pattern ":$ListenPort\s+.*LISTENING"
    foreach ($match in $matches) {
      $parts = ($match.Line -split "\s+") | Where-Object { $_ -ne "" }
      if ($parts.Count -gt 0) {
        $pids += [int]$parts[-1]
      }
    }
    $pids = $pids | Select-Object -Unique
  }

  return @($pids | Where-Object { $_ -and $_ -ne 0 })
}

# Up to 3 passes: stop whatever listens on the port, then look again.
for ($pass = 1; $pass -le 3; $pass++) {
  $occupied = Get-PortPids $Port
  if ($occupied.Count -eq 0) { break }
  Write-Host "Port $Port is in use by PID $($occupied -join ', '). Stopping it."
  foreach ($processId in $occupied) {
    try {
      Stop-Process -Id $processId -Force -ErrorAction Stop
    } catch {
      Write-Host "  Could not stop PID ${processId}: $($_.Exception.Message)"
    }
  }
  Start-Sleep -Seconds 1
}

# The server listens on 0.0.0.0, so test that address. A holder the loop could not stop (a process run as
# administrator, WSL, Docker, a port reservation) would otherwise make the server crash on start.
$free = $true
try {
  $probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $Port)
  $probe.Start()
  $probe.Stop()
} catch {
  $free = $false
}
if (-not $free) {
  Write-Host ""
  Write-Host "Port $Port is still taken and could not be freed (PID $((Get-PortPids $Port) -join ', '))." -ForegroundColor Red
  Write-Host "Close the window running it (it may run as administrator), or reboot, then start again." -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 1
}

if (-not (Test-Path "node_modules")) {
  npm install
}

Write-Host "Starting H3 Story Prompt Workshop on port $Port."
npm run dev
Read-Host "Press Enter to close"

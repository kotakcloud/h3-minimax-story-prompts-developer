$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

$Port = 48217

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

# Stop leftover Next dev processes from this project (the next-server child can outlive its parent).
$projectPath = [regex]::Escape($PSScriptRoot)
$stale = @(
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match $projectPath -and $_.CommandLine -match "next" }
)
foreach ($proc in $stale) {
  Write-Host "Stopping leftover Next process PID $($proc.ProcessId)."
  Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
}

$occupied = Get-PortPids $Port
if ($occupied.Count -gt 0) {
  Write-Host "Port $Port is in use by PID $($occupied -join ', '). Stopping it."
  foreach ($processId in $occupied) {
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Seconds 1
  $still = Get-PortPids $Port
  if ($still.Count -gt 0) {
    Write-Host "Port $Port still busy. Forcing stop."
    foreach ($processId in $still) {
      Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
  }
}

# Wait for the OS to release the port before starting.
$deadline = (Get-Date).AddSeconds(15)
while ((Get-PortPids $Port).Count -gt 0 -and (Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 500
}
if ((Get-PortPids $Port).Count -gt 0) {
  throw "Port $Port is still in use after 15 seconds."
}

if (-not (Test-Path "node_modules")) {
  npm install
}

Write-Host "Starting H3 Story Prompt Workshop on port $Port."
npm run dev

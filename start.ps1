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

if (-not (Test-Path "node_modules")) {
  npm install
}

Write-Host "Starting H3 Story Prompt Workshop on port $Port."
npm run dev

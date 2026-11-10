# Open the app from anywhere: starts the production server (start.ps1 -Prod) in its own window, waits until it
# answers, then runs a Cloudflare quick tunnel here. The https://<random>.trycloudflare.com address appears below.
# Close this window (or Ctrl+C) to stop the tunnel; close the server window to stop the app.
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

$Port = 38217

# cloudflared: on PATH, or where its Windows installer puts it.
$cloudflared = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $cloudflared) {
  $cloudflared = @(
    "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe",
    "$env:ProgramFiles\cloudflared\cloudflared.exe"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $cloudflared) {
  Write-Host "cloudflared was not found. Install it with: winget install Cloudflare.cloudflared" -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 1
}

Write-Host "Starting the app (production mode) in a new window; it builds first, about a minute."
$wasRunning = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue).Count -gt 0
Start-Process powershell -ArgumentList @("-ExecutionPolicy", "Bypass", "-File", "`"$PSScriptRoot\start.ps1`"", "-Prod")

# A server already on the port (e.g. the dev server) is stopped by start.ps1; wait for that first, so its answer is
# not mistaken for the new one.
if ($wasRunning) {
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    if (@(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue).Count -eq 0) { break }
  }
}

# Wait for the server (up to 5 minutes: the build comes first).
$ready = $false
for ($i = 0; $i -lt 150; $i++) {
  Start-Sleep -Seconds 2
  try {
    $response = Invoke-WebRequest -Uri "http://localhost:$Port/" -UseBasicParsing -TimeoutSec 3
    if ($response.StatusCode -eq 200) { $ready = $true; break }
  } catch {}
}
if (-not $ready) {
  Write-Host "The app did not answer on port $Port. Look at the server window for errors." -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit 1
}

Write-Host ""
Write-Host "App is up. Starting the tunnel: open the https://....trycloudflare.com address printed below." -ForegroundColor Green
Write-Host "Anyone with that address can open the app; close this window to stop the tunnel." -ForegroundColor Yellow
Write-Host ""
& $cloudflared tunnel --url "http://localhost:$Port"
Read-Host "Press Enter to close"

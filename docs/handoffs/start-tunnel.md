# Handoff: add `start-tunnel.ps1` (production server + Cloudflare quick tunnel in one go)

Goal: one script the owner can run to open this app from anywhere. It starts the app in **production mode** in its own
window, waits until it answers, then runs a **Cloudflare quick tunnel** and prints the
`https://<random>.trycloudflare.com` address.

This was already done in another project (H3 Story Prompt Workshop, Next.js, port 38217). Copy that pattern here, and
adapt it to this app. Use this project's own port from its `start.ps1` everywhere below in place of `<PORT>`.

## 1. `start.ps1`: add a `-Prod` switch

The project already has `start.ps1`: it frees the port, probes it, installs dependencies if needed and starts the dev
server. Keep all of that and add:

- At the very top (before `$ErrorActionPreference`):

  ```powershell
  # -Prod: build once and run the production server (no hot reload; faster, and nothing for a tunnel to break).
  # Without it: the dev server, which reloads on code changes.
  param([switch]$Prod)
  ```

- Replace the final "start the dev server" line with:

  ```powershell
  if ($Prod) {
    Write-Host "Production mode: building first (takes a minute)."
    npm run build
    if ($LASTEXITCODE -ne 0) {
      Write-Host "Build failed; see the errors above." -ForegroundColor Red
      Read-Host "Press Enter to close"
      exit 1
    }
    npm start
  } else {
    npm run dev
  }
  Read-Host "Press Enter to close"
  ```

- `package.json` must have a `start` script on the same port, e.g. for Next.js:
  `"start": "next start --hostname 0.0.0.0 --port <PORT>"` (and `"build": "next build"`).
  - If this app is not Next.js, use its own build and production-start commands.
  - If it has no separate production mode, skip `-Prod` and have `start-tunnel.ps1` start plain `start.ps1`.

## 2. Allow the tunnel host (Next.js dev mode only)

The tunnel's host must be allowed, or the dev server blocks its scripts and the page stays empty.

- Production mode doesn't need this. Add it anyway, so the tunnel also works when someone runs the dev server.
- In `next.config.ts` (or `.js`), add `"*.trycloudflare.com"` to `allowedDevOrigins`. If the list already exists (for example, LAN addresses), append to it.

  ```ts
  allowedDevOrigins: [/* existing entries */ "*.trycloudflare.com"],
  ```

## 3. New file `start-tunnel.ps1` in the project root

Use this as is, changing only `$Port`:

```powershell
# Open the app from anywhere: starts the production server (start.ps1 -Prod) in its own window, waits until it
# answers, then runs a Cloudflare quick tunnel here. The https://<random>.trycloudflare.com address appears below.
# Close this window (or Ctrl+C) to stop the tunnel; close the server window to stop the app.
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

$Port = <PORT>

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
```

Notes:
- **If `/` doesn't return 200:** the readiness check expects `/` to return 200. If this app's root redirects or needs a login, point the check at a URL that does answer 200, such as a health route.
- **Point the tunnel at `localhost`, not the LAN address,** so it keeps working when the PC's address changes.

## 4. Check it

1. Parse-check both scripts without running them:

   ```powershell
   $errs=$null; $tok=$null; [System.Management.Automation.Language.Parser]::ParseFile("start-tunnel.ps1",[ref]$tok,[ref]$errs) | Out-Null; $errs
   ```

   Do the same for `start.ps1`.
2. Run `npm run build` once to make sure production builds cleanly.
3. Don't start the tunnel yourself. It makes the app public, so let the owner run it.

## 5. Docs

Add a short section to `usage.md` (and to `README.md` if the project keeps one). It should cover:

- how to run it: `powershell -ExecutionPolicy Bypass -File start-tunnel.ps1`;
- it needs `cloudflared` (`winget install Cloudflare.cloudflared`);
- the address changes every run;
- anyone with the address can open the app, so close the tunnel window when done;
- closing the server window stops the app;
- production mode doesn't reload on code changes, so rerun the script after changing code.

Commit when verified; don't push.

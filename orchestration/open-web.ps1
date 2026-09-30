# GLEIPNIR Web launcher (double-click "GLEIPNIR Web.cmd" in the repo root).
# Opens the evidence library at http://localhost:8081/. If it is not up, starts
# Docker Desktop, then starts the stack on its EXISTING volumes (never up.sh: it
# would re-create channels the ledger already holds; the same command as the
# Bench app's restore path), waits for the gateway, and opens the browser.
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
$url = 'http://localhost:8081/'

function Healthy {
    try { (Invoke-WebRequest "${url}healthz" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch { $false }
}

if (-not (Healthy)) {
    if (-not (Get-Process 'Docker Desktop' -ErrorAction SilentlyContinue)) {
        Write-Host 'Starting Docker Desktop...'
        Start-Process 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
    }
    Write-Host 'Waiting for the Docker engine (up to 3 min)...'
    $deadline = (Get-Date).AddMinutes(3)
    $engine = $false
    while ((Get-Date) -lt $deadline) {
        cmd /c 'docker info >nul 2>&1'
        if ($LASTEXITCODE -eq 0) { $engine = $true; break }
        Start-Sleep -Seconds 3
    }
    if (-not $engine) { Write-Host 'Docker did not start.'; Read-Host 'Press Enter to close'; exit 1 }

    Write-Host 'Starting the GLEIPNIR stack on its existing volumes...'
    $wslRepo = '/mnt/' + $repo.Substring(0, 1).ToLower() + $repo.Substring(2).Replace('\', '/')
    # No double quotes inside: Windows PowerShell 5.1 cannot pass them to a native exe intact.
    $script = "cd $wslRepo && source orchestration/lib.sh && V=`$(grep ^VARIANT= network/compose/.env | cut -d= -f2) && P= && case `$V in anchoring) P=--profile\ anchoring;; parallel-anchored) P=--profile\ parallel-anchored;; esac && compose `$P up -d --no-build && curl -sf --retry 60 --retry-delay 2 --retry-all-errors localhost:3000/healthz >/dev/null && echo stack up: `$V"
    wsl -d Ubuntu-22.04 -u root --exec bash -lc $script
    if (-not (Healthy)) { Write-Host 'The web app did not come up; see the output above.'; Read-Host 'Press Enter to close'; exit 1 }
}

# Own Chrome profile, app window: its cache never mixes with the everyday browser (a pre-redesign
# SPA cached there kept showing up on 2026-09-29). Falls back to the default browser.
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
if (Test-Path $chrome) {
    $profile = Join-Path $env:LOCALAPPDATA 'GleipnirWeb'
    Start-Process $chrome -ArgumentList "--user-data-dir=`"$profile`"", '--no-first-run', '--no-default-browser-check', "--app=$url"
} else {
    Start-Process $url
}

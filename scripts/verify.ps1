# Runs every check the project has and stops at the first failure.
#
#   pwsh scripts/verify.ps1          typecheck, all tests, production build
#   pwsh scripts/verify.ps1 -E2E     also the end-to-end run against the local Supabase stack
#   pwsh scripts/verify.ps1 -OnlyE2E only the end-to-end run, on the build already made
#
# Exit code 0 means everything passed. Nothing is committed, pushed or deployed.
param([switch]$E2E, [switch]$OnlyE2E)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

function Step([string]$name, [scriptblock]$run) {
  Write-Host "`n== $name" -ForegroundColor Cyan
  & $run
  if ($LASTEXITCODE -ne 0) {
    Write-Host "FAILED: $name" -ForegroundColor Red
    exit 1
  }
}

if (-not $OnlyE2E) {
  if (-not (Test-Path node_modules)) { Step 'Install packages' { npm ci } }
  Step 'Typecheck' { npm run typecheck }
  Step 'Tests' { npm test }
  Step 'Production build' { npm run build }
}

if ($E2E -or $OnlyE2E) {
  # Node and npm print warnings on stderr; they are not failures, so only exit codes count from here
  $ErrorActionPreference = 'Continue'
  if (-not (Test-Path .env.local)) {
    Write-Host 'FAILED: no .env.local. See README, "Local end-to-end run".' -ForegroundColor Red
    exit 1
  }
  try {
    Invoke-WebRequest -Uri 'http://127.0.0.1:54321/auth/v1/health' -TimeoutSec 8 | Out-Null
  } catch {
    Write-Host 'FAILED: the local Supabase gateway is not answering on port 54321.' -ForegroundColor Red
    Write-Host 'Try:  docker start supabase_kong_localdb   (see STATUS.md, "How to run it")'
    exit 1
  }
  if (Get-NetTCPConnection -LocalPort 3200 -State Listen -ErrorAction SilentlyContinue) {
    Write-Host 'FAILED: something is already using port 3200. Stop it and run this again.' -ForegroundColor Red
    exit 1
  }

  Write-Host "`n== End-to-end run" -ForegroundColor Cyan
  $server = Start-Process -FilePath 'npm.cmd' -ArgumentList 'run', 'start', '--', '-p', '3200' -PassThru -WindowStyle Hidden
  try {
    $up = $false
    foreach ($attempt in 1..40) {
      try {
        Invoke-WebRequest -Uri 'http://127.0.0.1:3200/api/health' -TimeoutSec 3 | Out-Null
        $up = $true
        break
      } catch {
        Start-Sleep -Seconds 1
      }
    }
    if (-not $up) {
      Write-Host 'FAILED: the app did not start on port 3200.' -ForegroundColor Red
      exit 1
    }
    npm run e2e:local
    $e2eExit = $LASTEXITCODE
  } catch {
    Write-Host "FAILED: End-to-end run: $($_.Exception.Message)" -ForegroundColor Red
    $e2eExit = 1
  } finally {
    # npm starts node underneath it, so stop the whole tree
    taskkill /PID $server.Id /T /F 2>$null | Out-Null
  }
  if ($e2eExit -ne 0) {
    Write-Host 'FAILED: End-to-end run' -ForegroundColor Red
    exit 1
  }
}

Write-Host "`nAll checks passed." -ForegroundColor Green

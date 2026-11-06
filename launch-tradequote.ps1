# TradeQuote PRO one-click desktop launcher
# Starts the production server (building first if needed), opens the app in its
# own window, and stops the server when that window is closed.
#
# Scheduled jobs (daily alerts, trial emails) don't run from here. They run on the
# deployed host, and the desktop app shares that host's Supabase project.
$projectDir = $PSScriptRoot
$port = 3001
$hostAddress = "127.0.0.1"
$url = "http://localhost:$port"
$dataDir = Join-Path $env:LOCALAPPDATA "TradeQuotePRO"
$logFile = Join-Path $dataDir "server.log"
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
Set-Location $projectDir

function Test-Server {
    try { (Invoke-WebRequest -Uri "http://${hostAddress}:$port/api/health" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch { $false }
}

function Stop-WithMessage([string]$message) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($message, "TradeQuote PRO") | Out-Null
    exit 1
}

$server = $null
if (-not (Test-Server)) {
    # Checks the file is there; its contents stay private
    if (-not (Test-Path (Join-Path $projectDir ".env.local"))) {
        Stop-WithMessage "TradeQuote PRO needs its settings file. Copy .env.example to .env.local in $projectDir and fill it in."
    }

    # Links in emails and Stripe redirects must come back to this port. Next builds
    # this value in, so it has to be set for the build as well as the server.
    $env:NEXT_PUBLIC_SITE_URL = $url

    $installed = Join-Path $projectDir "node_modules\.package-lock.json"
    $lockfile = Join-Path $projectDir "package-lock.json"
    if (-not (Test-Path $installed) -or (Get-Item $lockfile).LastWriteTime -gt (Get-Item $installed).LastWriteTime) {
        npm ci --no-audit --no-fund *>> $logFile
        if ($LASTEXITCODE -ne 0) { Stop-WithMessage "TradeQuote PRO couldn't install its packages. See $logFile" }
    }

    # Rebuild when there is no build yet, the source is newer than it, or it was
    # built for a different site URL (a manual npm run build, say)
    $buildId = Join-Path $projectDir ".next\BUILD_ID"
    $builtFor = Join-Path $projectDir ".next\launcher-site-url.txt"
    $stale = -not (Test-Path $buildId) -or -not (Test-Path $builtFor)
    if (-not $stale) { $stale = (Get-Content $builtFor -Raw).Trim() -ne $url }
    if (-not $stale) {
        $built = (Get-Item $buildId).LastWriteTime
        $sourceDirs = "app", "components", "lib", "public", "scripts"
        $sourceFiles = "middleware.ts", "next.config.js", "package.json", "package-lock.json", "tailwind.config.js", "postcss.config.js", "tsconfig.json", ".env.local"
        $sources = @(Get-ChildItem -Path $sourceDirs -Recurse -File -ErrorAction SilentlyContinue) + @(Get-Item -Path $sourceFiles -ErrorAction SilentlyContinue)
        $stale = [bool]($sources | Where-Object { $_.LastWriteTime -gt $built } | Select-Object -First 1)
    }
    if ($stale) {
        npm run build *>> $logFile
        if ($LASTEXITCODE -ne 0) { Stop-WithMessage "TradeQuote PRO couldn't build. See $logFile" }
        Set-Content -Path $builtFor -Value $url
    }

    $server = Start-Process npm.cmd -ArgumentList "start", "--", "-H", $hostAddress, "-p", "$port" -WorkingDirectory $projectDir `
        -WindowStyle Hidden -PassThru -RedirectStandardOutput $logFile -RedirectStandardError "$logFile.err"

    for ($i = 0; $i -lt 60 -and -not (Test-Server); $i++) { Start-Sleep -Seconds 1 }
    if (-not (Test-Server)) {
        Stop-WithMessage "TradeQuote PRO didn't start. See $logFile"
    }
}

# Open as a standalone app window (Edge, then Chrome, else the default browser)
$browser = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($browser) {
    $profileDir = Join-Path $dataDir "window"
    $window = Start-Process $browser -ArgumentList "--app=$url", "--user-data-dir=`"$profileDir`"", "--no-first-run" -PassThru
    $window.WaitForExit()
    if ($server) {
        # Stop the server and the node process tree npm started
        & taskkill /PID $server.Id /T /F | Out-Null
    }
} else {
    Start-Process $url
}

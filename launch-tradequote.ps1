# TradeQuote PRO one-click desktop launcher
# Starts everything the app needs, opens it in its own window, and stops the server when
# that window is closed. Safe to click twice: a second click just opens another window.
#
# A desktop install (scripts/install-desktop-app.ps1) keeps its own local database in a
# "database" folder next to the app. When that folder is there, this starts Docker Desktop
# and the database first. A copy that uses a hosted Supabase project has no such folder.
# Scheduled jobs (daily alerts, trial emails) don't run from here: they run on the deployed host.
# Runs on Windows PowerShell 5.1, which is what the desktop shortcut uses.
$projectDir = $PSScriptRoot
$port = 3001
$hostAddress = "127.0.0.1"
$url = "http://localhost:$port"
$dataDir = Join-Path $env:LOCALAPPDATA "TradeQuotePRO"
$logFile = Join-Path $dataDir "server.log"
$databaseDir = Join-Path (Split-Path $projectDir -Parent) "database"
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
Set-Location $projectDir

$notice = $null
function Show-Starting {
    try {
        Add-Type -AssemblyName System.Windows.Forms, System.Drawing
        $script:notice = New-Object System.Windows.Forms.NotifyIcon
        $icon = Join-Path $projectDir "public\tradequote.ico"
        $script:notice.Icon = if (Test-Path $icon) { New-Object System.Drawing.Icon $icon } else { [System.Drawing.SystemIcons]::Application }
        $script:notice.Text = "TradeQuote PRO is starting"
        $script:notice.Visible = $true
        $script:notice.ShowBalloonTip(15000, "TradeQuote PRO", "Starting up. The first start after a restart can take a minute or two.", "Info")
    } catch { $script:notice = $null }
}
function Hide-Starting {
    if ($script:notice) { $script:notice.Visible = $false; $script:notice.Dispose(); $script:notice = $null }
}

function Test-Server {
    try { (Invoke-WebRequest -Uri "http://${hostAddress}:$port/api/health" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch { $false }
}

function Stop-WithMessage([string]$message) {
    Hide-Starting
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($message, "TradeQuote PRO") | Out-Null
    exit 1
}

function Test-Docker {
    & docker info *> $null
    $LASTEXITCODE -eq 0
}

# Docker Desktop, then the local Supabase stack, then any database changes this version needs
function Start-LocalDatabase {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Stop-WithMessage "TradeQuote PRO keeps its data in a local database that needs Docker Desktop, and Docker Desktop isn't installed."
    }
    if (-not (Test-Docker)) {
        $dockerApp = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
        if (Test-Path $dockerApp) { Start-Process $dockerApp }
        for ($i = 0; $i -lt 90 -and -not (Test-Docker); $i++) { Start-Sleep -Seconds 2 }
        if (-not (Test-Docker)) { Stop-WithMessage "Docker Desktop didn't start. Open it, wait until it says it's running, then click TradeQuote PRO again." }
    }
    if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) {
        Stop-WithMessage "TradeQuote PRO needs the Supabase command-line tool to run its local database. Install it with: npm install -g supabase"
    }
    & supabase start --workdir $databaseDir *>> $logFile
    if ($LASTEXITCODE -ne 0) { Stop-WithMessage "TradeQuote PRO's local database didn't start. See $logFile" }
    # Only ever adds what this version of the app needs and the database doesn't have yet
    & supabase migration up --db-url "postgresql://postgres:postgres@127.0.0.1:54322/postgres" *>> $logFile
    if ($LASTEXITCODE -ne 0) { Stop-WithMessage "TradeQuote PRO couldn't update its local database. See $logFile" }
}

$server = $null
if (-not (Test-Server)) {
    # One launcher starts things at a time. A second click waits for it, then just opens a window.
    $startup = New-Object System.Threading.Mutex($false, "TradeQuotePRO-Launcher")
    $owned = $false
    try { $owned = $startup.WaitOne([TimeSpan]::FromMinutes(10)) } catch [System.Threading.AbandonedMutexException] { $owned = $true }

    if (-not (Test-Server)) {
        Show-Starting

        # Checks the file is there; its contents stay private
        if (-not (Test-Path (Join-Path $projectDir ".env.local"))) {
            Stop-WithMessage "TradeQuote PRO needs its settings file. Copy .env.example to .env.local in $projectDir and fill it in."
        }

        if (Test-Path (Join-Path $databaseDir "supabase\config.toml")) { Start-LocalDatabase }

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
        Hide-Starting
    }
    if ($owned) { $startup.ReleaseMutex() }
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

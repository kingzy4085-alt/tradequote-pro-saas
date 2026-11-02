# TradeQuote PRO one-click desktop launcher
# Starts the production server (building first if needed), opens the app in its
# own window, and stops the server when that window is closed.
$projectDir = $PSScriptRoot
$port = 3001
$url = "http://localhost:$port"
$dataDir = Join-Path $env:LOCALAPPDATA "TradeQuotePRO"
$logFile = Join-Path $dataDir "server.log"
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
Set-Location $projectDir

function Test-Server {
    try { (Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch { $false }
}

$server = $null
if (-not (Test-Server)) {
    if (-not (Test-Path (Join-Path $projectDir "node_modules"))) {
        npm ci --no-audit --no-fund *>> $logFile
    }
    # Rebuild when there is no build yet or the source is newer than it
    $buildId = Join-Path $projectDir ".next\BUILD_ID"
    $stale = -not (Test-Path $buildId)
    if (-not $stale) {
        $built = (Get-Item $buildId).LastWriteTime
        $stale = [bool](Get-ChildItem -Path app, lib, public -Recurse -File | Where-Object { $_.LastWriteTime -gt $built } | Select-Object -First 1)
    }
    if ($stale) { npm run build *>> $logFile }

    $server = Start-Process npm.cmd -ArgumentList "start", "--", "-p", "$port" -WorkingDirectory $projectDir `
        -WindowStyle Hidden -PassThru -RedirectStandardOutput $logFile -RedirectStandardError "$logFile.err"

    for ($i = 0; $i -lt 60 -and -not (Test-Server); $i++) { Start-Sleep -Seconds 1 }
    if (-not (Test-Server)) {
        Add-Type -AssemblyName PresentationFramework
        [System.Windows.MessageBox]::Show("TradeQuote PRO didn't start. See $logFile", "TradeQuote PRO") | Out-Null
        exit 1
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

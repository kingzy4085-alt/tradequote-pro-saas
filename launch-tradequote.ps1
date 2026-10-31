# TradeQuote PRO One-Click Startup Script
$projectDir = "C:\Users\kylei\Desktop\trade-quote-pro"
$port = 3001
$url = "http://localhost:$port"

Write-Host "Starting TradeQuote PRO Server..." -ForegroundColor Cyan
Set-Location $projectDir

# Start Next.js in a background PowerShell window
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$projectDir'; npm run dev -- -p $port"

# Poll the server instead of a blind sleep, so the browser only opens once it's actually ready
$maxWait = 30
$elapsed = 0
$ready = $false
while ($elapsed -lt $maxWait) {
    try {
        $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
        if ($r.StatusCode -eq 200) { $ready = $true; break }
    } catch {}
    Start-Sleep -Seconds 1
    $elapsed++
}

if (-not $ready) {
    Write-Host "Server didn't respond within $maxWait s — check the dev server window for errors." -ForegroundColor Yellow
}
Start-Process $url

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  TradeQuote PRO: Production Readiness Audit" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

$nodeVersion = node -v
$npmVersion = npm -v
Write-Host "[*] Node.js Version: $nodeVersion" -ForegroundColor Green
Write-Host "[*] npm Version: $npmVersion" -ForegroundColor Green

if (Test-Path "package.json") {
    $pkg = Get-Content "package.json" | ConvertFrom-Json
    $nextVersion = $pkg.dependencies.next
    Write-Host "[*] Current Next.js version: $nextVersion" -ForegroundColor Yellow
    
    if ($nextVersion -eq "14.2.35" -or $nextVersion -match "14\.2\.35") {
        Write-Host "[!] SECURITY ALERT: Version 14.2.35 contains documented RCE advisories." -ForegroundColor Red
        Write-Host "    Recommendation: Run 'npm install next@latest' to patch." -ForegroundColor Yellow
    } else {
        Write-Host "[+] Next.js version checked." -ForegroundColor Green
    }
} else {
    Write-Host "[!] Error: package.json not found." -ForegroundColor Red
    exit
}

$envFile = ".env.production"
if (Test-Path $envFile) {
    Write-Host "[+] Found $envFile configuration file." -ForegroundColor Green
} else {
    Write-Host "[!] Warning: $envFile not found. Ensure production secrets are configured in Vercel." -ForegroundColor Yellow
}

try {
    $null = docker info 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[+] Docker daemon is running." -ForegroundColor Green
    } else {
        Write-Host "[!] Docker daemon is stopped or unavailable." -ForegroundColor Yellow
    }
} catch {
    Write-Host "[!] Docker is not installed or not in PATH." -ForegroundColor Yellow
}

Write-Host "[*] Testing production build compilation..." -ForegroundColor Cyan
if ($pkg.scripts.build) {
    npm run build
} else {
    npx next build
}

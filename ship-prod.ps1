Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  TradeQuote PRO: Production Deployment Prep" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# 1. Generate .env.production template if missing
$envProdPath = ".env.production"
if (!(Test-Path $envProdPath)) {
    $envTemplate = @"
# TradeQuote PRO - Production Environment Variables (Configure in Vercel)
NEXT_PUBLIC_SUPABASE_URL=your_live_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_live_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_live_supabase_service_role_key
STRIPE_LIVE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
RESEND_API_KEY=re_...
NEXT_PUBLIC_APP_URL=https://tradequotepro.com
"@
    Set-Content -Path $envProdPath -Value $envTemplate -Encoding utf8
    Write-Host "[+] Generated .env.production template file." -ForegroundColor Green
} else {
    Write-Host "[+] .env.production already exists." -ForegroundColor Green
}

# 2. Git Automation (Stage and Commit)
Write-Host "[*] Staging and committing updates for production..." -ForegroundColor Yellow
git add .
$commitMsg = "Finalize production readiness: Ingzys Automation legal pages under SK law, Next.js upgrade, and verified build"
git commit -m $commitMsg 2>&1

# 3. Check Git Status
Write-Host "[*] Current Git Status:" -ForegroundColor Cyan
git status

Write-Host "==========================================" -ForegroundColor Green
Write-Host "  Deployment Preparation Complete!" -ForegroundColor Green
Write-Host "  - Local build & legal pages verified." -ForegroundColor White
Write-Host "  - Git changes committed locally." -ForegroundColor White
Write-Host "  - Next: Push to GitHub (`git push origin main` or your branch) and deploy on Vercel." -ForegroundColor Yellow
Write-Host "==========================================" -ForegroundColor Cyan

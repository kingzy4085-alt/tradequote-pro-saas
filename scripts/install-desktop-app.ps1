# Installs (or updates) TradeQuote PRO as a desktop app with its own local database.
#
#   pwsh scripts/install-desktop-app.ps1
#
# Puts a copy of the app's main line (master) in C:\Users\<you>\TradeQuotePRO\app, outside
# OneDrive and outside any temporary work folder, with the local database's settings in
# ...\TradeQuotePRO\database. Builds it, and puts a "TradeQuote PRO" shortcut on the Desktop
# and in the Start menu. Run it again after master moves on, to update the desktop copy.
#
# Needs Git, Node.js, Docker Desktop and the Supabase command-line tool. Changes nothing on
# GitHub. The local database's data lives in Docker and is never deleted by this script.
param(
  [string]$Root = (Join-Path $env:USERPROFILE 'TradeQuotePRO'),
  [string]$Branch = 'master'
)

$ErrorActionPreference = 'Stop'
$repoDir = Split-Path $PSScriptRoot -Parent
$appDir = Join-Path $Root 'app'
$dbDir = Join-Path $Root 'database'
$port = 3001

function Fail([string]$message) {
  Write-Host $message -ForegroundColor Red
  exit 1
}
function Native([string]$what, [scriptblock]$run) {
  & $run
  if ($LASTEXITCODE -ne 0) { Fail "Failed: $what" }
}

foreach ($tool in 'git', 'node', 'npm', 'docker', 'supabase') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Fail "$tool is not installed or not on PATH." }
}
New-Item -ItemType Directory -Force $Root | Out-Null

# 1. The app copy: a clone of this repository's master branch
# The shared repository, also when this folder is a worktree of it
$source = (git -C $repoDir rev-parse --path-format=absolute --git-common-dir)
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $source)) { Fail "Could not find the git repository for $repoDir." }
if (-not (Test-Path (Join-Path $appDir '.git'))) {
  Write-Host "Copying the app to $appDir"
  Native 'git clone' { git clone --quiet --branch $Branch $source $appDir }
} else {
  Write-Host "Updating the app in $appDir"
  if (git -C $appDir status --porcelain) { Fail "$appDir has local changes. Commit or remove them first; this script will not overwrite them." }
  Native 'git fetch' { git -C $appDir fetch --quiet origin $Branch }
  Native 'git merge' { git -C $appDir merge --quiet --ff-only "origin/$Branch" }
}
Write-Host "App version: $(git -C $appDir log --oneline -1)"

# 2. Settings: copied once from this folder. The file is copied, never read or printed.
$settings = Join-Path $appDir '.env.local'
if (-not (Test-Path $settings)) {
  $mine = Join-Path $repoDir '.env.local'
  if (-not (Test-Path $mine)) { Fail "No .env.local to copy. Create $settings from .env.example (README, ""Set up"")." }
  Copy-Item $mine $settings
  Write-Host 'Copied the settings file.'
}

# 3. The local database's settings, in a folder of their own (the repo has no supabase/config.toml)
$config = Join-Path $dbDir 'supabase\config.toml'
if (-not (Test-Path $config)) {
  Write-Host "Creating the local database settings in $dbDir"
  New-Item -ItemType Directory -Force $dbDir | Out-Null
  Push-Location $dbDir
  try { 'n' | supabase init --force | Out-Null } finally { Pop-Location }
  if (-not (Test-Path $config)) { Fail 'supabase init did not create a config.' }
  $c = [IO.File]::ReadAllText($config)
  # The same project id as before keeps any data already in Docker
  $c = $c -replace 'project_id = "[^"]*"', 'project_id = "localdb"'
  $c = $c -replace 'site_url = "[^"]*"', "site_url = ""http://localhost:$port"""
  $urls = (@($port, 3200) | ForEach-Object { """http://localhost:$_/auth/callback"", ""http://127.0.0.1:$_/auth/callback""" }) -join ', '
  $c = $c -replace 'additional_redirect_urls = \[[^\]]*\]', "additional_redirect_urls = [$urls]"
  $c = $c -replace '(?m)^email_sent = \d+', 'email_sent = 1000'
  $templates = Join-Path $dbDir 'supabase\templates'
  New-Item -ItemType Directory -Force $templates | Out-Null
  # The token_hash links from the README's Email Templates table
  $emails = [ordered]@{
    invite       = @('You have been invited to TradeQuote PRO', 'Accept the invitation', 'type=invite&next=/onboarding')
    confirmation = @('Confirm your email', 'Confirm your email', 'type=email')
    magic_link   = @('Your sign-in link', 'Sign in', 'type=magiclink')
    email_change = @('Confirm your new email', 'Confirm the new address', 'type=email_change')
    recovery     = @('Reset your password', 'Choose a new password', 'type=recovery')
  }
  $c += "`n# TradeQuote PRO email templates`n"
  foreach ($k in $emails.Keys) {
    $subject, $label, $query = $emails[$k]
    Set-Content -Path (Join-Path $templates "$k.html") -Encoding utf8 -Value "<h2>$subject</h2>`n<p><a href=""{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&$query"">$label</a></p>"
    $c += "`n[auth.email.template.$k]`nsubject = ""$subject""`ncontent_path = ""./supabase/templates/$k.html""`n"
  }
  [IO.File]::WriteAllText($config, $c)
}

# 4. Start the database and bring it up to this version
if (-not (& { docker info *> $null; $LASTEXITCODE -eq 0 })) { Fail 'Docker Desktop is not running. Start it, then run this again.' }
Write-Host 'Starting the local database...'
Native 'supabase start' { supabase start --workdir $dbDir | Out-Null }
Push-Location $appDir
try {
  Native 'database update' { supabase migration up --db-url 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' | Out-Null }

  # 5. Install and build, for the port the launcher serves on
  Write-Host 'Installing packages...'
  Native 'npm ci' { npm ci --no-audit --no-fund | Out-Null }
  Write-Host 'Building (a few minutes)...'
  $env:NEXT_PUBLIC_SITE_URL = "http://localhost:$port"
  Native 'npm run build' { npm run build | Out-Null }
  Set-Content -Path (Join-Path $appDir '.next\launcher-site-url.txt') -Value "http://localhost:$port"
} finally {
  Pop-Location
}

# 6. The shortcut, pointing at this copy's launcher
& (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -NoProfile -ExecutionPolicy Bypass -File (Join-Path $appDir 'install-desktop-shortcut.ps1')
if ($LASTEXITCODE -ne 0) { Fail 'Could not create the shortcut.' }

Write-Host "`nInstalled. Double-click ""TradeQuote PRO"" on the Desktop." -ForegroundColor Green

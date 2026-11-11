# Makes this branch the main line and publishes it to GitHub.
#
#   pwsh scripts/ship-to-master.ps1
#
# 1. Runs every check (scripts/verify.ps1).
# 2. Confirms GitHub's master has nothing this branch lacks, so the push is a plain fast-forward.
# 3. Shows what will be published and asks before pushing. It never forces anything.
#
# Publishing is the one step here that reaches outside this computer, which is why it asks.
param([switch]$SkipVerify)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

function Fail([string]$message) {
  Write-Host $message -ForegroundColor Red
  exit 1
}

if (git status --porcelain) {
  git status --short
  Fail 'There are uncommitted changes. Commit them first: only committed work is published.'
}

if (-not $SkipVerify) {
  pwsh -NoProfile -File (Join-Path $PSScriptRoot 'verify.ps1')
  if ($LASTEXITCODE -ne 0) { Fail 'The checks failed, so nothing was published.' }
}

git fetch origin
if ($LASTEXITCODE -ne 0) { Fail 'Could not reach GitHub.' }
git merge-base --is-ancestor origin/master HEAD
if ($LASTEXITCODE -ne 0) { Fail 'GitHub master has commits this branch does not. Merge them in first; this script will not overwrite them.' }

$count = git rev-list --count origin/master..HEAD
if ($count -eq '0') {
  Write-Host 'GitHub master already has everything on this branch.' -ForegroundColor Green
  exit 0
}

Write-Host "`nThis will publish $count commits to master on:" -ForegroundColor Cyan
Write-Host "  $((git remote get-url origin) -replace '://[^@/]+@', '://')"
if (Get-Command gh -ErrorAction SilentlyContinue) {
  $visibility = gh repo view --json visibility --jq .visibility 2>$null
  if ($visibility) { Write-Host "  Repository visibility: $visibility" }
  if ($visibility -eq 'PUBLIC') { Write-Host '  It is PUBLIC: anyone can read this source code.' -ForegroundColor Yellow }
}
if (git ls-files .continue/agents/new-config.yaml) {
  Write-Host "`n  .continue/agents/new-config.yaml is in the repository and may hold an API key." -ForegroundColor Yellow
  Write-Host '  It is already on GitHub in older branches. Revoke that key whether or not you push (STATUS.md).' -ForegroundColor Yellow
}
Write-Host "`nNewest commits:"
git log --oneline -8 origin/master..HEAD

$answer = Read-Host "`nType PUSH to publish, or anything else to stop"
if ($answer -cne 'PUSH') {
  Write-Host 'Stopped. Nothing was published.'
  exit 0
}

git push origin HEAD:master
if ($LASTEXITCODE -ne 0) { Fail 'The push was refused. Nothing was changed on GitHub.' }

# Bring the local master along. This fails harmlessly if master is checked out in another folder.
git fetch . HEAD:master 2>$null
if ($LASTEXITCODE -ne 0) { Write-Host 'Note: local master is checked out elsewhere. Run "git pull" there to update it.' -ForegroundColor Yellow }

Write-Host "`nPublished. GitHub master now matches this branch." -ForegroundColor Green

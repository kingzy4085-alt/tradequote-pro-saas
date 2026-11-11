# Continues the build with the Claude Code command-line tool, one task at a time.
#
#   pwsh scripts/continue-build.ps1               does the next unfinished task in HANDOFF_PROMPT.md
#   pwsh scripts/continue-build.ps1 -Tasks 3      does the next three, one after another
#   pwsh scripts/continue-build.ps1 -Unattended   lets it run any command without asking (see below)
#
# After each task this script runs scripts/verify.ps1 itself. If a check fails it stops, so a bad
# change is never built on. It never pushes or deploys: scripts/ship-to-master.ps1 does that.
#
# It uses your Claude usage, so run it once your limit has reset.
#
# Permissions: by default the tool may edit files and run npm, npx, node and git add/commit, and
# nothing else. If it reports that it was not allowed to run a command it needed, run again with
# -Unattended. That switch removes every permission check, so only use it on this project folder.
param(
  [ValidateRange(1, 10)][int]$Tasks = 1,
  [switch]$Unattended,
  [switch]$SkipFirstCheck,
  [string]$Model = ''
)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

function Fail([string]$message) {
  Write-Host $message -ForegroundColor Red
  exit 1
}

if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  Fail 'The "claude" command is not installed. Paste HANDOFF_PROMPT.md into your AI tool instead.'
}
if (-not (Test-Path HANDOFF_PROMPT.md)) { Fail 'HANDOFF_PROMPT.md is missing. Run this from the project that has it.' }
if (git status --porcelain) {
  git status --short
  Fail 'There are uncommitted changes. Commit them or set them aside first, so each task starts clean.'
}
Write-Host "Branch: $(git rev-parse --abbrev-ref HEAD)"

if (-not $SkipFirstCheck) {
  Write-Host 'Checking the starting point is healthy (about six minutes)...'
  pwsh -NoProfile -File (Join-Path $PSScriptRoot 'verify.ps1')
  if ($LASTEXITCODE -ne 0) { Fail 'The project does not pass its own checks. Fix that before adding anything.' }
}

$prompt = @'
Read HANDOFF_PROMPT.md and STATUS.md in this folder and follow them exactly.

Do ONE task: the first item under "Tasks, in order" in HANDOFF_PROMPT.md that is not marked [done].

- Follow every rule in HANDOFF_PROMPT.md. Never delete or weaken a test to get it to pass.
- Write tests for what you build. Run `npm test` and `npm run build`, and fix whatever fails.
- When both pass, mark the task [done] in HANDOFF_PROMPT.md with one line saying what was built,
  bring STATUS.md up to date, and commit the feature, its tests and those two files together.
- Do not push, deploy, switch branches or start a second task.
- If you cannot finish, do not commit. Leave the files as they are and write what stopped you
  under a "Blocked" heading at the top of STATUS.md.

Finish with two or three plain sentences: what you built and what you verified.
'@

$claudeArgs = @('-p', $prompt)
if ($Unattended) {
  $claudeArgs += '--dangerously-skip-permissions'
} else {
  $claudeArgs += @('--permission-mode', 'acceptEdits', '--allowedTools',
    'Bash(npm:*)', 'Bash(npx:*)', 'Bash(node:*)', 'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git add:*)', 'Bash(git commit:*)',
    'PowerShell(npm:*)', 'PowerShell(npx:*)', 'PowerShell(node:*)', 'PowerShell(git status:*)', 'PowerShell(git diff:*)', 'PowerShell(git log:*)', 'PowerShell(git add:*)', 'PowerShell(git commit:*)')
}
if ($Model) { $claudeArgs += @('--model', $Model) }

foreach ($n in 1..$Tasks) {
  $before = git rev-parse HEAD
  Write-Host "`n== Task $n of $Tasks" -ForegroundColor Cyan
  & claude @claudeArgs
  if ($LASTEXITCODE -ne 0) { Fail "The claude command stopped with an error (often a usage limit). Nothing after task $($n - 1) is verified." }

  if (git status --porcelain) {
    git status --short
    Fail 'The task left uncommitted changes, so it did not finish. Read the top of STATUS.md for what blocked it.'
  }
  $after = git rev-parse HEAD
  if ($after -eq $before) {
    Write-Host 'No new commit was made. Either every task is done, or this one was blocked (see STATUS.md).' -ForegroundColor Yellow
    break
  }

  Write-Host "`nChecking the result of task $n..."
  pwsh -NoProfile -File (Join-Path $PSScriptRoot 'verify.ps1')
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Task $n was committed but fails the checks." -ForegroundColor Red
    Write-Host "Fix it, or go back to before it with:  git reset --hard $before"
    exit 1
  }
  Write-Host "Task $n is committed and passes every check." -ForegroundColor Green
  git log --oneline "$before..$after"
}

Write-Host "`nDone. Nothing was pushed. To publish: pwsh scripts/ship-to-master.ps1" -ForegroundColor Green

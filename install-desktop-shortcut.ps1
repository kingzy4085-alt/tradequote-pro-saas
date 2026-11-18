# Adds a "TradeQuote PRO" shortcut to the Desktop and Start menu.
# Run once:  powershell -ExecutionPolicy Bypass -File .\install-desktop-shortcut.ps1
# (scripts/install-desktop-app.ps1 runs this for you.)
$projectDir = $PSScriptRoot
if (-not $projectDir) {
    # Pasted into a console instead of run as a file: there is no script folder to point at
    Write-Host "Run this as a file: powershell -ExecutionPolicy Bypass -File .\install-desktop-shortcut.ps1" -ForegroundColor Red
    exit 1
}
$launcher = Join-Path $projectDir "launch-tradequote.ps1"
$icon = Join-Path $projectDir "public\tradequote.ico"
if (-not (Test-Path $launcher)) {
    Write-Host "No launcher at $launcher" -ForegroundColor Red
    exit 1
}

$shell = New-Object -ComObject WScript.Shell
$targets = @(
    [Environment]::GetFolderPath("Desktop"),
    [Environment]::GetFolderPath("Programs")
)

foreach ($folder in $targets) {
    $link = $shell.CreateShortcut((Join-Path $folder "TradeQuote PRO.lnk"))
    $link.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
    $link.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcher`""
    $link.WorkingDirectory = $projectDir
    $link.IconLocation = $icon
    $link.Description = "TradeQuote PRO"
    $link.Save()
    Write-Host "Created shortcut in $folder"
}

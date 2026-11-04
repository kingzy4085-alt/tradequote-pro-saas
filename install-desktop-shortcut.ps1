# Adds a "TradeQuote PRO" shortcut to the Desktop and Start menu.
# Run once:  powershell -ExecutionPolicy Bypass -File .\install-desktop-shortcut.ps1
$projectDir = $PSScriptRoot
$launcher = Join-Path $projectDir "launch-tradequote.ps1"
$icon = Join-Path $projectDir "public\tradequote.ico"

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

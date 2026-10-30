# Create a "LearnHarness" desktop shortcut that runs `npm run pc` (build if
# needed, serve on 127.0.0.1:3217, open the browser). Closing its console
# window stops the server.
#
#   powershell -ExecutionPolicy Bypass -File scripts\make-shortcut.ps1

$root = Split-Path -Parent $PSScriptRoot
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$desktop = [Environment]::GetFolderPath("Desktop")
$link = Join-Path $desktop "LearnHarness.lnk"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($link)
$shortcut.TargetPath = "$env:ComSpec"
$shortcut.Arguments = "/c title LearnHarness && `"$npm`" run pc"
$shortcut.WorkingDirectory = $root
$shortcut.IconLocation = (Join-Path $root "build\icon.ico")
$shortcut.WindowStyle = 7 # minimized
$shortcut.Description = "Run LearnHarness for this PC and the iPad"
$shortcut.Save()

Write-Output "Created $link"

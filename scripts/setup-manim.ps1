# Local Manim Community for the physics program's explainer animations.
#
#   powershell -ExecutionPolicy Bypass -File scripts/setup-manim.ps1 [-NoLatex]
#
# Creates manim/.venv (Python 3.11, gitignored) with Manim Community (~120 MB
# download, ~400 MB on disk). Unless -NoLatex, also installs MiKTeX for the
# current user via winget (~250 MB download, ~1 GB with packages) so scenes
# can use MathTex, and turns on MiKTeX's silent on-the-fly package install.
# ffmpeg must already be on PATH. Safe to re-run.

param([switch]$NoLatex)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$venv = Join-Path $root "manim\.venv"
$python = Join-Path $venv "Scripts\python.exe"

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) { throw "ffmpeg is not on PATH - install it first (winget install Gyan.FFmpeg)" }

if (-not (Test-Path $python)) {
	Write-Host "Creating $venv (Python 3.11)"
	& py -3.11 -m venv $venv
	if ($LASTEXITCODE -ne 0) { throw "py -3.11 -m venv failed - is Python 3.11 installed (py -0)?" }
}

Write-Host "Installing Manim Community"
& $python -m pip install --disable-pip-version-check --upgrade pip | Out-Null
& $python -m pip install --disable-pip-version-check "manim>=0.19,<1"
if ($LASTEXITCODE -ne 0) { throw "pip install failed" }

if (-not $NoLatex) {
	$mikBin = Join-Path $env:LOCALAPPDATA "Programs\MiKTeX\miktex\bin\x64"
	if (-not (Get-Command latex -ErrorAction SilentlyContinue) -and -not (Test-Path (Join-Path $mikBin "latex.exe"))) {
		Write-Host "Installing MiKTeX (per user, via winget)"
		& winget install --id MiKTeX.MiKTeX -e --scope user --silent --accept-package-agreements --accept-source-agreements
		if ($LASTEXITCODE -ne 0) { throw "winget install MiKTeX failed" }
	}
	if (Test-Path $mikBin) { $env:PATH = "$mikBin;$env:PATH" }
	Write-Host "MiKTeX: install missing packages silently"
	& initexmf --set-config-value="[MPM]AutoInstall=1"
	if ($LASTEXITCODE -ne 0) { throw "initexmf failed" }
}

Write-Host "Smoke test"
$tmp = Join-Path ([IO.Path]::GetTempPath()) "lh-manim-smoke"
New-Item -ItemType Directory -Force $tmp | Out-Null
$scene = if ($NoLatex) { 'Text("ok")' } else { 'MathTex(r"\omega_1=\sqrt{\omega_0^2-\beta^2}")' }
Set-Content -Encoding utf8 (Join-Path $tmp "smoke.py") "from manim import *`nclass Smoke(Scene):`n    def construct(self):`n        self.add($scene)`n        self.wait(0.1)`n"
& $python -m manim render -ql --disable_caching --media_dir (Join-Path $tmp "media") (Join-Path $tmp "smoke.py") Smoke
if ($LASTEXITCODE -ne 0) { throw "smoke render failed" }
Remove-Item -Recurse -Force $tmp
Write-Host "Manim ready: $python -m manim"

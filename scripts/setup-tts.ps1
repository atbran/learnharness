# Local Kokoro TTS for the physics program's audio guides.
#
#   powershell -ExecutionPolicy Bypass -File scripts/setup-tts.ps1
#
# Creates tts/.venv (Python 3.11) with kokoro-onnx + soundfile and fetches the
# Kokoro v1.0 ONNX model + voice pack into tts/models/ (~350 MB, both gitignored).
# Safe to re-run: existing venv packages are upgraded in place and model files
# already on disk at the expected size are skipped.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$tts = Join-Path $root "tts"
$venv = Join-Path $tts ".venv"
$models = Join-Path $tts "models"
$python = Join-Path $venv "Scripts\python.exe"

$release = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
$files = @(
	@{ Name = "kokoro-v1.0.onnx"; Bytes = 325532387 },
	@{ Name = "voices-v1.0.bin"; Bytes = 28214398 }
)

if (-not (Test-Path $python)) {
	Write-Host "Creating $venv (Python 3.11)"
	& py -3.11 -m venv $venv
	if ($LASTEXITCODE -ne 0) { throw "py -3.11 -m venv failed - is Python 3.11 installed (py -0)?" }
}

Write-Host "Installing kokoro-onnx + soundfile"
& $python -m pip install --disable-pip-version-check --upgrade pip | Out-Null
& $python -m pip install --disable-pip-version-check "kokoro-onnx>=0.6,<0.7" soundfile
if ($LASTEXITCODE -ne 0) { throw "pip install failed" }

New-Item -ItemType Directory -Force $models | Out-Null
$ProgressPreference = "SilentlyContinue" # Invoke-WebRequest is ~10x slower with the progress bar
foreach ($f in $files) {
	$dest = Join-Path $models $f.Name
	if ((Test-Path $dest) -and (Get-Item $dest).Length -eq $f.Bytes) {
		Write-Host "Have $($f.Name)"
		continue
	}
	Write-Host "Downloading $($f.Name) ($([math]::Round($f.Bytes / 1MB)) MB)"
	$part = "$dest.part"
	Invoke-WebRequest -Uri "$release/$($f.Name)" -OutFile $part -UseBasicParsing
	if ((Get-Item $part).Length -ne $f.Bytes) { throw "$($f.Name): unexpected size $((Get-Item $part).Length)" }
	Move-Item -Force $part $dest
}

Write-Host "Smoke test"
& $python -I -c "import kokoro_onnx, soundfile; print('kokoro-onnx', kokoro_onnx.__version__ if hasattr(kokoro_onnx, '__version__') else 'ok', '| soundfile', soundfile.__version__)"
if ($LASTEXITCODE -ne 0) { throw "import check failed" }
Write-Host "TTS ready: $python tts/synth.py"

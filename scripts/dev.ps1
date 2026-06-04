# Bring up the full local CARMA dev stack: Docker + DB + FastAPI server + Expo Metro + Android emulator.
# Opens 3 PowerShell windows. Stop a piece by closing its window or Ctrl-C inside it.

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot | Split-Path -Parent
$sdk  = "$env:LOCALAPPDATA\Android\Sdk"
$adb  = "$sdk\platform-tools\adb.exe"

if (-not (Test-Path "$root\server\.venv\Scripts\Activate.ps1")) {
    Write-Warning "server\.venv not found. Run first-time setup (see README.md) and re-run this script."
    exit 1
}

# ── 0. Docker Desktop ─────────────────────────────────────────────────────────
$dockerReady = (docker info 2>$null) -ne $null
if (-not $dockerReady) {
    $dockerExe = @(
        "C:\Program Files\Docker\Docker\Docker Desktop.exe",
        "$env:LOCALAPPDATA\Programs\Docker\Docker\Docker Desktop.exe"
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1

    if (-not $dockerExe) {
        Write-Warning "Docker Desktop not found. Install it from https://www.docker.com and re-run."
        exit 1
    }
    Write-Host "▶ Starting Docker Desktop..."
    Start-Process $dockerExe
    Write-Host "  Waiting for Docker engine..." -NoNewline
    $i = 0
    while (-not (docker info 2>$null) -and $i -lt 30) {
        Start-Sleep 3; $i++; Write-Host "." -NoNewline
    }
    Write-Host ""
    if ($i -ge 30) { Write-Warning "Docker engine did not start in time. Check Docker Desktop."; exit 1 }
}
Write-Host "✓ Docker engine ready"

# ── 1. Android Emulator ────────────────────────────────────────────────────────
if (-not (Test-Path $adb)) {
    Write-Warning "Android SDK not found at $sdk — skipping emulator. Install Android Studio to get it."
} else {
    $online = & $adb devices 2>$null | Select-String "emulator.*\bdevice\b"
    if ($online) {
        Write-Host "✓ Emulator already running — skipping launch"
    } else {
        $avd = (& "$sdk\emulator\emulator.exe" -list-avds 2>$null | Select-Object -First 1).Trim()
        if (-not $avd) {
            Write-Warning "No AVD found. Create one in Android Studio → Device Manager — skipping emulator."
        } else {
            Get-Process -Name "qemu-system-x86_64","emulator" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
            Start-Sleep 2
            Write-Host "▶ Starting emulator: $avd (no snapshot)..."
            Start-Process "$sdk\emulator\emulator.exe" -ArgumentList "-avd $avd -no-snapshot-load"
            Write-Host "  Waiting for Android to boot..." -NoNewline
            $booted = $false
            for ($i = 1; $i -le 24; $i++) {
                Start-Sleep 5
                $result = & $adb shell getprop sys.boot_completed 2>$null
                if (($result | Select-Object -Last 1).Trim() -eq "1") { $booted = $true; break }
                Write-Host "." -NoNewline
            }
            Write-Host ""
            if ($booted) { Write-Host "✓ Emulator booted" }
            else { Write-Warning "Emulator did not boot in time — press 'a' in Metro once it's ready" }
        }
    }
}

# ── 2. Dev stack (DB + Server + Metro) ────────────────────────────────────────
Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$root\server'; docker compose up db"
Start-Sleep 5
Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$root\server'; .\.venv\Scripts\Activate.ps1; uvicorn app.main:app --reload --host 0.0.0.0 --port 3000"
Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$root\mobile'; npm start"

Write-Host ""
Write-Host "CARMA dev stack started:"
Write-Host "  1) Postgres   (docker)   -> :5432"
Write-Host "  2) FastAPI    (server)   -> http://localhost:3000  (docs: /api/docs)"
Write-Host "  3) Metro      (mobile)   -> http://localhost:8081"
Write-Host ""
Write-Host "Press 'a' in the Metro window to open the app on the emulator."
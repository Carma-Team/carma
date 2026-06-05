# CARMA — First-time machine setup
# Run once on every new developer machine. Safe to re-run.
# Requires: winget (Windows 11 built-in), PowerShell as Administrator

#Requires -RunAsAdministrator

$ErrorActionPreference = "Stop"
$root    = $PSScriptRoot | Split-Path -Parent
$changes = 0   # counts things that were actually installed/changed

function Step($msg)   { Write-Host "`n── $msg" -ForegroundColor Cyan }
function OK($msg)     { Write-Host "  ✓ $msg" -ForegroundColor Green }
function New($msg)    { Write-Host "  + $msg" -ForegroundColor Green; $script:changes++ }
function Warn($msg)   { Write-Host "  ⚠ $msg" -ForegroundColor Yellow }

Step "Checking prerequisites"

# ── winget ────────────────────────────────────────────────────────────────────
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Error "winget not found. Install 'App Installer' from the Microsoft Store and re-run."
}

# ── Docker Desktop ────────────────────────────────────────────────────────────
$dockerExe = @(
    "C:\Program Files\Docker\Docker\Docker Desktop.exe",
    "$env:LOCALAPPDATA\Programs\Docker\Docker\Docker Desktop.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($dockerExe) {
    OK "Docker Desktop already installed"
} else {
    Step "Installing Docker Desktop"
    winget install --id Docker.DockerDesktop -e --accept-source-agreements --accept-package-agreements
    New "Docker Desktop installed — launch it once, accept the EULA, then re-run"
}

# ── Python 3.12 ───────────────────────────────────────────────────────────────
$python = Get-Command python -ErrorAction SilentlyContinue
if ($python -and (python --version 2>&1) -match "3\.1[2-9]") {
    OK "Python $((python --version 2>&1).Split(' ')[1]) already installed"
} else {
    Step "Installing Python 3.12"
    winget install --id Python.Python.3.12 -e --accept-source-agreements --accept-package-agreements
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH","User")
    New "Python 3.12 installed"
}

# ── Node.js ───────────────────────────────────────────────────────────────────
if (Get-Command node -ErrorAction SilentlyContinue) {
    OK "Node.js $((node --version)) already installed"
} else {
    Step "Installing Node.js LTS"
    winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH","User")
    New "Node.js installed"
}

# ── Android SDK env vars ───────────────────────────────────────────────────────
Step "Configuring Android SDK environment"
$sdk = "$env:LOCALAPPDATA\Android\Sdk"
if (Test-Path $sdk) {
    [System.Environment]::SetEnvironmentVariable("ANDROID_HOME", $sdk, "User")
    $userPath = [System.Environment]::GetEnvironmentVariable("PATH", "User")
    $additions = @("$sdk\platform-tools", "$sdk\emulator") | Where-Object { $userPath -notlike "*$_*" }
    if ($additions) {
        [System.Environment]::SetEnvironmentVariable("PATH", "$userPath;" + ($additions -join ";"), "User")
    }
    $env:ANDROID_HOME = $sdk
    $env:PATH = "$env:PATH;$sdk\platform-tools;$sdk\emulator"
    OK "ANDROID_HOME set to $sdk"
} else {
    Warn "Android SDK not found at $sdk — install Android Studio first, then re-run this script"
    Warn "Download: https://developer.android.com/studio"
}

# ── Java (JDK) env vars ────────────────────────────────────────────────────────
Step "Configuring Java"
$jdkCandidates = @(
    "$env:ProgramFiles\Microsoft\jdk-17*",
    "$env:ProgramFiles\Eclipse Adoptium\jdk-17*",
    "$env:ProgramFiles\Java\jdk-17*",
    "$env:ProgramFiles\Android\Android Studio\jbr"
) | ForEach-Object { Resolve-Path $_ -ErrorAction SilentlyContinue } | Select-Object -First 1

if ($jdkCandidates) {
    $javaHome = $jdkCandidates.Path
    [System.Environment]::SetEnvironmentVariable("JAVA_HOME", $javaHome, "User")
    $userPath = [System.Environment]::GetEnvironmentVariable("PATH", "User")
    if ($userPath -notlike "*$javaHome\bin*") {
        [System.Environment]::SetEnvironmentVariable("PATH", "$userPath;$javaHome\bin", "User")
    }
    $env:JAVA_HOME = $javaHome
    OK "JAVA_HOME set to $javaHome"
} else {
    Warn "JDK not found — Android Studio bundles a JDK at 'Android Studio\jbr'. Install Android Studio first."
}

# ── Python venv + server dependencies ─────────────────────────────────────────
Step "Setting up Python virtual environment"
Set-Location "$root\server"

if (Test-Path ".venv\Scripts\Activate.ps1") {
    OK "venv already exists"
} else {
    python -m venv .venv
    New "venv created"
}

.\.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt --quiet
OK "Python dependencies up to date"

# ── .env ───────────────────────────────────────────────────────────────────────
if (-not (Test-Path ".env")) {
    Copy-Item .env.example .env
    New ".env created from .env.example"
} else {
    OK ".env already exists"
}

# ── DB migrations + seed ───────────────────────────────────────────────────────
Step "Running DB migrations (requires Docker to be running)"
$dockerReady = (docker info 2>$null) -ne $null
if ($dockerReady) {
    docker compose up db -d *>$null
    Start-Sleep 5
    alembic upgrade head *>$null
    OK "Migrations applied"
    python -m app.seed
    OK "Demo data seeded"
} else {
    Warn "Docker not running — skipping migrations and seed"
    Warn "After starting Docker Desktop, run manually:"
    Warn "  cd server && docker compose up db -d"
    Warn "  alembic upgrade head"
    Warn "  python -m app.seed"
}

# ── Windows Firewall — allow emulator to reach FastAPI ────────────────────────
Step "Configuring Windows Firewall"
$rule = Get-NetFirewallRule -DisplayName "CARMA FastAPI Dev" -ErrorAction SilentlyContinue
if ($rule) {
    OK "Firewall rule for port 3000 already exists"
} else {
    New-NetFirewallRule -DisplayName "CARMA FastAPI Dev" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow | Out-Null
    New "Firewall rule added — Android emulator can now reach the server"
}

# ── Mobile dependencies ────────────────────────────────────────────────────────
Step "Installing mobile dependencies"
Set-Location "$root\mobile"
npm install --silent
OK "Mobile dependencies installed"

Set-Location $root

# ── Done ───────────────────────────────────────────────────────────────────────
Write-Host ""
if ($changes -eq 0) {
    Write-Host "══════════════════════════════════════════" -ForegroundColor Green
    Write-Host "  Everything already set up — nothing changed." -ForegroundColor Green
    Write-Host "  Run the project with:" -ForegroundColor Green
    Write-Host "    .\scripts\dev.ps1" -ForegroundColor White
    Write-Host "══════════════════════════════════════════" -ForegroundColor Green
} else {
    Write-Host "══════════════════════════════════════════" -ForegroundColor Green
    Write-Host "  Setup complete! ($changes item(s) installed/configured)" -ForegroundColor Green
    Write-Host "  If Android Studio is not installed yet:" -ForegroundColor Green
    Write-Host "    1. Install from https://developer.android.com/studio" -ForegroundColor White
    Write-Host "    2. Create a Pixel 6 AVD with API 34 in Device Manager" -ForegroundColor White
    Write-Host "  Then run the project with:" -ForegroundColor Green
    Write-Host "    .\scripts\dev.ps1" -ForegroundColor White
    Write-Host "══════════════════════════════════════════" -ForegroundColor Green
}

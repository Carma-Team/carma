# Bring up the full local CARMA dev stack: DB + FastAPI server + Expo Metro.
# Opens 3 PowerShell windows. Stop a piece by closing its window or Ctrl-C inside it.

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot | Split-Path -Parent

if (-not (Test-Path "$root\server\.venv\Scripts\Activate.ps1")) {
    Write-Warning "server\.venv not found. First-time setup:"
    Write-Warning "  cd $root\server"
    Write-Warning "  python -m venv .venv"
    Write-Warning "  .venv\Scripts\activate"
    Write-Warning "  pip install -r requirements-dev.txt"
    Write-Warning "  copy .env.example .env"
    Write-Warning "  alembic upgrade head"
    Write-Warning "  python -m app.seed"
    Write-Warning "Then re-run scripts/dev.ps1"
    exit 1
}

Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$root\server'; docker compose up db"
Start-Sleep 5
Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$root\server'; .\.venv\Scripts\Activate.ps1; uvicorn app.main:app --reload --port 3000"
Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$root\mobile'; npm start"

Write-Host ""
Write-Host "CARMA dev stack starting in 3 windows:"
Write-Host "  1) Postgres   (docker)         -> :5432"
Write-Host "  2) Server     (FastAPI)        -> http://localhost:3000  (docs: /api/docs)"
Write-Host "  3) Mobile     (Expo/Metro)     -> http://localhost:8081"
Write-Host ""
Write-Host "Tip: Android emulator should use http://10.0.2.2:3000 (the host alias)."

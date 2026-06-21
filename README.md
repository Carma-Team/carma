# CARMA

CARMA is a mobile app that tracks driving behavior through GPS and IMU sensors, calculates a CARMA score, and allows safe drivers to earn points redeemable for real-time discounts.

---

## Repository Structure

| Folder | Description | Technology |
|---|---|---|
| `server/` | Backend — API, DB, business logic | Python / FastAPI / PostgreSQL |
| `mobile/` | Mobile application | React Native / Expo |
| `mock-server/` | Mock server for offline development | Express / json-server |
| `scripts/` | Helper scripts | PowerShell |
| `Hub/` | Documents for the Hub entrepreneurship workshop | — |

---

## Prerequisites — One-Time Installation

Make sure the following tools are installed before getting started:

| Tool | Required For | Download |
|---|---|---|
| **Docker Desktop** | Backend + DB | docker.com |
| **Python 3.12** | Backend | python.org |
| **Node.js 20+** | Mobile | nodejs.org |
| **Android Studio** | Mobile (includes Android SDK + AVD) | developer.android.com/studio |

> **Backend only?** You only need Docker + Python.

---

## First-Time Setup

**One-time per machine — run as Administrator:**

```powershell
.\scripts\setup.ps1
```

The script automatically installs and configures:
- Docker Desktop, Python 3.12, Node.js (via winget if missing)
- `ANDROID_HOME`, `JAVA_HOME`, `PATH` — permanent env vars
- Python venv + all dependencies
- Creates `.env` from `.env.example`
- Migrations + demo data seed

> **Safe to re-run.** If everything is already installed, the script skips each step and prints at the end:
> `Everything already set up — run .\scripts\dev.ps1`
>
> Only when there is a new migration do you need to run manually: `alembic upgrade head`

---

## Daily Usage

### Full Stack — Backend + Mobile + Emulator

```powershell
.\scripts\dev.ps1
```

The script handles everything automatically:
1. Starts Docker Desktop (if not running)
2. Launches the Android emulator
3. Brings up PostgreSQL
4. Starts FastAPI server on port 3000
5. Starts Expo Metro on port 8081

Once everything is up — press **`a`** in the Metro window to open the app in the emulator.

---

### Backend Only — Without Mobile

```powershell
cd server
docker compose up db          # Window 1 — PostgreSQL
.venv\Scripts\activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 3000   # Window 2 — API
```

API docs: http://localhost:3000/api/docs

---

## Important Notes

| Topic | Detail |
|---|---|
| **Android Emulator** | Always launched with `-no-snapshot-load` (handled by the script) |
| **Emulator → Server connection** | The app connects to `http://10.0.2.2:3000` (alias for localhost from within the emulator) |
| **Docker must be running** | The DB runs via Docker — no Docker, no DB |
| **New migration** | `cd server && alembic upgrade head` |

---

## Useful Commands

```powershell
# Mobile tests
cd mobile && npm test -- --no-coverage

# TypeScript check
cd mobile && npx tsc --noEmit

# Lint mobile
cd mobile && npm run lint

# Lint server
cd server && ruff check . && ruff format --check .

# Server tests
cd server && pytest
```

---

## Architecture Diagram

```
mobile (Expo) ──→ FastAPI :3000 ──→ PostgreSQL :5432
                      ↑
              (10.0.2.2 from emulator)
```

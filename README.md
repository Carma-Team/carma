# CARMA

CARMA is a mobile app that tracks driving behavior through GPS and IMU sensors, computes a CARMA score, and lets safe drivers earn points toward real-time discounts.

---

## Repository Contents

| Folder | What it is | Technology |
|---|---|---|
| `server/` | Backend — API, DB, business logic | Python / FastAPI / PostgreSQL |
| `mobile/` | Mobile app | React Native / Expo |
| `docs/` | Architecture & algorithm docs | Markdown |
| `scripts/` | Helper scripts | PowerShell |

---

## Prerequisites — One-Time Install

Before anything else, make sure the following tools are installed:

| Tool | For which part | Download |
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
- ANDROID_HOME, JAVA_HOME, PATH — persistent env vars
- Python venv + all dependencies
- `.env` created from `.env.example`
- Migrations + seed of demo data

> **Safe to re-run.** If everything is already installed, the script skips every step and prints at the end:
> `Everything already set up — run .\scripts\dev.ps1`
>
> Only when there is a new migration do you need to run manually: `alembic upgrade head`

---

## Daily Workflow

### Full Stack — Backend + Mobile + Emulator

```powershell
.\scripts\dev.ps1
```

The script does everything automatically:
1. Starts Docker Desktop (if not running)
2. Launches the Android emulator
3. Brings up PostgreSQL
4. Brings up the FastAPI server on port 3000
5. Brings up Expo Metro on port 8081

Once everything is up — press **`a`** in the Metro window to open the app in the emulator.

---

### Backend Only — without mobile

```powershell
cd server
docker compose up db          # Window 1 — PostgreSQL
.venv\Scripts\activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 3000   # Window 2 — API
```

API docs: http://localhost:3000/api/docs

---

## Key Notes

| Topic | Detail |
|---|---|
| **Android emulator** | Always launched with `-no-snapshot-load` (the script handles this) |
| **Emulator-to-server connection** | The app connects to `http://10.0.2.2:3000` (alias for localhost from inside the emulator) |
| **Docker must be running** | The DB runs through Docker — without Docker there is no DB |
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
              (10.0.2.2 from the emulator)
```

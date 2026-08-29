# Local Development

> **Current behaviour.**

Production runs entirely in the cloud: Azure Container Apps hosts the API, Azure Database for PostgreSQL holds the data. Nobody needs a local copy of either to use the app. This document is for whoever is changing `server/` or `mobile/` code and needs to run and test that change before it ships.

## Prerequisites (one-time install)

| Tool | For which part | Download |
|---|---|---|
| **Docker Desktop** | Backend + DB | docker.com |
| **Python 3.12** | Backend | python.org |
| **Node.js 20+** | Mobile | nodejs.org |
| **Android Studio** | Mobile (includes Android SDK + AVD) | developer.android.com/studio |

> **Backend only?** You only need Docker + Python.

## First-Time Setup

**One-time per machine. Run as Administrator:**

```powershell
.\scripts\setup.ps1
```

The script installs and configures:

- Docker Desktop, Python 3.12, Node.js (via winget if missing)
- `ANDROID_HOME`, `JAVA_HOME`, `PATH` (persistent env vars)
- Python venv + all dependencies
- `.env` created from `.env.example`
- Migrations + seed of demo data

> **Start Docker Desktop before you run it.** If Docker is not running, the script skips migrations and the seed, prints a warning, and still exits looking successful. You then get an app with no data and a login that fails. If that happens, start Docker and run:
>
> ```powershell
> cd server
> .venv\Scripts\activate
> alembic upgrade head
> python -m app.seed
> ```

**Safe to re-run.** When everything is already installed it skips every step and prints `Everything already set up, run .\scripts\dev.ps1`.

## Daily Workflow

### Full stack: backend, mobile, and emulator

```powershell
.\scripts\dev.ps1
```

The script starts, in order:

1. Docker Desktop, if it is not already running
2. The Android emulator (always with `-no-snapshot-load`)
3. PostgreSQL, the FastAPI server on port 3000, and Expo Metro on port 8081

Once it is up, press **`a`** in the Metro window to open the app on the emulator.

> **This is a dev build, not Expo Go.** The app depends on native modules (`expo-dev-client`, sensors, Bluetooth), so scanning the QR code with Expo Go will not work. Use the emulator, or install the dev build on a device.

### Backend only (without mobile)

```powershell
cd server
docker compose up db          # Window 1: PostgreSQL
.venv\Scripts\activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 3000   # Window 2: API
```

- API docs: http://localhost:3000/api/docs
- Health: http://localhost:3000/health

### Which server the app talks to

One file decides: [mobile/src/constants/serverConfig.ts](../mobile/src/constants/serverConfig.ts).

| `USE_REAL_SERVER` | Requests go to |
|---|---|
| `true` *(current setting)* | `STAGING_SERVER_URL`, the deployed Azure server |
| `false` | Metro's `/api/*` proxy → your local FastAPI on port 3000 |

**It is `true` today.** Your local server can be running perfectly and the app will still be reading cloud data. Set the flag to `false` when you want the emulator to hit your own backend.

## Environment Traps

Facts that cost hours and cannot be guessed from the code.

- **Two Alembic heads fail ~78 unrelated tests.** After switching branches or merging, the failures name missing columns and never mention migrations. Run `alembic upgrade head`, and confirm `alembic heads` returns exactly one, before debugging any missing-column error.
- **Tests share the development database.** Fixtures left behind by another branch break tests that have nothing to do with your change.
- **No Docker, no database.** Postgres runs in Docker; nothing server-side works without it.
- **Never run `alembic revision --autogenerate` to "set up" a fresh database.** The migrations are already written; `alembic upgrade head` is the whole job. Generating one manufactures the second head described above.
- **TypeScript is pinned in `mobile/`.** Install from `mobile/` so your local version matches the one the workspace builds against.

# CARMA

CARMA is a mobile platform that rates driving behavior in real time. Drivers earn a CARMA Score from GPS and IMU sensor data, and turn safe driving into points they can redeem with partner businesses.

**New here?** Install the [prerequisites](#prerequisites--one-time-install), run `.\scripts\setup.ps1` once, then `.\scripts\dev.ps1` every day. Everything else on this page is detail.

---

## Repository Map

### Engineering

| Folder | What it is | Technology |
|---|---|---|
| `server/` | Backend — API, DB, business logic | Python / FastAPI / PostgreSQL |
| `mobile/` | Mobile app | React Native / Expo |
| `docs/` | How the system works today | Markdown |
| `scripts/` | `setup.ps1`, `dev.ps1`, `dev-tunnel.ps1`, `smoke.sh` | PowerShell |
| `.github/` | CI and deployment workflows | GitHub Actions |
| `.claude/` | Rules for AI assistants working in this repo | Markdown |
| `screenshots/` | App screenshots used in docs and decks | PNG |

### Root documents

| File | What it holds |
|---|---|
| `SYSTEM.md` / `SYSTEM.he.md` | Full system reference — schema, API, deployment. English and Hebrew. |
| `CHANGELOG.md` | Every change to the HTTP contract and shared behaviour. |
| `CLAUDE.md` | The working contract for AI assistants. Written for agents, not for onboarding. |

### Product & non-engineering

| Folder | What it holds |
|---|---|
| `Hub/` | Entrepreneurship-workshop material — pitch deck, business model canvas, product requirements. No code depends on it. |

---

## Prerequisites — One-Time Install

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

The script installs and configures:

- Docker Desktop, Python 3.12, Node.js (via winget if missing)
- `ANDROID_HOME`, `JAVA_HOME`, `PATH` — persistent env vars
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

**Safe to re-run.** When everything is already installed it skips every step and prints `Everything already set up — run .\scripts\dev.ps1`.

### Demo credentials

`python -m app.seed` creates these accounts. All of them work in the app immediately.

| Account | Email | Password |
|---|---|---|
| Investor-demo primary | `ofridan@gmail.com` | `Dan1234` |
| Test driver | `daniel@carma.app` | `password123` |
| Demo protagonist | `yoni@carma.app` | `Yoni1234` |

Every seeded leaderboard driver also uses `password123`.

---

## Daily Workflow

### Full stack — backend + mobile + emulator

```powershell
.\scripts\dev.ps1
```

The script starts, in order:

1. Docker Desktop, if it is not already running
2. The Android emulator (always with `-no-snapshot-load`)
3. PostgreSQL, the FastAPI server on port 3000, and Expo Metro on port 8081

Once it is up, press **`a`** in the Metro window to open the app on the emulator.

> **This is a dev build, not Expo Go.** The app depends on native modules (`expo-dev-client`, sensors, Bluetooth), so scanning the QR code with Expo Go will not work. Use the emulator, or install the dev build on a device.

### Backend only — without mobile

```powershell
cd server
docker compose up db          # Window 1 — PostgreSQL
.venv\Scripts\activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 3000   # Window 2 — API
```

- API docs: http://localhost:3000/api/docs
- Health: http://localhost:3000/health

### Which server the app talks to

One file decides: [mobile/src/constants/serverConfig.ts](mobile/src/constants/serverConfig.ts).

| `USE_REAL_SERVER` | Requests go to |
|---|---|
| `true` *(current setting)* | `STAGING_SERVER_URL` — the deployed Azure server |
| `false` | Metro's `/api/*` proxy → your local FastAPI on port 3000 |

**It is `true` today.** Your local server can be running perfectly and the app will still be reading cloud data — set the flag to `false` when you want the emulator to hit your own backend.

---
fa
## Environment Traps

Facts that cost hours and cannot be guessed from the code.

- **Two Alembic heads fail ~78 unrelated tests.** After switching branches or merging, the failures name missing columns and never mention migrations. Run `alembic upgrade head`, and confirm `alembic heads` returns exactly one, before debugging any missing-column error.
- **Tests share the development database.** Fixtures left behind by another branch break tests that have nothing to do with your change.
- **No Docker, no database.** Postgres runs in Docker; nothing server-side works without it.
- **Never run `alembic revision --autogenerate` to "set up" a fresh database.** The migrations are already written — `alembic upgrade head` is the whole job. Generating one manufactures the second head described above.
- - **TypeScript is pinned in `mobile/`.** Install from `mobile/` so your local version matches the one the workspace builds against.

---

## Working Here

### Definition of done

A change is done when every surface it touched passes locally. CI is the last line of defense, not the first.

| Touched | Must be green |
|---|---|
| `mobile/**` | `npx tsc --noEmit` · `npm run lint` · `npm test -- --no-coverage` |
| `server/**` | `mypy app` · `ruff check .` · `pytest` |
| An API contract or DTO | Both rows above — and `server/app/schemas/` and `mobile/src/types/index.ts` are synced **by hand** |

### Branches

- **`main`** — deployable. Merged from `develop` at deliberate milestones only. Never commit directly.
- **`develop`** — daily integration. Keep it green.
- **`feature/*`** — anything over ~30 minutes or touching more than 2 files. Merges into `develop` freely.

**The author merges, not the reviewer** — only the author knows what else is in flight. Approve means "this is yours to land."

### Issues — Linear only

Every issue lives in Linear and is referred to by its `CAR-` number. **Never open a GitHub issue** — the sync creates in one direction only, so a GitHub issue silently mints a Linear twin with a different number. Search Linear before opening anything, put the `CAR-` id in the branch name or PR title (`ofridan/car-39-...`), and give every issue an assignee.

---

## Architecture

```
                       ┌─ USE_REAL_SERVER = true ──→ Azure Container App ──→ PostgreSQL
mobile (Expo dev build)┤
                       └─ USE_REAL_SERVER = false ─→ Metro :8081 /api/* proxy
                                                          │
                                                          ↓
                                                   FastAPI :3000 ──→ PostgreSQL :5432
                                                                        (Docker)
```

---

## Further Reading

| Document | What it answers |
|---|---|
| [SYSTEM.md](SYSTEM.md) | The full reference — schema, every endpoint, auth flows, CI/CD, Azure. |
| [docs/scoring.md](docs/scoring.md) | How the CARMA Score is actually computed. |
| [docs/fraud-detection.md](docs/fraud-detection.md) | The anti-fraud architecture we build toward — threat model, gates, contracts. |
| [docs/RFC-001-Hybrid-Validation.md](docs/RFC-001-Hybrid-Validation.md) | *History, not current behaviour.* Why trip validation was split between client and server in May 2026. Parts are superseded — the banner says which. |
| [docs/i18n.md](docs/i18n.md) | Hebrew / English handling. |
| [mobile/STRUCTURE.md](mobile/STRUCTURE.md) | What belongs in every folder under `mobile/src/`. Read before adding a file. |
| [CHANGELOG.md](CHANGELOG.md) | What changed in the API contract, and when. |

# CARMA - Unified Monorepo Configuration

## Project Context

CARMA is a mobile platform that monitors and rates driving behavior in real-time to improve road safety via gamification.

This repository is a clean npm-workspaces Monorepo containing the React Native mobile client, the FastAPI backend server, and a local mock server for development.

## Core Team Roles

- **Dan (CTO & CPO):** Core AI/ML scoring formula, CARMA Score algorithm, development roadmap prioritization, and anti-fraud mechanics.
- **Naveh (Chief Architect & Data Engineer):** Database architecture, cache layers, data pipelines, and Monorepo structure integrity.
- **Shaun (CEO & Backend Developer):** Business logic API endpoints, cloud infrastructure (Azure), and third-party integrations.
- **May (Mobile & Frontend UI Lead):** Mobile application screens, UI components and styling, **Driving SDK — IMU/GPS/BLE sensor integration**, battery consumption management, and client-side interactions.

---

## Design Philosophy — Keep It Simple

The guiding principle across all of CARMA's development is **simplicity**. This is not a constraint — it is a competitive advantage. Every technical decision should be weighed against it.

In practice this means:

- **Build what is needed now.** No abstractions for hypothetical future requirements. Three similar lines of code are better than a premature helper.
- **Solve the real problem.** Before adding a layer, a config flag, or a new file — ask whether removing something solves it instead.
- **Readable beats clever.** Code is read far more than it is written. Optimise for the next person reading it (often you, six months from now).
- **Small, complete units of work.** A feature that ships is worth more than a perfect architecture that doesn't. Scope ruthlessly.
- **Visible complexity is honest.** If something is genuinely complex (sensor fusion, fraud detection, scoring formulas), let it be visible and well-named — not hidden behind indirection.

When in doubt: choose the simpler solution.

---

## Repository Layout

```
carma/
├── mobile/                  ← React Native (Expo) — workspace: "carma-app"
├── server/                  ← FastAPI + PostgreSQL — Python, outside npm workspaces
├── docs/                    ← Architecture & algorithm docs (docs/archive/ for retired specs)
├── scripts/                 ← dev.ps1, setup.ps1, dev-tunnel.ps1, smoke.sh
└── .github/workflows/       ← ci-server.yml, ci-mobile.yml, deploy.yml
```

---

## Workspace Layout & Commands

### Quick Start (Full Stack)

```
.\scripts\dev.ps1
```

Starts Docker, Postgres, FastAPI on :3000, Metro bundler, and Android emulator in parallel. Use this for day-to-day development. The individual commands below are for running each service in isolation.

### Mobile Client (React Native / Expo)

- **Path:** `./mobile`
- **Install:** `cd mobile && npm install`
- **Start:** `npm run mobile:start` (from root) or `npm start` (from `./mobile`)
- **Run Tests:** `cd mobile && npm test -- --no-coverage`
- **Lint:** `cd mobile && npm run lint`
- **TypeScript check:** `cd mobile && npx tsc --noEmit`

### Backend Server (FastAPI / PostgreSQL)

- **Path:** `./server`
- **Install:** `pip install -r server/requirements-dev.txt`
- **Run (dev):** `cd server && uvicorn app.main:app --reload`
- **DB Migrations:** `cd server && alembic upgrade head`
- **Lint:** `cd server && ruff check . && ruff format --check .`
- **Tests:** `cd server && pytest`

---

## CI/CD

All three workflows trigger on push or PR to `main` only — pushing to `develop` does not run CI.

| Workflow | What it does |
|---|---|
| `ci-server.yml` | Ruff lint, Mypy, DB migrations, pytest, smoke tests |
| `ci-mobile.yml` | TypeScript check, Jest, API contract drift check (regenerates types from live OpenAPI and diffs against `mobile/src/types/index.ts`) |
| `deploy.yml` | Builds Docker image → pushes to ACR → deploys to Azure Container App. Has a built-in secrets gate: if `AZURE_CREDENTIALS` is not configured in GitHub Secrets the deploy step is silently skipped — CI stays green. |

**Before merging `develop` → `main`:** run `pytest` and `npx tsc --noEmit` locally. CI is the last line of defense, not the first.

---

## Branching Strategy

- **`main`** — stable and deployable. Merged from `develop` only at deliberate milestones (demo, cloud deploy, sprint end). Never commit directly.
- **`develop`** — daily integration branch. All feature branches merge here. Tests must pass before merging.
- **`feature/*`** — short-lived branches for any change that takes more than ~30 minutes or touches more than 2 files. Merge freely into `develop` — no PR or review required.

The rule: `develop` is the buffer that protects `main`. Keep it green.

---

## Engineering Rules

1. **Shared Types:** Any change to API contracts or DTOs MUST be manually synchronized between `server/app/schemas/` and `mobile/src/types/index.ts`. Never let the two drift. The `gen:api` script in mobile (`openapi-typescript`) is available to automate this once the OpenAPI schema is stable — until then, sync manually. The CI (`ci-mobile.yml`) enforces this automatically on every merge to `main`.

### Mobile Directory Ownership

The `mobile/` workspace has a strict layer separation documented in **`mobile/STRUCTURE.md`**.
Read it before adding or moving any file under `mobile/src/`.

Critical boundary — `mobile/src/lib/driving-sdk/`:
- This is a **generic sensor-wrapper SDK** (GPS, IMU, Bluetooth). It will be extracted into a standalone npm package.
- It must contain **only** hardware-abstraction code: `BluetoothManager`, `SensorManager`, `PhoneUsageManager`, `DrivingSDK` (orchestrator, `index.ts`), and `types.ts`.
- **Never add** CARMA-specific logic here: trip validation rules, fraud detection thresholds, gamification levels, scoring formulas, or any business constants.
- CARMA-specific logic that consumes SDK events belongs in `mobile/src/lib/` (directly, not inside `driving-sdk/`): see `FraudDetector.ts`, `TripValidationManager.ts`, `gamification.ts`, `scoring.ts`.

## Working with Claude

### Dan's Developer Persona (Active when user is Dan)

1. **Full CTO Autonomy:** You hold complete executive authority to read, write, modify files, and execute deployment/git workflows autonomously.
2. **One-Shot Execution:** Do not halt tasks to request micro-confirmations or generate abstract implementation plans unless extreme ambiguity is present.
3. **Guardrails Action:** If local test suites pass successfully, you are authorized to auto-commit and merge local feature branches. Do NOT force-push directly to remote `main` if shared team history is modified without direct user input.

*Other team members can add their own persona section here.*


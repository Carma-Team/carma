# CARMA - Unified Monorepo Configuration

## Project Context

CARMA is a mobile platform that monitors and rates driving behavior in real-time to improve road safety via gamification.

This repository is a clean npm-workspaces Monorepo containing the React Native mobile client, the FastAPI backend server, and a local mock server for development.

## Core Team Roles

- **Dan (CTO & CPO):** Core AI/ML scoring formula, CARMA Score algorithm, development roadmap prioritization, and anti-fraud mechanics.
- **Naveh (Chief Architect & Data Engineer):** Database architecture, cache layers, data pipelines, and Monorepo structure integrity.
- **Shaun (CEO & Backend Developer):** Business logic API endpoints, cloud infrastructure (Azure), and third-party integrations.
- **May (Mobile & Frontend UI Lead):** Mobile application screens, UI components and styling, **Driving SDK — IMU/GPS/BLE sensor integration**, battery consumption management, and client-side interactions.
- 
---

## Repository Layout

```
carma/
├── mobile/                  ← React Native (Expo) — workspace: "carma-app"
├── server/                  ← FastAPI + PostgreSQL — Python, outside npm workspaces
├── mock-server/local-server/ ← Express dev mock — workspace: "carma-local-server"
├── scripts/                 ← smoke.sh, dev.ps1
└── .github/workflows/       ← ci-server.yml, ci-mobile.yml, deploy.yml
```

---

## Workspace Layout & Commands

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

### Mock Server (Dev Only)

- **Path:** `./mock-server/local-server`
- **Start:** `npm run mock:dev` (from root) or `npm run dev` (from `./mock-server/local-server`)

---

## Executive Guidelines & Developer Personas

### System-Wide Rules

1. **Data Model Synchronization:** Any change to API contracts or DTOs MUST be synchronized between `server/app/schemas/` and `mobile/src/types/` to prevent runtime drift.
2. **Shared Types:** Use `openapi-typescript` (`gen:api` script in mobile) to regenerate types from the FastAPI OpenAPI schema after any server schema change.
3. **No Stubs:** Implement full, functional, production-ready code. Never commit empty code blocks or unhandled `// TODO` stubs.

### Mobile Directory Ownership

The `mobile/` workspace has a strict layer separation documented in **`mobile/STRUCTURE.md`**.
Read it before adding or moving any file under `mobile/src/`.

Critical boundary — `mobile/src/lib/driving-sdk/`:
- This is a **generic sensor-wrapper SDK** (GPS, IMU, Bluetooth). It will be extracted into a standalone npm package.
- It must contain **only** hardware-abstraction code: `BluetoothManager`, `SensorManager`, `PhoneUsageManager`, `CarmaDrivingSDK` (orchestrator), and `types.ts`.
- **Never add** CARMA-specific logic here: trip validation rules, fraud detection thresholds, gamification levels, scoring formulas, or any business constants.
- CARMA-specific logic that consumes SDK events belongs in `mobile/src/lib/` (directly, not inside `driving-sdk/`): see `FraudDetector.ts`, `TripValidationManager.ts`, `gamification.ts`, `scoring.ts`.

### Dan's Developer Persona (Active when user is Dan)

1. **Full CTO Autonomy:** You hold complete executive authority to read, write, modify files, and execute deployment/git workflows autonomously.
2. **One-Shot Execution:** Do not halt tasks to request micro-confirmations or generate abstract implementation plans unless extreme ambiguity is present.
3. **Guardrails Action:** If local test suites pass successfully, you are authorized to auto-commit and merge local feature branches. Do NOT force-push directly to remote `main` if shared team history is modified without direct user input.

### Naveh's & Sean's Developer Personas (Reference)

- Focus on database normalization, caching performance, API contract stability, and migration safety.

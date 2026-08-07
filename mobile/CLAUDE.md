# Mobile Workspace — Claude Code Instructions

This file is read automatically by Claude Code when working inside `mobile/`.
It supplements the root `CLAUDE.md` with mobile-specific boundaries.

## Authoritative structure reference

Before creating or moving any file, read **`mobile/STRUCTURE.md`**.
It defines the purpose of every directory, what belongs in each one, and what is forbidden.

## Layer rules (enforced)

| Layer | Path | Rule |
|---|---|---|
| SDK | `src/lib/driving-sdk/` | Generic hardware only. No CARMA business logic. See its own README. |
| Business logic | `src/lib/` | Pure TypeScript, no React. No direct server calls. |
| Global state | `src/context/` | React Context only. Server calls triggered by SDK events live here. |
| UI components | `src/components/` | Presentational. No direct API calls. |
| Screens | `src/screens/` | Compose components + hooks. No inline business logic. |
| API layer | `src/services/api/` | Request/response shaping only. No business decisions. |
| Types | `src/types/` | Generated via `npm run gen:api`. Do not edit manually. |

## `driving-sdk/` — hard boundary

`src/lib/driving-sdk/` is a standalone extractable SDK. It wraps device sensors and Bluetooth.
**Do not add anything here that is specific to the CARMA application.**

Files that must NOT be inside `driving-sdk/`:
- Trip validation rules (start/end thresholds) → `src/lib/TripValidationManager.ts`
- Fraud / transport-mode detection → `src/lib/fraud-detection/`
- Gamification levels, point multipliers → `src/lib/gamification.ts`
- Scoring formulas → `src/lib/trip-scoring/`

Test before asking: *"If a different app used this SDK, would this file make sense?"*
If the answer is no — it belongs in `src/lib/`, not in `driving-sdk/`.

## File headers — every file under `src/lib/` states who owns it

Each file opens with a JSDoc block carrying three tags, and nothing else is mandatory:

```ts
/**
 * @file FraudDetector.ts
 * @owner Dan (CPO) — fraud & transport-mode detection
 * @brief Sliding-window classifier that decides whether a session is private car travel.
 * Buffers 60 samples of speed, lateral acceleration and yaw rate, scores three weighted
 * signals against a 0.70 threshold, and reports the transport mode plus raw telemetry.
 */
```

- **`@owner`** — the person who decides what this file does, not whoever edited it last. Use `Shared` when a file genuinely cannot be split by owner, and say who holds which half. Files inside `driving-sdk/` name the maintainer without a CARMA job title, because the library is meant to be extracted and a role from this org means nothing to whoever receives it.
- **`@brief`** — two sentences. **The same two sentences appear in the `lib/` table in `STRUCTURE.md`.** One wording, two places; if you change one, change the other in the same commit.
- Existing `@description` blocks, threshold reasoning and inline comments stay where they are — the header sits above them, it does not replace them.

Why it exists: two people work inside `lib/`, and the folders `fraud-detection/` and `trip-scoring/` are the visible half of that boundary. The header is the half you see once the file is already open.

These tags are JSDoc, which is what TypeDoc reads. Doxygen does not support TypeScript — if we ever generate an API reference, TypeDoc is the tool, and scoping it to `driving-sdk/` is the case worth making.

## Server config — builds vs. dev

`constants/serverConfig.ts` controls where API calls go:

| Flag | Value | Where requests go |
|---|---|---|
| `USE_REAL_SERVER` | `false` | Metro proxy → local mock server (Expo Go / dev client only) |
| `USE_REAL_SERVER` | `true` | `STAGING_SERVER_URL` (real or cloud-hosted server) |

### Current state (as of branch `feature/beta-improvements`)

`USE_REAL_SERVER = true` and `STAGING_SERVER_URL` is set to the cloud server URL.
The app is configured to talk to the real backend — **not** the local mock server.

### Before the next APK/IPA build

The mobile side is ready. The build is **blocked on the backend** until the following are confirmed:

| # | What | Owner |
|---|---|---|
| 1 | FastAPI server deployed and running at the URL set in `STAGING_SERVER_URL` | Backend |
| 2 | PostgreSQL database provisioned and reachable from the server | Backend |
| 3 | All environment variables set (see `server/.env.example`) | Backend |
| 4 | Database migrations applied (`alembic upgrade head`) | Backend |
| 5 | `GET <server-url>/health/live` returns HTTP 200 | Backend |

Once all five are confirmed, run:
```bash
cd mobile
eas build -p android --profile preview   # Android APK
eas build -p ios     --profile preview   # iOS IPA (requires Apple Developer account)
```

Full step-by-step instructions are in **`docs/SERVER-INTEGRATION-SETUP.md`** (repo root level, outside `mobile/`).

## Disabled features — pattern

Features that are implemented but not yet active in the UI are wrapped in comments marked `// EVT_<NAME> disabled — uncomment when re-enabling`. Do not delete these blocks.

Current disabled features:

| Feature | Marker | Files affected |
|---|---|---|
| Swerve detection (`SWERVE`) | `// EVT_SWERVE disabled` | `SensorManager.ts`, `index.ts` (SDK), `AppContext.tsx`, `ActiveTripMonitor.tsx`, `TripSummaryModal.tsx`, `TripDetailScreen.tsx`, `he.ts`/`en.ts` |

When re-enabling: search for the marker across the repo and uncomment all matching blocks. Also make `swerves` required again in `TelemetryDigest`, `ValidTripPayload`, and `ScoringInput`.

## Commands

```bash
npm start                  # Expo dev server
npm test -- --no-coverage  # Jest
npm run lint               # ESLint
npx tsc --noEmit           # TypeScript check
npm run gen:api            # Regenerate types from server OpenAPI schema
```

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
- Fraud / transport-mode detection → `src/lib/FraudDetector.ts`
- Gamification levels, point multipliers → `src/lib/gamification.ts`
- Scoring formulas → `src/lib/scoring.ts`

Test before asking: *"If a different app used this SDK, would this file make sense?"*
If the answer is no — it belongs in `src/lib/`, not in `driving-sdk/`.

## Server config — builds vs. dev

`constants/serverConfig.ts` controls where API calls go:

| Flag | Value | Where requests go |
|---|---|---|
| `USE_REAL_SERVER` | `false` | Metro proxy → local mock server (Expo Go / dev client only) |
| `USE_REAL_SERVER` | `true` | `STAGING_SERVER_URL` (real or Render-hosted server) |

**Before building an APK/IPA for device testing:** set `USE_REAL_SERVER = true` and set `STAGING_SERVER_URL` to the live server URL. Do not commit this change to `main` — it is build-time configuration.

## Disabled features — pattern

Features that are implemented but not yet active in the UI are wrapped in comments marked `// EVT_<NAME> disabled — uncomment when re-enabling`. Do not delete these blocks.

Current disabled features:

| Feature | Marker | Files affected |
|---|---|---|
| Swerve detection (`SWERVE`) | `// EVT_SWERVE disabled` | `SensorManager.ts`, `index.ts` (SDK), `AppContext.tsx`, `scoring.ts`, `ActiveTripMonitor.tsx`, `TripSummaryModal.tsx`, `TripDetailScreen.tsx`, `he.ts`/`en.ts` |

When re-enabling: search for the marker across the repo and uncomment all matching blocks. Also make `swerves` required again in `TelemetryDigest`, `ValidTripPayload`, and `ScoringInput`.

## Commands

```bash
npm start                  # Expo dev server
npm test -- --no-coverage  # Jest
npm run lint               # ESLint
npx tsc --noEmit           # TypeScript check
npm run gen:api            # Regenerate types from server OpenAPI schema
```

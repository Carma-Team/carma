# Mobile Workspace — Claude Code Instructions

This file is read automatically by Claude Code when working inside `mobile/`.
It supplements the root `CLAUDE.md` with mobile-specific boundaries.

## Authoritative structure reference

Before creating or moving any file, read **`mobile/STRUCTURE.md`**.
It defines the purpose of every directory, what belongs in each one, and what is forbidden.

**Every change under `mobile/` follows that hierarchy — no exceptions, including changes
that only pass through on the way to something else.** Pure logic goes in `lib/`, server
shaping in `services/`, global state in `context/`, presentation in `components/`. Adding
code to whichever file already happens to be open is how a 763-line `AppContext.tsx`
happened: 146 lines of SHA-256 sat in a React context for a whole sprint while three
documents in this repo said it belonged in `lib/`.

Two costs, both paid later:
- **Ownership blurs.** A file that several people edit for unrelated reasons becomes the
  file everyone conflicts on. `mobile/STRUCTURE.md` now records an owner per file — keep
  it accurate, and give a block its own file when it has a clear single owner.
- **Bugs hide.** Finding a defect in a 700-line file that mixes four concerns costs far
  more than finding it in a named 40-line one.

If a change does not fit the hierarchy, that is a signal to discuss the structure — not
to make the exception quietly.

## Layer rules (enforced)

| Layer | Path | Rule |
|---|---|---|
| SDK | `src/lib/driving-sdk/` | Generic hardware only. No CARMA business logic. See its own README. |
| Business logic | `src/lib/` | Pure TypeScript, no React. No direct server calls. |
| Global state | `src/context/` | React Context only. Server calls triggered by SDK events live here. |
| UI components | `src/components/` | Presentational. No direct API calls. |
| Screens | `src/screens/` | Compose components + hooks. No inline business logic. |
| API layer | `src/services/api/` | Request/response shaping only. No business decisions. |
| Types | `src/types/` | Aliases over `src/services/api/generated.ts`, which `gen:api` writes and we commit. Hand-write only what the schema cannot express — see the root CLAUDE.md. |

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

`src/constants/serverConfig.ts` controls where API calls go:

| Flag | Value | Where requests go |
|---|---|---|
| `USE_REAL_SERVER` | `false` | Metro proxy → local mock server (Expo Go / dev client only) |
| `USE_REAL_SERVER` | `true` | `STAGING_SERVER_URL` (real or cloud-hosted server) |

`USE_REAL_SERVER = true` today, pointed at the deployed Azure Container App. The app talks to the real backend, **not** the local mock server.

### Builds

The cloud backend is live, so a build is not blocked on it. Confirm `GET <STAGING_SERVER_URL>/health/live` returns 200, then:

```bash
cd mobile
eas build -p android --profile preview   # Android APK
eas build -p ios     --profile preview   # iOS IPA (requires Apple Developer account)
```

Before a device build, confirm `USE_REAL_SERVER = true` and that `STAGING_SERVER_URL` points at the
deployed server — `serverConfig.ts` is the only file that decides this. Server-side environment
variables are documented in `server/.env.example`.

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
npm run gen:api            # Rewrites src/services/api/generated.ts from a server running
                           # on :3000. Commit the result; src/types/ aliases it.
```

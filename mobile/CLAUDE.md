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
- Fraud / transport-mode detection → `src/lib/FraudDetector.ts`
- Gamification levels, point multipliers → `src/lib/gamification.ts`
- Scoring formulas → nowhere in the client. The server is the sole scoring oracle; the app renders
  what `POST /api/trips` returns and computes no part of it, and no input to it.

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
- **`@brief`** — two sentences, also repeated in the `lib/` table in `STRUCTURE.md`. **The header is the current one**: it is written by whoever changed the file, and `STRUCTURE.md` is realigned to it afterwards. Never edit the table and leave the header behind.
- The header replaces the older `@fileoverview` / `@module` pair, which said the same thing in more lines. Everything below it — `@description`, `@remarks`, threshold reasoning, inline comments — stays exactly where it is.

**Before editing a file under `src/lib/` whose `@owner` is not the developer you are working for: stop.** Say what you want to change and why, and ask for explicit confirmation. Do not edit first and mention it after. This is the whole point of the header — two people work inside `lib/`, both of them through Claude Code, and a file that changes hands silently is discovered by the other owner days later, in a `git pull`.

These tags are JSDoc, which is what TypeDoc reads. Doxygen does not support TypeScript — if we ever generate an API reference, TypeDoc is the tool, and scoping it to `driving-sdk/` is the case worth making.

## Server config — builds vs. dev

`src/constants/serverConfig.ts` controls where API calls go:

| Flag | Value | Where requests go |
|---|---|---|
| `USE_REAL_SERVER` | `false` | Metro proxy → the FastAPI server running locally (Expo Go / dev client only) |
| `USE_REAL_SERVER` | `true` | `STAGING_SERVER_URL` (real or cloud-hosted server) |

`USE_REAL_SERVER = true` today, pointed at the deployed Azure Container App. Either setting reaches the real API — the flag chooses which host it runs on, not whether it is real. There has been no mock server since `carma-local-server` was deleted.

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

A feature that is implemented but not active is kept as a document, not as commented-out code. The implementation moves into a markdown file next to the code it came from, and the code file is left with a single line saying where it went. Commented-out code is invisible to the type checker, the linter and the tests, so it rots while still costing every reader who scrolls past it.

No feature is disabled right now. Swerve detection was the last one, and CAR-150 decided it out permanently rather than deferred, so its document and its event type were deleted rather than kept for a restore.

## Commands

```bash
npm start                  # Expo dev server
npm test -- --no-coverage  # Jest
npm run lint               # ESLint
npx tsc --noEmit           # TypeScript check
npm run gen:api            # Rewrites src/services/api/generated.ts from a server running
                           # on :3000. Commit the result; src/types/ aliases it.
```

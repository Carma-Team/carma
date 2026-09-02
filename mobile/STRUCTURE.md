# Mobile App — Directory Structure

This document defines the purpose, ownership, and boundaries of every directory under `mobile/src/`.
It is the authoritative reference for deciding where to place a new file.

---

## Top-level map

```
mobile/src/
├── app/            ← Expo Router — screens and navigation
├── components/     ← React Native UI components, grouped by domain
├── constants/      ← App-wide constants (theme, config, server)
├── context/        ← React Context — global state management
├── hooks/          ← Custom React hooks
├── i18n/           ← Translations (Hebrew / English)
├── lib/            ← Business logic and pure-function utilities (NO React)
├── screens/        ← Full-screen views referenced from app/
├── services/       ← Server communication layer (API calls, sync)
└── types/          ← Shared TypeScript types (synced with backend schemas)
```

---

## `app/`

Expo Router file-system routing. Each file here is a route.

| Path | What goes here |
|---|---|
| `(tabs)/(home)/` | Tab-bar screens: dashboard, active trip, trip detail |

**Rules:**
- Files here are route entry points only — keep them thin.
- No business logic. Import from `screens/`, `context/`, or `hooks/`.
- Do NOT put components or utilities here.

---

## `components/`

Reusable React Native components, organised by product domain.

| Subfolder | Contents |
|---|---|
| `dashboard/` | Stats widgets, summary cards for the home screen |
| `driving/` | Active-trip UI: speed gauge, event indicators, countdown |
| `gamification/` | Level badge, roadmap items, progress bar, bonus cards |
| `marketplace/` | Reward tiles, redemption flow components |
| `social/` | Leaderboard rows, profile header, friend cards |
| `ui/` | Generic, domain-agnostic components (Button, Card, Toast, Modal, Stat) |

**Rules:**
- Components must be presentational or lightly connected to context.
- No direct API calls inside components — use hooks or context instead.
- A component that is used in only one screen can live in `screens/` alongside it.

---

## `constants/`

App-wide static values with no business logic.

| File | Contents |
|---|---|
| `serverConfig.ts` | `USE_REAL_SERVER` flag + `STAGING_SERVER_URL` — the **only** place that controls which server the app talks to |
| `theme.ts` | Colour palette, font sizes, spacing scale |
| `index.ts` | Re-exports + level-lookup helpers that depend on runtime data from the server |

**Rules:**
- No functions with logic. Pure data.
- Exception: `index.ts` may hold `getLevelByPoints` / `setLevels` because level data arrives from the server at runtime and cannot be a plain constant.

**`serverConfig.ts` — current state:** `USE_REAL_SERVER = true`, pointing at the cloud server.
To switch back to local development, set `USE_REAL_SERVER = false`.
Build commands live in `mobile/CLAUDE.md` §Builds.

---

## `context/`

React Context providers — global state accessible from anywhere in the component tree.

| File | Contents | Owner |
|---|---|---|
| `AppContext.tsx` | The provider itself: authenticated user, trip list, toasts, language, Bluetooth target, offline sync. Owns the `DrivingSDK` instance and composes the binding modules below. | May |
| `tripState.ts` | `TripState` shape + `INITIAL_TRIP_STATE`. Imported by the provider *and* the bindings, which is what keeps them out of an import cycle. | shared |
| `sdkBindings.ts` | Trip lifecycle callbacks — `onTripStart`, `onUpdate`, `onTripEnd` → React state. Sensor plumbing only. | May |
| `scoringEvents.ts` | `sdk.on()` listeners and CARMA's speed thresholds; maintains the per-trip event counters. | Dan |
| `fraudBinding.ts` | `onFraudDetected` → state reset + `fraudApi.syncInvalidTrip()`. | Dan |
| `regionBinding.ts` | `onRegionRejected` → state reset + toast. No server call — the trip never happened as far as CARMA is concerned. | May |
**Rules:**
- Context is the bridge between the SDK/lib layer and the UI layer.
- Server calls triggered by SDK events (e.g. `tripsApi.save()` after `onTripEnd`, `fraudApi.syncInvalidTrip()` after `onFraudDetected`) live here.
- Do not add unrelated state to `AppContext` — create a separate context file if needed.
- **Split by owner, not only by cohesion.** The table above assigns each file to one
  person. A file that both a scoring change and a UI change have to touch is the file
  that produces merge conflicts, so when a block has a clear single owner, give it its
  own file and record the owner here.
- **A binding module must never import from `AppContext.tsx`.** The provider imports
  *them*, so an import back forms a cycle. Type-only cycles are erased at compile time
  and are harmless; a cycle over a *value* is not — one side reads `undefined` during
  module init, and load order can differ between the dev bundle and a release build.
  Shared values belong in `tripState.ts` or another leaf module.

---

## `hooks/`

Custom React hooks that encapsulate stateful logic for reuse across screens and components.

| File | Contents |
|---|---|
| `useDriveMode.ts` | SDK interaction during an active trip (start/stop, event subscription) |
| `useTrip.ts` | Trip list access and trip detail helpers |
| `useTranslation.ts` | Wraps `i18n` for component use |

**Rules:**
- Hooks may use context, services, and lib — but not import from `components/` or `screens/`.
- If a hook grows large, extract pure logic into `lib/` and keep only the React plumbing in the hook.

---

## `i18n/`

Translation strings for Hebrew and English.

**Rules:**
- One file per language.
- Keys must match between language files — missing keys break the UI.
- No logic. Plain string maps only.

---

## `lib/`

**Pure TypeScript business logic with no React dependencies.**
This is the most important layer to keep clean. Files here must be independently testable.

Every file below opens with a `@file` / `@owner` / `@brief` header, and the Contents column
here repeats that `@brief`. **Where the two differ, the header in the code is the current one** —
it is written by whoever changed the file. This table is a map: it is what you read to see the
whole layer at once, or to check that a change landed where it belongs, and it is brought back
into line after a batch of changes rather than in every commit. The convention itself is
documented in `mobile/CLAUDE.md`.

| File | Owner | Contents |
|---|---|---|
| `TripValidationManager.ts` | May | CARMA's implementation of the SDK's generic `TripValidator` interface. A 1 Hz state machine that decides when a trip starts (Rule 1), when it ends (Rule 2), and runs the fraud check before confirming it and again while it runs (Rule 3). |
| `gamification.ts` | Shared | Turns the level the server reported into what the UI shows: label, band, progress. Computes no level and applies no multiplier — every value here is a lookup or a percentage. |
| `constants.ts` | Shared | The 10-tier level ladder held as a first-paint cache, replaced by `GET /api/levels`. Also holds the reward-category list used by the marketplace screen. |
| `notifications.ts` | May | Every decision made about a notification, with no React and no API calls. What a row says, where tapping it leads, which rows earn a badge, and what the screen shows after a request fails. |
| `utils.ts` | May | Generic display formatting shared across screens and components. Numbers, distances, durations, dates and relative times in Hebrew and English, plus score/level to icon, colour and grade mappings. |
| `authErrors.ts` | May | Turns a failed auth request into a message the driver can read. Maps the HTTP status onto a translation key, per screen, and never shows the server's own `detail` — that string is always English. |
| `BatteryOptimizationPrompt.ts` | May | CARMA's nudge asking the driver to exempt the app from Android battery optimization (#17). Wraps the generic platform check in `driving-sdk/PowerManagement` and decides when to ask, what to say, and that it is asked only once. |
| `rewardStock.ts` | Shaun | The reward-stock rules the marketplace uses. Formats the "left out of allocated" line, parses the stock field where blank means no cap, and decides what counts as sold out — for the card that disables it and the list that sorts it down. |
| `FraudDetector.ts` | Dan | Sliding-window classifier that decides whether a session is private car travel. Buffers 60 samples of speed, lateral acceleration and yaw rate, scores three weighted signals against a 0.70 threshold, and reports the transport mode plus raw telemetry. |
| `transportMode.ts` | Dan | The transport modes `FraudDetector` classifies a session into. Lives in CARMA rather than in `driving-sdk` because "was this a train" is this product's question, not a sensor library's. |
| `weeklyTrend.ts` | May | Week-over-week driving trend from the trips the client already holds. Averages the scored trips of the last seven days against the seven before them and reports the direction between them; rolling windows rather than calendar weeks, which need a first day that differs by locale. |
| `tripEvents.ts` | May | Adapts the server's trip-event timeline into the SDK's `DrivingEvent` shape. Lives here rather than in the map component because the mismatch is in the data, not in the rendering. |
| `tripSummary.ts` | May | One shape for the end-of-trip summary, built either from the device's own trip data or from a trip the server returned. Both summary surfaces render this shape, so neither can show a field the other does not. |
| `regionCheck.ts` | May | Israel-only region check (team decision). Tests a fix the SDK already holds against an offline bounding box — no network, no permission request of its own, and no dependency on a geocoder's answer. |
| `telemetrySigning.ts` | Shared | Signs the RFC-001 telemetry digest: canonical JSON over a hand-written SHA-256 and HMAC-SHA256 (FIPS 180-4 / FIPS 198-1). The primitive is hand-written because the app has no crypto dependency and cannot get one — expo-crypto ships no HMAC, Hermes exposes neither `crypto.subtle` nor `node:crypto`, a native module would break Expo Go, and the single caller signs synchronously inside the end-trip path. |
| `driving-sdk/` | May | **Sensor-wrapper SDK** — its files are documented in its own README, deliberately not here |
| `__tests__/` | — | Unit tests for the files directly under `lib/` |

**Rules:**
- No React, no `useState`, no `useEffect`, no imports from `components/` or `context/`.
- No direct server calls — lib functions are pure transformations.
- Tests live in `__tests__/` and must not require a running server or device.

### `lib/` — ownership boundary

Two people work inside `lib/`. Fraud detection (deciding a session is not the driver privately
driving their own car) is Dan's; the trip lifecycle, the SDK and the UI layer are May's. That
split is carried by the `@owner` header on each file and by the Owner
column above — not by the directory tree, so a file can change hands without moving path.

**Rules:**
- **Before editing a file whose `@owner` is someone else, say what you intend to change and get
  their agreement.** The header is there to be read before the edit, not found afterwards in a diff.
- A helper both owners need goes to `utils.ts`, so neither side imports from the other's file for
  something generic.
- Nothing that is fraud or scoring may live inside `driving-sdk/`. The SDK has no awareness
  that its output is used for scoring or for catching a train ride.
- **A file that genuinely cannot be split by owner is not split.** `constants.ts` and
  `gamification.ts` stay where they are, marked `Shared`, with the header saying who holds which
  half. Tearing apart code that belongs together to satisfy the boundary is the wrong trade.

### `lib/driving-sdk/` — scope boundary

`driving-sdk/` is a **separate SDK** maintained independently. It wraps device hardware (GPS, IMU, Bluetooth) and emits generic events. **Read its README before touching anything inside it.**

The critical rule: **do not add CARMA application logic to `driving-sdk/`.**
If you are writing code that uses sensor events to make a CARMA-specific decision, it belongs in `lib/` (directly under it), not inside `driving-sdk/`.

Examples:
- New fraud signal for bus detection → `lib/FraudDetector.ts`
- New gamification rule → `lib/gamification.ts`
- New sensor type or Bluetooth feature → `lib/driving-sdk/` (after confirming it is generic)

---

## `screens/`

Full-screen React Native views. Routed via `app/`.

| Subfolder | Contents |
|---|---|
| `app/` | Authenticated screens: Dashboard, Active Trip, Trip Detail, Profile, Roadmap, Leaderboard, Marketplace, Settings |
| `auth/` | Unauthenticated screens: Login, Register, Onboarding, Unsupported Device |

**Rules:**
- Screens compose components, use hooks, and read from context.
- Business logic belongs in `lib/` or `context/`, not inline in a screen.
- A screen-specific sub-component that is not reused elsewhere may live in the same folder as the screen.

---

## `services/`

All outbound network communication. No business logic — only request/response shaping.

### `services/api/`

One file per backend resource.

| File | Backend route group |
|---|---|
| `client.ts` | Native `fetch` wrapper — attaches auth token, handles HTTP errors, switches between mock and real server via `USE_REAL_SERVER` flag in `constants/serverConfig.ts` |
| `auth.api.ts` | `POST /api/auth/login`, `POST /api/auth/register`, `GET /api/auth/me` |
| `trips.api.ts` | `GET /api/trips`, `POST /api/trips` |
| `fraud.api.ts` | `POST /api/trips/invalid` |
| `levels.api.ts` | `GET /api/levels` |
| `leaderboard.api.ts` | `GET /api/leaderboard` |
| `rewards.api.ts` | `GET /api/rewards`, `POST /api/rewards/redeem` |
| `user.api.ts` | `GET /api/users/:id`, `PATCH /api/users/:id` |
| `notifications.api.ts` | Push notification registration |
| `friends.api.ts` | `GET /api/friend-requests`, `POST /api/friend-requests/:id/accept`, `DELETE /api/friend-requests/:id`, `DELETE /api/friends/:userId` |
| `health.api.ts` | `GET /health/live` — liveness ping, no auth. Use `pingServer()` to check if the server is reachable before showing an error toast. |

**Rules:**
- Functions return typed response objects — no raw `any`.
- No business decisions here. If response data needs transformation, do it in `lib/` or `context/`.
- The server URL is controlled exclusively by `constants/serverConfig.ts` — never hardcode URLs in api files.

### `services/sync/`

| File | Contents |
|---|---|
| `SyncManager.ts` | Offline-first sync queue: buffers failed API calls and retries on reconnect |
| `types.ts` | Payload types: `ValidTripPayload`, `InvalidTripPayload` |

---

## `types/`

TypeScript types shared between the mobile app and the backend.

**Rules:**
- Everything the server sends is derived from `services/api/generated.ts`, which `npm run gen:api` writes from the FastAPI OpenAPI schema. `generated.ts` is committed; never edit it by hand.
- Hand-written members are for the two cases the schema cannot express: client-only fields the server never sends, and shapes the schema flattens to `string` or an opaque object. Comment each one with which of the two it is — otherwise the next reader assumes the server sends it and it was never regenerated.
- App-only types (e.g. UI state shapes) belong in the file that uses them, or in `context/` if they are part of global state.

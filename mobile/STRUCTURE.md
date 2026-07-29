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
| `(business)/` | Business-portal screens (rewards, reward form) |

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
See `docs/SERVER-INTEGRATION-SETUP.md` for full build instructions.

---

## `context/`

React Context providers — global state accessible from anywhere in the component tree.

| File | Contents |
|---|---|
| `AppContext.tsx` | Core state: authenticated user, active trip, trip list, toasts, language. Owns the `CarmaDrivingSDK` instance and wires its callbacks to app state and server sync. |

**Rules:**
- Context is the bridge between the SDK/lib layer and the UI layer.
- Server calls triggered by SDK events (e.g. `tripsApi.save()` after `onTripEnd`, `fraudApi.syncInvalidTrip()` after `onFraudDetected`) live here.
- Do not add unrelated state to `AppContext` — create a separate context file if needed.

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

| File | Contents |
|---|---|
| `scoring.ts` | Trip score formula: converts `TripData` (events, distance, phone seconds) into a numeric score |
| `gamification.ts` | Level progression engine: 10-tier map, `calculateLevel`, `getProgressPercentage`, `detectLevelUp` |
| `TripValidationManager.ts` | CARMA trip lifecycle rules: 30 s start threshold (Rule 1), 3 min stop threshold (Rule 2), fraud gating (Rule 3) |
| `FraudDetector.ts` | Sensor-fusion classifier: detects train/bus travel using speed variance, lateral accel, and yaw variance signals — CARMA-specific thresholds from Appendix E |
| `constants.ts` | Internal lib-layer constants |
| `utils.ts` | Generic pure-function helpers (formatting, math, date) |
| `__tests__/` | Unit tests for all lib files |
| `driving-sdk/` | **Sensor-wrapper SDK** — see its own README |

**Rules:**
- No React, no `useState`, no `useEffect`, no imports from `components/` or `context/`.
- No direct server calls — lib functions are pure transformations.
- Tests live in `__tests__/` and must not require a running server or device.

### `lib/driving-sdk/` — scope boundary

`driving-sdk/` is a **separate SDK** maintained independently. It wraps device hardware (GPS, IMU, Bluetooth) and emits generic events. **Read its README before touching anything inside it.**

The critical rule: **do not add CARMA application logic to `driving-sdk/`.**
If you are writing code that uses sensor events to make a CARMA-specific decision, it belongs in `lib/` (directly under it), not inside `driving-sdk/`.

Examples:
- New fraud signal for bus detection → `lib/FraudDetector.ts`
- Trip scoring tweak → `lib/scoring.ts`
- New gamification rule → `lib/gamification.ts`
- New sensor type or Bluetooth feature → `lib/driving-sdk/` (after confirming it is generic)

---

## `screens/`

Full-screen React Native views. Routed via `app/`.

| Subfolder | Contents |
|---|---|
| `app/` | Authenticated screens: Dashboard, Active Trip, Trip Detail, Profile, Roadmap, Leaderboard, Marketplace, Settings |
| `auth/` | Unauthenticated screens: Login, Register, Onboarding |

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
| `business.api.ts` | Business-portal endpoints |
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
- Ideally generated from the FastAPI OpenAPI schema via `npm run gen:api` (uses `openapi-typescript`).
- Manual edits are permitted when the generator output is insufficient (e.g. adding optional fields that are disabled in the current build, or fixing a drift between server schema and app state shape). Document any manual addition with a short comment.
- App-only types (e.g. UI state shapes) belong in the file that uses them, or in `context/` if they are part of global state.

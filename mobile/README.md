# CARMA — Mobile App (`carma-app`)

A React Native / Expo app that rewards safe driving. Drivers earn points based on trip scores, redeem rewards from partner businesses, and track progress on a gamified leaderboard.

---

## Prerequisites

- Node.js 20+
- Android Studio (for the Android emulator + SDK)
- Docker Desktop (for the PostgreSQL database)
- Python 3.12 (for the FastAPI server)

> First time? Run `.\scripts\setup.ps1` from the monorepo root — it handles everything automatically.

---

## Running the App

```powershell
# From the monorepo root — starts Docker, emulator, FastAPI server, and Metro in one command
.\scripts\dev.ps1
```

Then press **`a`** in the Metro window to open the app on the Android emulator.

The app connects to the FastAPI server at `http://10.0.2.2:3000` (the emulator's alias for `localhost`).

---

## Directory Structure

For the full authoritative guide to every folder — what belongs where and what is explicitly forbidden in each layer — see **[STRUCTURE.md](./STRUCTURE.md)**.

Quick map:

```
mobile/
├── src/
│   ├── app/              # Expo Router — file-system routes and layouts
│   ├── components/       # React Native UI components, grouped by domain
│   │   ├── ui/           # Generic: Button, Card, Modal, Toast, Badge, Progress
│   │   ├── dashboard/    # Home screen widgets
│   │   ├── driving/      # Active-trip UI (speed gauge, event indicators)
│   │   ├── gamification/ # Level badge, roadmap, progress bar
│   │   ├── marketplace/  # Reward tiles, redemption flow
│   │   └── social/       # Leaderboard, profile header, score chart
│   ├── constants/        # Theme, server config, level helpers
│   ├── context/          # AppContext — global state + SDK wiring
│   ├── hooks/            # Custom React hooks (useTrip, useDriveMode, useTranslation)
│   ├── i18n/             # Hebrew / English translation strings
│   ├── lib/              # Pure business logic (no React)
│   │   ├── driving-sdk/        # Sensor + Bluetooth SDK — see its own README
│   │   ├── FraudDetector.ts    # Transport-mode classifier (CARMA-specific thresholds)
│   │   ├── TripValidationManager.ts  # Trip lifecycle rules (30 s start, 3 min end)
│   │   ├── gamification.ts     # Level progression engine (10-tier map + multipliers)
│   │   ├── scoring.ts          # Trip score formula
│   │   ├── constants.ts        # Runtime level config (loaded from server via setLevels)
│   │   └── utils.ts            # Pure utility helpers
│   ├── screens/          # Full-screen views (auth/ and app/)
│   ├── services/         # Server communication
│   │   ├── api/          # One file per backend resource + Axios client
│   │   └── sync/         # Offline-first sync queue (SyncManager)
│   └── types/            # Shared TypeScript types — generated from server OpenAPI schema
├── STRUCTURE.md          # Authoritative directory ownership guide
├── assets/               # Static images and fonts
├── metro.config.js       # /api/* proxy → localhost:3000
├── app.json              # Expo app config
├── tsconfig.json
└── package.json
```

---

## Key Concepts

### API / Networking
All HTTP requests go through `src/services/api/client.ts`, which attaches the JWT token from AsyncStorage. In development, `serverConfig.ts` detects the Expo tunnel URL at runtime and sends `/api/*` calls to the Metro server. `metro.config.js` intercepts those calls and proxies them to the local Express server on port 3000.

### Global State
`AppContext.tsx` manages user session, active trip, toasts, and language. It also initialises the `CarmaDrivingSDK` listeners and syncs data with the server on startup. Server calls triggered by SDK events (e.g. saving a trip, reporting fraud) live here.

### Routing
Expo Router uses the file system under `src/app/`. Route files import their corresponding screen from `src/screens/` and pass props down. Layouts (`_layout.tsx`) handle tab bars and auth guards.

### Driving SDK
`lib/driving-sdk/` is a **generic sensor-wrapper library** (GPS, IMU, Bluetooth). It emits raw events — the application layer in `lib/` decides what to do with them. See `lib/driving-sdk/README.md` for its scope boundaries and what must not be placed inside it.

### Levels
Level thresholds and metadata are fetched from `/api/levels` at startup and stored in a mutable module variable via `setLevels()` in `lib/constants.ts`. All level calculations use that runtime value. The progression logic (tier boundaries, multipliers) lives in `lib/gamification.ts`.

### Types
Types in `src/types/` are generated from the FastAPI OpenAPI schema via `npm run gen:api`. Do not edit them manually — run `gen:api` after any server schema change and commit the result.

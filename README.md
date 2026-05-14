# CARMA — Mobile App (`carma-app`)

A React Native / Expo app that rewards safe driving. Drivers earn points based on trip scores, redeem rewards from partner businesses, and track progress on a gamified leaderboard.

---

## Prerequisites

- Node.js 18+
- Expo CLI (`npm install -g expo-cli`)
- Expo Go on your physical device
- `carma-local-server` running on port 3000 (see sibling folder)

---

## Running the App

```bash
# Terminal 1 — local dev server (must be running first)
cd ../carma-local-server
node server.js

# Terminal 2 — Expo
npm install
npx expo start --tunnel
```

Open Expo Go on your phone and scan the QR code.
All `/api/*` requests are proxied through Metro to the local server — no manual IP configuration needed.

---

## Project Structure

```
carma-app/
├── src/
│   ├── app/                    # File-based routing (Expo Router)
│   │   ├── _layout.tsx         # Root layout — wraps everything in AppProvider
│   │   ├── login.tsx           # Login screen route
│   │   ├── register.tsx        # Registration screen route
│   │   ├── (tabs)/             # Bottom-tab navigator
│   │   │   ├── _layout.tsx     # Tab bar definition
│   │   │   ├── (home)/         # Home tab — dashboard, trip detail, settings
│   │   │   ├── leaderboard.tsx
│   │   │   ├── marketplace.tsx
│   │   │   ├── profile.tsx
│   │   │   └── roadmap.tsx
│   │   └── (business)/         # Business dashboard (reward management)
│   │
│   ├── screens/                # Full-page screen components
│   │   ├── auth/               # LoginScreen, RegisterScreen
│   │   └── app/                # DashboardScreen, ActiveTripScreen, MarketplaceScreen, etc.
│   │
│   ├── components/             # Reusable UI components, grouped by domain
│   │   ├── ui/                 # Generic: Button, Card, Modal, Toast, Badge, Progress
│   │   ├── dashboard/          # DashboardHeader, RecentTripsSection
│   │   ├── driving/            # ActiveTripHeader, TripCard, TripSummaryModal, etc.
│   │   ├── gamification/       # DashboardHero, LevelBadge, RoadmapHero, RoadmapLevelItem
│   │   ├── marketplace/        # RewardCard, VoucherCard, CategoryFilter, RedeemConfirmSheet
│   │   └── social/             # LeaderboardList, ProfileHeader, ScoreChart, AchievementsTab
│   │
│   ├── context/
│   │   └── AppContext.tsx       # Global state: user, trip, toasts, language, SDK listeners
│   │
│   ├── services/api/           # HTTP layer — one file per resource
│   │   ├── client.ts           # Core fetch wrapper (auth token, error handling)
│   │   ├── auth.api.ts         # /api/auth/login, /register, /me
│   │   ├── trips.api.ts        # /api/trips
│   │   ├── rewards.api.ts      # /api/rewards, /redeem
│   │   ├── user.api.ts         # /api/users/me, /stats
│   │   ├── leaderboard.api.ts  # /api/leaderboard
│   │   ├── levels.api.ts       # /api/levels
│   │   ├── business.api.ts     # /api/business/rewards (CRUD)
│   │   └── notifications.api.ts
│   │
│   ├── lib/
│   │   ├── driving-sdk/        # Driving sensor + Bluetooth SDK (see its own README)
│   │   ├── constants.ts        # Level config — loaded from server at startup via setLevels()
│   │   ├── scoring.ts          # Trip score calculation helpers
│   │   └── utils.ts            # General utilities
│   │
│   ├── hooks/
│   │   ├── useTrip.ts          # Trip state helpers
│   │   ├── useDriveMode.ts     # Drive-mode activation logic
│   │   └── useTranslation.ts   # i18n hook (returns strings for current language)
│   │
│   ├── constants/
│   │   ├── serverConfig.ts     # Derives Metro server origin at runtime (tunnel-aware)
│   │   ├── theme.ts            # Colors, spacing, typography
│   │   └── index.ts            # Re-exports
│   │
│   ├── i18n/
│   │   ├── he.ts               # Hebrew strings
│   │   └── en.ts               # English strings
│   │
│   └── types/
│       └── index.ts            # Shared TypeScript types (AppUser, Trip, Reward, etc.)
│
├── metro.config.js             # Adds /api/* proxy middleware → localhost:3000
├── app.json                    # Expo app config
├── tsconfig.json
└── package.json
```

---

## Key Concepts

### API / Networking
All HTTP requests go through `src/services/api/client.ts`, which attaches the JWT token from AsyncStorage. In development, `serverConfig.ts` detects the Expo tunnel URL at runtime and sends `/api/*` calls to the Metro server. `metro.config.js` intercepts those calls and proxies them to the local Express server on port 3000.

### Global State
`AppContext.tsx` manages user session, active trip, toasts, and language. It also initialises the driving SDK listeners and syncs data with the server on startup.

### Routing
Expo Router uses the file system under `src/app/`. Route files import their corresponding screen from `src/screens/` and pass props down. Layouts (`_layout.tsx`) handle tab bars and auth guards.

### Levels
Level thresholds and metadata are fetched from `/api/levels` at startup and stored in a mutable module variable via `setLevels()` in `lib/constants.ts`. All level calculations use that runtime value, not hardcoded data.

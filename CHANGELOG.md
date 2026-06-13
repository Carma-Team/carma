# Changelog

All notable changes to the CARMA HTTP contract and shared behaviour are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [Unreleased]

### Added
- Monorepo at `Carma-Team/carma` — server, mobile, and mock-server live under one repo.

## [0.3.0] — 2026-06-13 — Beta improvements (branch: feature/beta-improvements)

### Added
- **Remove friend:** `-` button on the Friends leaderboard tab; confirmation dialog in Hebrew/English; optimistic UI removal with revert on failure. Mock server: `DELETE /api/friends/:userId`.
- **Server health check:** `services/api/health.api.ts` — `pingServer()` calls `GET /health/live`. `AppContext` pings on startup and shows a 6-second warning toast if the server is unreachable.
- **i18n:** `common.yes`, `common.no`, `common.serverUnreachable`, `leaderboard.removeFriendConfirm` added to `he.ts` and `en.ts`.
- **Render deployment config:** `USE_REAL_SERVER = true`, `STAGING_SERVER_URL = https://carma-app.onrender.com` in `serverConfig.ts` for real-device APK builds.

### Changed
- **Leaderboard rank display:** removed `#` prefix; top-3 ranks rendered in gold/silver/bronze colours; medal emojis removed.
- **GPS accuracy:** `SensorManager` switched from `Location.Accuracy.Balanced` to `Location.Accuracy.High` (GPS chip only — eliminates network/cell-tower position jumps).
- **Teleportation guard:** SDK `handleSensorUpdate` now caps each GPS tick's distance to `(speed/3600) × timeDeltaS × 1.5`. `timeDeltaS` is computed in `SensorManager` and passed via `onUpdate`.
- **Per-event cooldown:** reduced from 3 000 ms to 500 ms for all event types.
- **Event i18n keys** renamed to match UI spec: `hardBrakes → 'בלימה חזקה'`, `aggressiveAccels → 'האצה חריגה'`, `sharpTurns → 'פנייה חדה'`.

### Fixed
- **Phone touch on Home button:** added `sdk.on(DrivingEventType.PHONE_USAGE)` listener in `AppContext`; pressing the Home button mid-trip now increments the phone-touch counter (previously only in-app screen transitions were counted).

### Disabled (preserved, not deleted)
- **SWERVE detection (`EVT_SWERVE`):** all detection, scoring, and UI code commented out with `// EVT_SWERVE disabled` marker. `swerves` field made optional (`?`) in `TelemetryDigest`, `ValidTripPayload`, `ScoringInput` to keep TypeScript clean. Re-enable by searching for the marker and uncommenting.

### Deprecated
- `mock-server/` — Express + `db.json` stand-in. Use `server/` (FastAPI) as the real backend. The mock will be archived once the team has run on the real server for two weeks without falling back.

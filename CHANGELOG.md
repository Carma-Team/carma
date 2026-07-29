# Changelog

All notable changes to the CARMA HTTP contract and shared behaviour are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [Unreleased]

### Added
- **Friend requests (issue #32):** the endpoints the app has always called now exist — `POST`/`DELETE /api/users/:id/friend-request`, `GET /api/friend-requests`, `POST /api/friend-requests/:id/accept`, `DELETE /api/friend-requests/:id`, `DELETE /api/friends/:id`. A request is `pending` until the recipient answers, an accepted friendship counts for **both** users, and either side can unfriend. Sending a request to someone who already asked you accepts theirs instead of opening a second one.
- **`GET /api/users/search?phone=`** — find a driver to add. Matches `05…` and `+9725…` spellings of the same number (part of issue #21).
- **Invite links (issue #33):** `GET /api/users/me/invite` mints one stable code per user (`{INVITE_BASE_URL}/i/{code}`, 8 chars, no look-alike characters); `POST /api/invites/{code}/redeem` befriends whoever shared it — accepted outright, since handing out the link is the same consent as tapping accept. Migration `0008` adds `users.invite_code`. New `INVITE_BASE_URL` setting (default `https://carma.app`). Redeeming is idempotent and settles an already-open request. Note the code is reusable and not yet rotatable, so a forwarded link keeps working. Client contract: `invitesApi`; the deep-link config, landing page and share sheet are still to come.
- **`POST /api/users/match-contacts` (issue #33):** finds which of a user's contacts already drive with CARMA. Takes SHA-256 digests of canonical (E.164) numbers — raw numbers never leave the device — capped at 1000 per call, matched in memory, nothing persisted or logged. Each match carries `friendStatus` so the list can render the right button per row. Client contract: `userApi.matchContacts()`; the device-side hashing (needs `expo-crypto`) and the contacts UI are still to come.
- **Blocks moved to** `POST`/`DELETE /api/users/:id/block` (were `/api/leaderboard/block/:id`). Blocking now also drops a pending request, not just an accepted edge.
- **Scoring v2.1 (branch: feature/scoring-v2.1-telemetry):** server-side GPS telemetry analysis (`server/app/services/telemetry.py`) — independent detection of hard brakes, aggressive accelerations, and sharp turns from `route_waypoints`; event counts merged into scoring as `max(digest, gps)` so client under-detection can no longer produce a flat 100.
- **Speeding component activated:** time-over-threshold against a conservative absolute limit (120 km/h national max + 10 km/h GPS buffer); `has_speed_data=true` whenever waypoint coverage suffices. Sustained motorway speeding now costs score.
- **Telemetry confidence cap:** sparse/gappy GPS traces limit how far a trip can score above the driver's rolling score (upside only — reported events are never diluted). `apply_confidence()` in `scoring.py`.
- **Server-detected events persisted:** `Event` rows tagged `{"source": "server-gps"}` (incl. `SPEEDING` runs) give the trip map markers even before mobile sends its events array (issue #12).
- **`pointsCapped`** on the trip-save response (`TripOut` + `mobile/src/types/index.ts`) — tells the client the daily anti-grind caps reduced the award, instead of a silent 0.
- **`python -m app.seed --driver-scores-only`** — backfills NULL `users.driver_score` (v2 §7 formula over each user's history) without reseeding; also runs automatically at the end of a full seed.

### Removed
- **Instagram-style follow endpoints** (`GET`/`POST`/`DELETE /api/leaderboard/follow/:id`, `/api/leaderboard/requests…`). Nothing called them, and their auto-accept-on-public rule is what made friend requests invisible to public accounts. `mobile/src/services/api/leaderboard.api.ts` drops the matching dead methods; `userApi.sendFriendRequest` moved to `friendsApi.send`.

### Changed
- **Leaderboard `type=friends`** now lists accepted friendships in either direction — previously only people the viewer had followed, so the user who accepted never saw the requester on their own board. `followStatus` on every entry means friendship status (the wire name is unchanged for the client).
- **Scoring v2.1 recalibration:** exponential-decay constants re-fit from recency-weighted live-fleet percentiles (`k_brake` 0.075→0.018, `k_accel` 0.089→0.022, `k_corner` 0.064→0.012, `k_speed` 0.045→0.012, `k_distraction` 0.112→0.020); `scoring_version` → `2.1.0`. Full-history re-score: median 84.3→88.5, p10 38.2→72.7, perfect-100 trips 6→0. See `docs/scoring-calibration.md`.
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

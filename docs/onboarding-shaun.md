# CARMA — Onboarding Guide (for Shaun)

> Written 2026-07-19 by Dan (via code review session). Everything here reflects the
> `develop` branch on that date. When something contradicts the code — the code wins;
> update this doc.

Welcome to the codebase. This document takes you from zero: what the product does,
how the code is organized, what already works, and what to pick up first.

---

## 1. What CARMA is (60 seconds)

CARMA is a mobile app that monitors driving behavior in real time, scores each trip
0–100, and converts safe driving into points that buy real rewards (fuel discounts,
coffee, car washes) from partner businesses. Gamification — levels, leaderboards,
friends — keeps drivers engaged. The core bet: measurable, fraud-resistant driving
scores that businesses and (later) insurers will pay for.

The full trip lifecycle:

1. The phone's sensors (GPS, IMU, optional car Bluetooth) detect that a trip started
   (30s continuously above 10 km/h) — no user interaction needed.
2. During the trip the app detects events: hard brakes, aggressive accelerations,
   sharp turns, phone touches. A fraud detector rejects train/bus rides.
3. Trip ends after 3 minutes below 10 km/h. The app computes a preliminary score
   locally and shows it immediately.
4. The trip is POSTed to the server (offline-safe queue with idempotency keys).
   **The server recomputes everything and its result is authoritative** — the
   client's score/points are treated as untrusted input.
5. The server cross-checks the reported event counts against the raw GPS waypoints
   it also receives (scoring v2.1), stores the trip + events, awards points, updates
   level and leaderboard.

## 2. Team ownership

| Person | Owns |
|---|---|
| **Dan** (CTO/CPO) | Scoring algorithm, anti-fraud, roadmap |
| **Naveh** (Chief Architect) | DB architecture, data pipelines, monorepo/CI structure |
| **Shaun** (CEO, backend) — you | Business-logic API endpoints, Azure infra, third-party integrations |
| **May** (Mobile/Frontend lead) | All mobile screens/UI, the Driving SDK (sensors/BLE), battery |

Rule of thumb: anything under `mobile/src/app`, `mobile/src/components`,
`mobile/src/screens`, `mobile/src/lib/driving-sdk` is May's — don't edit it, open an
issue for her. `mobile/src/lib/*.ts` (scoring, fraud, gamification) is Dan's client-side
mirror of server logic. Everything under `server/` is yours + Dan's + Naveh's territory.

## 3. Repository layout

```
carma/
├── mobile/            React Native (Expo) app — npm workspace "carma-app"
│   └── src/
│       ├── app/           expo-router routes (thin wrappers)
│       ├── screens/       screen implementations (May)
│       ├── components/    presentational components (May)
│       ├── context/       AppContext — global state, wires SDK → API
│       ├── lib/           business logic, pure TS (scoring, fraud, gamification)
│       │   └── driving-sdk/   generic sensor SDK (May; future standalone package)
│       ├── services/api/  HTTP layer — one module per resource
│       ├── services/sync/ offline trip queue (SyncManager)
│       └── types/         TS mirror of server schemas — keep in sync manually!
├── server/            FastAPI + PostgreSQL (async SQLAlchemy), Python 3.12
│   └── app/
│       ├── routers/       HTTP endpoints (thin — no business logic)
│       ├── services/      business logic (trips, scoring, rewards, auth…)
│       ├── models/        SQLAlchemy models
│       ├── schemas/       Pydantic DTOs (camelCase aliases for mobile)
│       ├── core/          auth deps, JWT, audit log, logging
│       ├── seed.py        demo data (idempotent; investor-demo users)
│       └── main.py        app assembly, middleware, rate limiting
├── docs/              architecture & algorithm docs (start with scoring-algorithm-v2.md)
├── scripts/           dev.ps1 (full stack up), setup.ps1, smoke.sh
└── .github/workflows/ ci-server.yml, ci-mobile.yml, deploy.yml
```

## 4. Getting it running

One-time: install Docker Desktop, Python 3.12, Node 20+, then `.\scripts\setup.ps1`
(as Administrator). Day-to-day:

```powershell
.\scripts\dev.ps1     # Docker Postgres + FastAPI :3000 + Metro + Android emulator
```

Server only:

```powershell
cd server
.\.venv\Scripts\Activate.ps1        # project venv (Python 3.12)
alembic upgrade head                # migrations
python -m app.seed                  # demo data (idempotent, safe to re-run)
uvicorn app.main:app --reload       # http://localhost:3000/api/docs
```

Checks you're expected to keep green (all pass on develop as of today):

```powershell
cd server;  ruff check . ; ruff format --check . ; mypy app ; pytest   # 169 passed
cd mobile;  npx jest --no-coverage                                     # 126 passed
```

Known broken (not by you): `mobile npx tsc --noEmit` (941 env errors, #18) and
`expo lint` (#18). Both May's toolchain domain.

Production: Azure Container Apps, deployed by `deploy.yml` on push to `main`
(gated on the `AZURE_CREDENTIALS` secret). DB: Azure PostgreSQL flexible server.

## 5. The parts that matter most (read in this order)

### 5.1 Trip save — the heart of the system

`server/app/services/trips.py :: save()`. Everything converges here:

1. **Idempotency** — `Idempotency-Key` header; a retry returns the stored trip.
2. **Signed telemetry digest** — the client signs a digest of counters; HMAC
   verified server-side. ⚠️ Currently bypassable via a legacy `ph:` dev key (#24).
3. **Physics gates** — impossible speed/duration → 422 + a fraud report row.
4. **GPS cross-check (scoring v2.1, new)** — `services/telemetry.py` independently
   detects brakes/accels/turns/speeding from raw `route_waypoints`. Final counts are
   `max(client, server)` per type — counts only ever go up, so a client that
   under-reports (buggy or malicious) is corrected. Server-detected events are stored
   with `sensor_data.source="server-gps"`.
5. **Scoring** — v1 formula (`services/scoring.py`) is what users currently see;
   v2.1 (`services/scoring_v2.py`, `docs/scoring-algorithm-v2.md`) runs alongside,
   stored in `score_v2`. A confidence cap keeps sparse-GPS trips from inflating.
6. **Points** — score × log-distance factor × night-risk multiplier, with daily
   anti-grind caps (300 pts / 150 km per day). The save response includes
   `pointsCapped: true` when a cap kicked in.

### 5.2 Contract sync (engineering rule #1)

Any change to `server/app/schemas/` **must** be mirrored manually in
`mobile/src/types/index.ts` in the same change. The schemas use camelCase aliases so
the wire format matches TS conventions. `ci-mobile.yml` has a gated drift check that
regenerates types from the live OpenAPI schema and diffs.

### 5.3 Auth

Two flows: email+password (the app's flow — bcrypt, JWT HS256, 7-day expiry) and
phone+OTP (spec flow — SMS via Twilio in prod, console in dev; lockout after 5
failures). `core/deps.py::current_user` is the dependency guard on every
authenticated route.

### 5.4 Rewards loop

`services/rewards.py`: redeem debits points atomically (conditional UPDATE — race-safe
as of d67b472) and issues a 5-minute QR voucher. ⚠️ The loop is **open-ended**: there is
no endpoint for a business to validate/consume a voucher, and no expiry transition —
that's the top of your queue (#21).

## 6. Current status — what works

- ✅ Full E2E on the cloud: register/login → trip save → scoring → points → levels →
  leaderboard → rewards/vouchers. Verified with investor-demo data (`seed.py`).
- ✅ Scoring v2.1 with server-side GPS verification just merged (2026-07-19) — killed
  the "always 100" bug; full-history re-score: median 88.5, no fake perfect scores.
- ✅ 169 server tests, 126 mobile tests, ruff+mypy strict — all green on develop.
- ✅ Offline trip queue with idempotency; leaderboard with follows/privacy/blocks;
  investor demo flows.
- ⚠️ Driver-score backfill for 12 seeded users pending: run
  `python -m app.seed --driver-scores-only` against the cloud DB (Dan has the details).
- ⚠️ Mobile tsc/lint toolchain broken on develop (#18) — May.

## 7. Open issues by priority

**P0 — product-breaking against the real server**
1. [#21](https://github.com/Carma-Team/carma/issues/21) **(you)** Missing endpoints
   the app already calls: business rewards CRUD, voucher validation, leaderboard
   locations, user search. The business dashboard is 100% dead without this.
2. [#18](https://github.com/Carma-Team/carma/issues/18) (May) Mobile toolchain:
   941 tsc errors + broken lint — blocks mobile CI and every future mobile PR.
3. [#19](https://github.com/Carma-Team/carma/issues/19) (May) friends.api.ts still
   calls mock-server endpoints — friend requests/removal silently broken in prod.

**P1 — trust & correctness**
4. [#13](https://github.com/Carma-Team/carma/issues/13) (May) SDK event detection
   mis-calibration — the root cause behind most scoring distortions.
5. [#17](https://github.com/Carma-Team/carma/issues/17) (May) GPS sampling density —
   caps the v2.1 confidence on affected devices.
6. [#24](https://github.com/Carma-Team/carma/issues/24) (Dan) Remove the `ph:` HMAC
   bypass + provision `TRIP_SIGNING_SECRET`.
7. [#25](https://github.com/Carma-Team/carma/issues/25) (Naveh) CI on develop —
   currently the integration branch has zero automated checks.

**P2 — feature completeness**
8. [#12](https://github.com/Carma-Team/carma/issues/12) (May) Send per-event array
   in trip save (map markers from the client, not just server-gps).
9. [#22](https://github.com/Carma-Team/carma/issues/22) **(you)** Notifications API
   is a stub returning `[]`.
10. [#14](https://github.com/Carma-Team/carma/issues/14) (May) Per-event severity
    (`peak_g`) — unblocks the next scoring calibration round.
11. [#7](https://github.com/Carma-Team/carma/issues/7) (May) "End Trip" button dead
    when a Bluetooth device is configured.

**P3 — hardening & polish**
12. [#23](https://github.com/Carma-Team/carma/issues/23) **(you)** Security: OTP user
    enumeration, CORS config, per-endpoint rate limits.
13. [#20](https://github.com/Carma-Team/carma/issues/20) (May) UI polish batch.

## 8. Gotchas you'll hit in week one

- **`develop` has no CI.** Run `pytest` + `ruff check` locally before every merge;
  `main` CI is the last line of defense, not the first (#25 will fix this).
- **`server/app/seed.py` is excluded from `ruff format`** — its wide table-style
  demo rows are deliberate. Don't "fix" the formatting.
- **The mock-server is gone.** Any code path or doc still mentioning it is legacy;
  `USE_REAL_SERVER` in `mobile/src/constants/serverConfig.ts` decides where the app
  points (currently: the Azure prod URL).
- **Never trust the client's score.** If you add anything that moves points or
  scores, the server computes it; the client only displays.
- **Don't edit `mobile/src/lib/driving-sdk/`** — hard boundary (future standalone
  package, May's). Same for screens/components.
- **Timezones:** night-risk multiplier uses `Asia/Jerusalem` server-side; all DB
  timestamps are UTC (`DateTime(timezone=True)`).
- The permission model on prod DB writes is deliberate: schema changes go through
  alembic migrations, data fixes through `app.seed` entry points — no ad-hoc UPDATEs.

## 9. Key docs

- `docs/scoring-algorithm-v2.md` — the scoring spec (the single most important doc).
- `docs/scoring-v2-calibration-status.md` — why the constants are what they are.
- `docs/fraud-detection-v2.md` + `docs/RFC-001-Hybrid-Validation.md` — anti-fraud design.
- `mobile/STRUCTURE.md` — mobile layer rules (read before touching anything there).
- `CLAUDE.md` — working conventions, branching, and the "keep it simple" philosophy.

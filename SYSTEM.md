# CARMA — Full System Documentation

> This document describes the CARMA backend server, the integration with the mobile app, and the surrounding infrastructure (DB, Docker, CI/CD, Azure, Monitoring). A Hebrew version lives at [SYSTEM.he.md](SYSTEM.he.md).

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [Tech Stack](#3-tech-stack)
4. [Repository Layout](#4-repository-layout)
5. [Database — Schema and Rationale](#5-database--schema-and-rationale)
6. [Server Modules (Routers + Services)](#6-server-modules-routers--services)
7. [Authentication Flows](#7-authentication-flows)
8. [Full API Reference](#8-full-api-reference)
9. [Integration with the Mobile Frontend](#9-integration-with-the-mobile-frontend)
10. [Running Locally — Step by Step](#10-running-locally--step-by-step)
11. [CI/CD and Azure Deployment](#11-cicd-and-azure-deployment)
12. [Monitoring and Observability](#12-monitoring-and-observability)
13. [Spec Compliance Map](#13-spec-compliance-map)
14. [Out of Scope](#14-out-of-scope)
15. [Next Steps](#15-next-steps)

---

## 1. Executive Summary

**What it is:** A backend REST API for CARMA — a safe-driving rewards platform. The server provides the mobile app (Expo / React Native) with everything it needs: registration and login, trip persistence, the rewards marketplace, the leaderboard, and statistics.

**Stack:** Python 3.12 + FastAPI + SQLAlchemy 2.0 (async) + PostgreSQL 16 with PostGIS + JWT auth + Twilio (optional).

**Two parallel authentication paths:**
- **Email + Password** — what the mobile frontend actually calls (matches her existing contract).
- **Phone + OTP via SMS** — per the formal spec (section 4.2.1). Ready for future / later integration.

Both paths produce the same JWT — a client holding a token can call every API regardless of how it logged in.

**Deployment:** Container-based — multi-stage Dockerfile, suitable for Azure Container Apps. Postgres on Azure Database for PostgreSQL Flexible Server (PostGIS supported). Application Insights for monitoring (via `azure-monitor-opentelemetry`).

**CI/CD:** Two workflows under `.github/workflows/`:
- `ci-server.yml` — ruff always; mypy/pytest/smoke gated on label `run-full-ci` or `workflow_dispatch`.
- `ci-mobile.yml` — tsc always; npm test gated.
- `deploy.yml` — builds and rolls out to Azure Container Apps, authenticating via GitHub OIDC against a managed identity. No stored password. See §11.

**Key note:** the mobile frontend uses snake_case for some fields (`start_time`, `avg_score`, `events_array`) and camelCase for others. Pydantic schemas use `alias_generator=to_camel` to emit camelCase on the wire, and trip-save accepts both styles via `AliasChoices`. Her frontend works without changes.

---

## 2. Architecture Overview

```
┌────────────────────┐         ┌────────────────────┐
│ Expo / React Native│  HTTPS  │   FastAPI Server   │
│   (the mobile app)      │ ─────►  │ (carma-server, :3000)│
│   AsyncStorage:    │ Bearer  │                    │
│   carma_token (JWT)│  token  │  Routers:          │
└────────────────────┘         │   auth · users     │
                               │   trips · rewards  │
                               │   vouchers ·       │
                               │   leaderboard ·    │
                               │   notifications    │
                               │   health           │
                               └─────────┬──────────┘
                                         │ SQLAlchemy async (asyncpg)
                                         ▼
                          ┌──────────────────────────┐
                          │ PostgreSQL + PostGIS 16  │
                          │  - users · otp_codes     │
                          │  - trips · events        │
                          │  - businesses · rewards  │
                          │  - redemptions · levels  │
                          └──────────────────────────┘

   ┌────────────┐                              ┌──────────────────────┐
   │  Twilio    │ ◄── SMS (when SMS_PROVIDER=  │ Application Insights │
   │  (OTP SMS) │      twilio in production)   │ (OpenTelemetry)      │
   └────────────┘                              └──────────────────────┘
```

**Principles:**
- Authentication is enforced **per route** via the `CurrentUser` FastAPI dependency. Routes without it (auth/register, auth/login, OTP routes, health) are public.
- The DB is only accessed through async SQLAlchemy sessions injected via `Depends(get_db)`.
- The server is stateless — no session memory, the JWT carries the identity.

---

## 3. Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Runtime | Python 3.12 (slim container) | Modern, fast, matches the workshop's `.venv` setup |
| Framework | FastAPI 0.115 | Async, OpenAPI auto-generation, Pydantic-native |
| Language | Python with type hints + mypy strict | Type safety where it matters |
| ORM | SQLAlchemy 2.0 (async, with `asyncpg` driver) | Production standard, full type-safety in 2.0 |
| Migrations | Alembic | Schema-as-code, autogenerated from models |
| DB | PostgreSQL 16 + PostGIS 3.4 | Geographic location support (Marketplace radius search) |
| Validation | Pydantic v2 + `pydantic-settings` | DTOs, env validation in one model |
| Auth | `python-jose` (JWT) + `passlib[bcrypt]` | Stateless tokens, secure password and OTP hashing |
| SMS | Twilio (optional) | OTP delivery in production. In dev — `ConsoleSmsSender` logs to stdout |
| Rate limit | `slowapi` | Per-IP throttling on auth endpoints |
| Monitoring | `azure-monitor-opentelemetry` + OpenTelemetry instrumentations | Auto-instrumented requests, DB, exceptions |
| Server | `uvicorn[standard]` | ASGI server (production: also via Docker `CMD`) |
| Tests | `pytest` + `pytest-asyncio` + `httpx` ASGITransport | Async-aware testing without a live server |
| Container | Docker multi-stage | Small production image, runs migrations on boot |
| Local DB | Docker Compose (`postgis/postgis:16-3.4`) | No need to install Postgres on Windows |
| CI | GitHub Actions | Free, integrates naturally with Azure |
| Cloud | Azure (Container Apps + Postgres Flexible + ACR + App Insights) | User's choice |

---

## 4. Repository Layout

```
carma/                                # Carma-Team/carma (monorepo root)
├── .github/
│   ├── workflows/
│   │   ├── ci-server.yml             # lint always; mypy/pytest/smoke gated by label or workflow_dispatch
│   │   ├── ci-mobile.yml             # tsc always; npm test gated by label
│   │   └── deploy.yml                # Azure Container Apps — OIDC, gated on AZURE_CLIENT_ID
│   └── pull_request_template.md
│
├── server/                           # Python backend (FastAPI)
│   ├── app/
│   │   ├── main.py · config.py · database.py · monitoring.py · seed.py
│   │   ├── models/                   # SQLAlchemy 2.0 declarative (User, Trip, Event,
│   │   │                             #   Reward, Business, Redemption, Level, OtpCode)
│   │   ├── schemas/                  # Pydantic DTOs (CamelModel base; camelCase wire format)
│   │   ├── core/                     # security (bcrypt + JWT), deps (DbSession, CurrentUser)
│   │   ├── services/                 # Business logic: auth, users, trips, rewards, leaderboard, sms
│   │   └── routers/                  # FastAPI routers: auth, users, trips, rewards,
│   │                                 #   leaderboard, notifications, health
│   ├── alembic/                      # Migrations
│   ├── tests/                        # pytest
│   ├── Dockerfile · docker-compose.yml
│   ├── requirements.txt · requirements-dev.txt · pyproject.toml
│   ├── .env.example
│   └── README.md
│
├── mobile/                           # Expo / React Native frontend
│   ├── src/
│   │   ├── app/                      # expo-router screens (auth, tabs, admin, business)
│   │   ├── screens/, components/, context/, hooks/
│   │   ├── services/api/             # client.ts (Bearer), auth.api.ts, trips.api.ts, ...
│   │   │   └── generated.ts          # auto-generated from /api/openapi.json (gitignored)
│   │   ├── lib/driving-sdk/          # IMU/GPS/BLE simulation
│   │   └── types/                    # shared TS interfaces
│   ├── package.json                  # `npm run gen:api` regenerates types from the server
│   ├── metro.config.js               # proxies to localhost:3000
│   └── app.json
│
├── mock-server/                      # Express + db.json mock — deprecated (kept for offline dev)
│   └── local-server/
│
├── scripts/
│   ├── dev.ps1                       # one-command local dev (DB + server + Metro)
│   └── smoke.sh                      # end-to-end HTTP smoke test
│
├── CHANGELOG.md                      # contract changes per release
├── SYSTEM.md                         # ← You are here
└── README.md                         # top-level intro
```

---

## 5. Database — Schema and Rationale

### Entities

| Entity | Role | Spec section |
|---|---|---|
| `User` | End user (driver/business/admin). Unifies both auth paths. | 5.3.1.1 |
| `OtpCode` | Temporary OTP codes, hashed. Older codes are auto-consumed when a new one is issued. | 4.2.1 + 5.2.4-5.2.5 |
| `Level` | Levels table 1–10 with point thresholds and discounts. | Appendix D |
| `Trip` | A single trip (start, end, score, counts). | 5.3.1.2 |
| `Event` | An anomalous event in a trip (brake, turn, etc.) + JSONB sensor data. | 5.3.1.6 |
| `Business` | A business (Marketplace) with location. | 5.3.1.4 |
| `Reward` | A specific reward at a business. | 5.3.1.3 |
| `Redemption` | Redemption of a reward — QR + status + 5-min validity (spec 5.2.5). | 5.3.1.5 |

### Key fields on `User`

```python
class User(Base, TimestampMixin):
    id, name, email?, password_hash?, phone?,        # Auth: email+password or phone+OTP
    role: UserRole,                                  # DRIVER | BUSINESS | ADMIN
    language: Language,                              # HE | EN
    age?, city?, license_year?, avatar_url?,

    points: int,                                     # Current redeemable balance
    total_points: int,                               # Lifetime accumulation (drives level)
    total_distance: float,                           # Total km driven
    level: int,                                      # 1–10 (denormalized; computed from total_points)

    drive_mode_enabled, bluetooth_device_id, bluetooth_device_name,
    last_lat, last_lng, last_location_at,            # Last known driver location
    last_cleared_history,                            # UI history filter

    is_phone_verified, failed_otp_count, locked_until,   # Spec 5.2.4 enforcement
```

**Why both `points` and `total_points`?** the mobile frontend uses both: `points` is the redeemable balance (decreases when buying a voucher), `total_points` is the lifetime accumulation that determines the level. When redeeming a voucher we only decrement `points`.

### Locations and PostGIS

PostGIS is installed in the container image (`postgis/postgis:16-3.4`) and enabled per database. For MVP we store `location_lat`/`location_lng` as plain `Float`. As scale grows, we can add a generated `geography(Point, 4326)` column with a GIST index (via `geoalchemy2` — already in requirements) and switch Marketplace radius queries to use `ST_DWithin`.

The driver's last location (`User.last_lat`/`last_lng`) is updated via `PUT /api/users/me/location`. In the app this is fed by `expo-location`.

### Indexes already defined

- `users (phone)`, `users (email)`, `users (role)`
- `otp_codes (phone, purpose, consumed_at)` — active-OTP lookup
- `otp_codes (expires_at)` — for cleanup
- `trips (user_id, start_time)`, `trips (status)`
- `events (trip_id, timestamp)`, `events (type)`
- `businesses (category)`, `businesses (location_lat, location_lng)`
- `rewards (business_id, is_active)`, `rewards (category)`
- `redemptions (user_id, status)`, `redemptions (qr_code)`

---

## 6. Server Modules (Routers + Services)

| Router (HTTP) | Service (logic) | What it does |
|---|---|---|
| `routers/auth.py` | `services/auth.py` | Register, login, /me. Both email+password and phone+OTP paths. Enforces lockout after 5 failed OTPs. |
| `routers/users.py` | `services/users.py` | `/users/me` profile + location + GDPR delete + `/user/stats`. |
| `routers/trips.py` | `services/trips.py` | List, save (accepts snake_case and camelCase), get by id. Auto-updates `points`/`total_points`/`total_distance` on User. |
| `routers/rewards.py` | `services/rewards.py` | List rewards (filter by category), redeem (random base64 QR, 5-min validity), my vouchers. |
| `routers/leaderboard.py` | `services/leaderboard.py` | national/city/friends, sorted by `total_points`. |
| `routers/friends.py` | `services/friends.py` | Friend requests, unfriending, blocks. Owns every write to `user_friends`. |
| `routers/notifications.py` | — | Stub. Returns an empty list until a model is added. |
| `routers/health.py` | — | `/health` (DB ping), `/health/live` (uptime). |
| — | `services/sms.py` | SmsSender abstraction — Twilio in prod, Console in dev. |

### Global middleware (in `app/main.py`)

1. **CORS** — `CORSMiddleware`, origins from `CORS_ORIGINS` env (default `*`). Credentials are allowed only when the origins are named explicitly — a wildcard plus credentials is forbidden by the spec, so `settings.cors_allows_credentials` turns them off together.
2. **Rate limiting** — per-IP, `DefaultRateLimitMiddleware` in `app/middlewares/rate_limit.py`. Defaults: 30/min, 500/hour on every route that does not declare its own; the auth routes tighten this to 5/min and the health probes are exempt. Each handler counts against its own budget, so one busy screen cannot lock a caller out of the rest of the app, and a path parameter cannot hand out a fresh budget per id. The limiter itself lives in `app/core/limiter.py` so routers can import it without a cycle. This replaced `SlowAPIMiddleware`, which enforced nothing at all under FastAPI 0.137+ (CAR-126). A second, per-phone cap on issuing OTPs (`OTP_MAX_PER_HOUR`) sits in `services/auth.py` — it survives IP rotation, which is what protects the SMS bill.
3. **Unhandled-exception handler** — catches anything that escapes a route and returns a sanitized 500 with the path logged.

Authentication is **not** a middleware — it's the `CurrentUser` dependency on each protected route. Routes without it are public.

---

## 7. Authentication Flows

### A. Email + Password (what the mobile app calls)

```
Mobile App                                   Server
   │                                            │
   │  POST /api/auth/register                   │
   │  { name, email, password, phone?,          │
   │    city?, age?, licenseYear? }             │
   │ ─────────────────────────────────────────► │
   │                                            │ passlib bcrypt.hash(password)
   │                                            │ INSERT INTO users
   │                                            │ jose.jwt.encode({sub, email, role}, secret, HS256)
   │  201 { token, user }                       │
   │ ◄───────────────────────────────────────── │
   │                                            │
   │  AsyncStorage.setItem('carma_token', token)│
   │                                            │
   │  POST /api/auth/login                      │
   │  { email, password }                       │
   │ ─────────────────────────────────────────► │
   │                                            │ scalar(select(User).where(email=...))
   │                                            │ passlib bcrypt.verify()
   │                                            │ jose.jwt.encode(...)
   │  200 { token, user }                       │
   │ ◄───────────────────────────────────────── │
   │                                            │
   │  GET /api/auth/me                          │
   │  Authorization: Bearer <token>             │
   │ ─────────────────────────────────────────► │
   │  200 user                                  │
   │ ◄───────────────────────────────────────── │
```

### B. Phone + OTP (per spec, section 4.2.1)

```
Mobile App                                   Server                 Twilio (prod)
   │                                            │                        │
   │  POST /api/auth/otp/register               │                        │
   │  { phone: +972501234567, name, ... }       │                        │
   │ ─────────────────────────────────────────► │                        │
   │                                            │ secrets.randbelow → 6 digits
   │                                            │ passlib bcrypt.hash    │
   │                                            │ INSERT OtpCode         │
   │                                            │ ─── SMS body ────────► │
   │  200 { message, expiresInSeconds: 300 }    │                        │
   │ ◄───────────────────────────────────────── │                        │
   │                                            │                        │
   │  POST /api/auth/otp/verify                 │                        │
   │  { phone, code }                           │                        │
   │ ─────────────────────────────────────────► │                        │
   │                                            │ passlib bcrypt.verify  │
   │                                            │ on fail: failed_otp_count++│
   │                                            │ if >= 5: locked_until = now+15min │
   │                                            │ on success: consume,  │
   │                                            │    mark is_phone_verified│
   │  200 { token, user }                       │                        │
   │ ◄───────────────────────────────────────── │                        │
```

### JWT details

- **HMAC SHA256** signed with `JWT_SECRET` (≥16 chars, enforced by Pydantic Settings).
- Default lifetime: `JWT_EXPIRES_MINUTES=10080` (= 7 days).
- Payload: `{ sub, email, phone, role, iat, exp }`.
- No refresh token yet — when the token expires the user re-logs in. Easy to add later.

### Protections

| Protection | Where it lives |
|---|---|
| OTP stored as bcrypt hash (never plaintext!) | `services/auth.py::_issue_otp` |
| Only one active OTP per phone (older ones auto-consumed) | `UPDATE otp_codes SET consumed_at = now()` before insert |
| 5 failed attempts → 15-minute lockout | `services/auth.py::_record_failure` (spec 5.2.4) |
| Rate-limit on register/login/verify | `slowapi` global (30/min) + 5/min on the auth routes |
| One phone may trigger 5 codes an hour | `services/auth.py::_assert_otp_quota` — counted from `otp_codes`, so it holds however many addresses the caller rotates through |
| `otp/verify` never says whether a phone is registered | `services/auth.py::_rejected` — unknown number, no pending code, expired code, wrong code and locked account all answer the same 401. The audit log keeps the real reason |
| Passwords with bcrypt salt (passlib auto) | `core/security.py::hash_password` |
| TLS 1.3 | Termination at Azure Container Apps ingress |
| Full account deletion (GDPR) | `DELETE /api/users/me` — cascade on trips/redemptions |

---

## 8. Full API Reference

> All endpoints except `/health/*` and `/api/auth/{register,login,otp/*}` require `Authorization: Bearer <token>`.

### Auth

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/auth/register` | `{ name, email, password, phone?, city?, age?, licenseYear? }` | `201 { token, user }` |
| POST | `/api/auth/login` | `{ email, password }` | `200 { token, user }` |
| GET | `/api/auth/me` | — | `200 user` |
| POST | `/api/auth/otp/register` | `{ phone, name, language?, age?, city? }` | `200 { message, expiresInSeconds }` |
| POST | `/api/auth/otp/request` | `{ phone }` | `200 { message, expiresInSeconds }` |
| POST | `/api/auth/otp/verify` | `{ phone, code }` | `200 { token, user }` |

### Users

| Method | Path | Description |
|---|---|---|
| GET | `/api/users/me` | User profile |
| PATCH | `/api/users/me` | Update name/language/age/city |
| PUT | `/api/users/me/location` | Update last location `{ lat, lng }` |
| DELETE | `/api/users/me` | Delete account (GDPR) → 204 |
| GET | `/api/user/stats` | Aggregate stats |

### Trips

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/trips` | — | `{ trips }` |
| POST | `/api/trips` | `{ start_time | startTime, end_time | endTime, distance | distanceKm, avg_score | avgScore | score, events | events_array, ... }` | trip |
| GET | `/api/trips/{id}` | — | `{ trip }` (with events) |

### Rewards & Vouchers

| Method | Path | Description |
|---|---|---|
| GET | `/api/rewards?category=fuel\|food\|eco\|entertainment\|shopping` | Active rewards + the user's vouchers |
| POST | `/api/rewards/{id}/redeem` | Redeem — debits points, issues 5-minute QR |
| GET | `/api/vouchers` | My vouchers |

### Leaderboard

| Method | Path | Description |
|---|---|---|
| GET | `/api/leaderboard?type=national\|city\|friends` | Ranked by `total_points`. `friends` = accepted friendships, either direction, plus the user themselves. |

### Friends

Mutual friendships on `user_friends`: one row per relationship, oriented requester → recipient.
`pending` until answered (privacy setting does not change that), `accepted` counts for both
users whichever way the row points, `blocked` is directional.

| Method | Path | Description |
|---|---|---|
| GET | `/api/users/search?phone=` | Find a driver to add. Matches `05…` and `+9725…` spellings of the same number. |
| POST | `/api/users/match-contacts` | Which of the caller's contacts drive with CARMA. Takes SHA-256 digests of E.164 numbers (never raw numbers), max 1000; stores nothing. |
| GET | `/api/users/me/invite` | The caller's invite link (`{invite_base_url}/i/{code}`). Code is minted on first call, then stable. |
| POST | `/api/invites/{code}/redeem` | Befriends whoever shared the code — accepted outright, no request step. Called after signup, once the user has a token. |
| POST | `/api/users/{id}/friend-request` | Send. If they already asked you, this accepts instead. |
| DELETE | `/api/users/{id}/friend-request` | Withdraw the pending request |
| GET | `/api/friend-requests` | Incoming requests awaiting your answer |
| POST | `/api/friend-requests/{id}/accept` | Accept — `{id}` is the request id, not a user id |
| DELETE | `/api/friend-requests/{id}` | Reject |
| DELETE | `/api/friends/{id}` | Unfriend. Either side can call it. |
| POST \| DELETE | `/api/users/{id}/block` | Block / unblock. Blocking drops any friendship or request. |

### Notifications

| Method | Path | Description |
|---|---|---|
| GET | `/api/notifications` | `[]` — stub until model is added |

### System

| Method | Path | Description |
|---|---|---|
| GET | `/health` | DB ping — for readiness probes |
| GET | `/health/live` | Uptime in seconds |
| GET | `/api/docs` | Swagger UI |
| GET | `/api/openapi.json` | OpenAPI schema |

---

## 9. Integration with the Mobile Frontend

### Her code layout (Expo / React Native)

```
mobile/src/
├── services/api/
│   ├── client.ts          # fetch wrapper + Bearer token + fallback to mocks
│   ├── auth.api.ts        # login/register/me
│   ├── trips.api.ts       # list/save/getById
│   ├── rewards.api.ts     # list/redeem/myVouchers
│   ├── leaderboard.api.ts # get
│   ├── notifications.api.ts
│   ├── user.api.ts        # stats
│   └── mocks/mockData.ts  # fallback data when server is unreachable
├── screens/auth/
│   ├── LoginScreen.tsx    # Sends { email, password }, stores { token, user }
│   └── RegisterScreen.tsx # Sends { name, email, password, phone?, city?, age?, licenseYear? }
└── context/AppContext.tsx # Global state, sends trips via tripsApi.save
```

### How to connect her app to our server

Server URL is configured in `mobile/src/constants/serverConfig.ts`:
```ts
export const USE_REAL_SERVER = true;
export const STAGING_SERVER_URL = 'http://10.0.2.2:3000'; // emulator → host alias
```

- **Android emulator** (default): `10.0.2.2` is the emulator's built-in alias for the host machine — already configured.
- **Physical device** on the same Wi-Fi: change `STAGING_SERVER_URL` to the host's IP, e.g. `http://192.168.1.42:3000`.
- **iOS Simulator**: change to `http://localhost:3000`.
- **Azure** (after deploy): change to `https://carma-api.<region>.azurecontainerapps.io`.

### API contract comparison (Frontend ↔ Backend)

| Endpoint she calls | What she expects | What the server returns | Match |
|---|---|---|---|
| `POST /api/auth/login` | `{ token, user }` | `{ token, user }` | ✅ |
| `POST /api/auth/register` | `{ token, user }` | `{ token, user }` | ✅ |
| `GET /api/auth/me` | user | user | ✅ |
| `GET /api/trips` | `{ trips }` | `{ trips }` | ✅ |
| `POST /api/trips` | trip | trip | ✅ |
| `GET /api/rewards` | `{ rewards, vouchers }` | `{ rewards, vouchers }` | ✅ |
| `POST /api/rewards/:id/redeem` | `{ voucher }` | `{ voucher }` | ✅ |
| `GET /api/vouchers` | `{ vouchers }` | `{ vouchers }` | ✅ |
| `GET /api/leaderboard?type=...` | `{ entries, currentUserId }` | `{ entries, currentUserId }` | ✅ |
| `GET /api/notifications` | array | `[]` (stub) | ✅ |
| `GET /api/user/stats` | `{ stats }` | `{ stats }` | ✅ |

### Handling snake_case ↔ camelCase mixing

Pydantic schemas inherit from `CamelModel` (`app/schemas/_base.py`) which sets:
```python
model_config = ConfigDict(
    alias_generator=to_camel,
    populate_by_name=True,
    from_attributes=True,
)
```

That makes the wire format camelCase (Python attributes stay snake_case). Routes set `response_model_by_alias=True`, so output is always camelCase. For trip-save where the frontend genuinely mixes naming, the DTO declares both via `AliasChoices`:

```python
distance_km: float | None = Field(
    default=None,
    validation_alias=AliasChoices("distanceKm", "distance"),
)
avg_score: float | None = Field(
    default=None,
    validation_alias=AliasChoices("avgScore", "avg_score", "score"),
)
```

Both styles are accepted on input.

---

## 10. Running Locally — Step by Step

### First time

```powershell
# From the monorepo root — installs all prerequisites, creates venv,
# applies migrations, seeds demo data, adds firewall rule.
.\scripts\setup.ps1   # requires: run PowerShell as Administrator
```

### Every day

```powershell
# Starts Docker, DB, FastAPI server, and Expo Metro in one command.
.\scripts\dev.ps1
```

Then press **`a`** in the Metro window to open the app on the Android emulator.

- API: `http://localhost:3000/api/...`
- Swagger: `http://localhost:3000/api/docs`
- Health: `http://localhost:3000/health`

### Demo user

```
email:    daniel@carma.app
password: password123
```

### Quick smoke test (PowerShell)

```powershell
# Login
$body = '{"email":"daniel@carma.app","password":"password123"}'
$res = Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/auth/login `
  -ContentType 'application/json' -Body $body
$token = $res.token
$res.user.name   # "דניאל כהן"

# GET /me
Invoke-RestMethod -Uri http://localhost:3000/api/auth/me `
  -Headers @{ Authorization = "Bearer $token" }
```

### Useful commands

```powershell
uvicorn app.main:app --reload          # dev server
ruff check . ; ruff format .           # lint + format
mypy app                               # typecheck
pytest                                 # tests
alembic revision --autogenerate -m "msg"   # new migration
alembic upgrade head                   # apply migrations
alembic downgrade -1                   # rollback one
python -m app.seed                     # reseed
```

---

## 11. CI/CD and Azure Deployment

### CI Workflow (`.github/workflows/ci-server.yml`)

Runs on every PR and push to main (tiered):

1. **lint** — always runs: `ruff check`, `ruff format --check`. Fast gate on every push.
2. **typecheck-test** — mypy + alembic upgrade + pytest. Runs on push to main, `workflow_dispatch`, or label `run-full-ci`.
3. **smoke** — starts a live server and runs `scripts/smoke.sh`. Same gate as typecheck-test.
4. **docker-build** — verifies the Dockerfile builds. No push (that's in deploy).

### Deploy Workflow (`.github/workflows/deploy.yml`)

Runs on push to main or manually. **Gated** on the existence of the `AZURE_CLIENT_ID` secret — skips silently otherwise.

When it runs:

1. `azure/login@v2` via **GitHub OIDC** — no stored password (see below).
2. `az acr login` to ACR.
3. `docker build` + `docker push` of an image tagged `:${{ github.sha }}`.
4. `az containerapp update --image` to roll out, setting `TRUSTED_PROXY_COUNT=1`.
5. Prints the resulting revision and image, so the run log records what shipped.

### Auth: OIDC against a managed identity (not a service principal)

The old note here said the deploy could not run because an Azure for Students
subscription "cannot hold a service principal". That was the wrong diagnosis.
The subscription was never the blocker — we are **Owner** on it. The blocker is
MTA's *directory*: it sets `defaultUserRolePermissions.allowedToCreateApps: false`
and our account holds no directory role, so both `az ad app create` and
`az ad sp create-for-rbac` fail with `Insufficient privileges`.

The way around it, without involving MTA IT: a **user-assigned managed identity**
is an Azure *resource*, not a directory app registration. It is created under the
subscription Owner role by the resource provider, and it accepts the same
federated credentials an app registration would. Nothing is stored in GitHub but
identifiers, and there is no secret to rotate.

One-time setup, already applied:

```bash
az provider register -n Microsoft.ManagedIdentity --wait

# NOTE: westeurope is rejected on this subscription — see the region trap below.
az identity create -n carma-ci -g carma-rg -l germanywestcentral

az identity federated-credential create --name github-main \
  --identity-name carma-ci -g carma-rg \
  --issuer "https://token.actions.githubusercontent.com" \
  --subject "repo:Carma-Team/carma:environment:production" \
  --audiences "api://AzureADTokenExchange"
```

Plus `AcrPush` on the registry and `Contributor` on the container app — scoped to
those two resources, not the subscription.

Two things the workflow depends on and that are easy to break by accident:

- `permissions: id-token: write` at the workflow level. Without it there is no OIDC token.
- `environment: production` on the deploy job. The credential's subject is
  `repo:Carma-Team/carma:environment:production`; drop the environment key and the
  subject silently becomes `...:ref:refs/heads/main`, which will not match.

> **`TRIP_SIGNING_SECRET` is provisioned.** It exists on the app as the secret
> `trip-secret` (64 chars, random), referenced by `TRIP_SIGNING_SECRET`. The
> value is not recorded anywhere outside the Container App — read it back with
> `az containerapp secret show` if you ever need it. This was the last thing
> stopping the first automated deploy from crash-looping. (#95)
>
> Setting it only makes the server *able* to verify signatures. It does not
> enforce them: the mobile client still sends a `ph:`-prefixed placeholder that
> `_verify_signature` deliberately lets through. Enforcement is #13, and it waits
> on the mobile signing path (#96).
>
> `TRUSTED_PROXY_COUNT=1` is set on the app too (#99). The deploy workflow also
> passes it on every update, which is now belt-and-braces rather than the only
> thing supplying it — so a bare `az containerapp update --image` boots as well.

### Container App environment variables

These are what the **server** needs to boot, and they are a different list from
the GitHub secrets further down. With `ENV=production`, a missing one is a
startup `ValueError` and a crash loop — deliberate, so a misconfigured server
never serves traffic while looking healthy (`app/config.py`).

| Variable | Required | Why it fails loudly |
|---|---|---|
| `ENV=production` | yes | Turns on the two guards below. Without it they never fire. |
| `DATABASE_URL` | yes | Postgres, `asyncpg` driver. Use a secret reference. |
| `JWT_SECRET` | yes | 16+ characters. Use a secret reference. |
| `TRIP_SIGNING_SECRET` | yes in production | 32+ characters. Empty means the trip-scoring oracle accepts anything — see #24. **Set** on the live app as `secretref:trip-secret` (#95). |
| `TRUSTED_PROXY_COUNT=1` | yes in production | 1 = the Container Apps ingress. At 0, every request counts against the ingress address, so the whole user base shares one rate-limit bucket — 30 requests a minute for everyone together, and indistinguishable from an outage. **Set** on the live app, and passed again by the deploy workflow (#99). |
| `SMS_PROVIDER`, `TWILIO_*` | only for real SMS | Defaults to the console sender. |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | optional | Silent no-op when unset. |

### Azure setup (one-time)

> **Region trap.** `westeurope` is **rejected** on this subscription by the
> "Allowed resource deployment regions" policy (`RequestDisallowedByAzure`) —
> this is the one thing the student account genuinely does restrict. The live
> resources are in `israelcentral` (ACR, Postgres) and `germanywestcentral`
> (Container App), not `westeurope` as this block used to say.

```bash
RG=carma-rg
LOC=germanywestcentral    # NOT westeurope — blocked by subscription policy
ACR=carmaregistry         # globally unique
APP=carma-api
DB=carma-pg

az group create -n $RG -l $LOC

az acr create -n $ACR -g $RG --sku Basic --admin-enabled true

az postgres flexible-server create -g $RG -n $DB -l $LOC \
  --tier Burstable --sku-name Standard_B1ms \
  --admin-user carma_admin --admin-password "ChangeMeStrong123!" \
  --version 16 --public-access 0.0.0.0
az postgres flexible-server parameter set -g $RG -s $DB \
  --name azure.extensions --value POSTGIS
az postgres flexible-server db create -g $RG -s $DB -d carma

az containerapp env create -n carma-env -g $RG -l $LOC
az containerapp create -n $APP -g $RG --environment carma-env \
  --image $ACR.azurecr.io/carma-server:bootstrap \
  --target-port 3000 --ingress external \
  --registry-server $ACR.azurecr.io \
  --secrets db-url="postgresql+asyncpg://..." jwt-secret="<random>" \
            trip-secret="<random, 32+ chars>" \
  --env-vars ENV=production DATABASE_URL=secretref:db-url \
             JWT_SECRET=secretref:jwt-secret \
             TRIP_SIGNING_SECRET=secretref:trip-secret \
             TRUSTED_PROXY_COUNT=1 SMS_PROVIDER=console
```

> This block used to end `SMS_PROVIDER=twilio`, which makes the server refuse to
> start unless `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_FROM_NUMBER`
> are all set too (`app/config.py`). The live app runs `console`. Use `twilio`
> only when you are actually wiring Twilio, and set the three variables with it.

### Manual deployment

**Superseded by the OIDC deploy above — kept as the break-glass path.** Use it
when the workflow itself is broken, or to roll back faster than a merge to main.
Run it from a machine logged in with `az login`.

> The question this section used to pose has been answered. `az ad app create`
> fails, but not for the reason assumed: it is MTA's directory blocking app
> registration, not the student subscription. A user-assigned managed identity
> sidesteps it entirely, and the automated deploy is switched on. (#58)

```bash
RG=carma-rg
ACR=carmaregistry3819    # the live registry — not `carmaregistry`, which is a
                         # placeholder in the one-time setup block above
APP=carma-api
TAG=$(git rev-parse --short HEAD)

az acr login -n $ACR
docker build -t $ACR.azurecr.io/carma-server:$TAG ./server
docker push $ACR.azurecr.io/carma-server:$TAG

az containerapp update -n $APP -g $RG \
  --image $ACR.azurecr.io/carma-server:$TAG
```

That is the whole path now — `ENV`, `DATABASE_URL`, `JWT_SECRET`,
`TRIP_SIGNING_SECRET` and `TRUSTED_PROXY_COUNT` all live on the app, so an image
swap carries no extra variables with it. Recreate the app and you are setting
them all again from the table above.

Then confirm the server actually came up, rather than assuming it did:

```bash
az containerapp revision list -n $APP -g $RG -o table   # is the new revision healthy?
curl -fsS https://<app-fqdn>/health                      # does it answer?
az containerapp logs show -n $APP -g $RG --tail 50       # ValueError = a missing variable
```

A crash loop right after a deploy almost always means one of the variables in
the table above is missing. That is the intended failure — read the log, set the
variable, redeploy.

### GitHub secrets

All six are set. None of them is a password — the first three are identifiers,
useless to anyone without the federated trust, so there is nothing to rotate.

| Secret | What it is |
|---|---|
| `AZURE_CLIENT_ID` | Client ID of the `carma-ci` managed identity. Also the gate: unset ⇒ deploy skips. |
| `AZURE_TENANT_ID` | Directory (tenant) ID |
| `AZURE_SUBSCRIPTION_ID` | Subscription ID |
| `AZURE_RESOURCE_GROUP` | `carma-rg` |
| `AZURE_CONTAINER_APP` | `carma-api` |
| `AZURE_CONTAINER_REGISTRY` | `carmaregistry3819` (without `.azurecr.io`) |

### Migrations in production

The Dockerfile entrypoint is:
```dockerfile
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
```
Every deployment runs all pending migrations before the server boots. Alembic migrations are idempotent — re-running `upgrade head` on a fully-migrated DB is a no-op.

---

## 12. Monitoring and Observability

### Application Insights

`app/monitoring.py::configure_monitoring` wires `azure-monitor-opentelemetry` plus the FastAPI and SQLAlchemy OpenTelemetry instrumentations. If `APPLICATIONINSIGHTS_CONNECTION_STRING` is unset it's a silent no-op — good for dev.

Auto-collected:
- **Requests** — every HTTP request: duration, status, route.
- **Dependencies** — every Postgres query, every Twilio call.
- **Exceptions** — uncaught exceptions (also captured by the global handler).
- **Live Metrics** — CPU/RPS/latency in real-time in the Azure portal.

### Health endpoints

| Endpoint | Purpose |
|---|---|
| `GET /health` | DB connection check — Azure Container Apps readiness probe. |
| `GET /health/live` | Uptime — liveness probe. |

### Logs

`uvicorn` and our `logging` calls emit to stdout/stderr. Azure Container Apps streams them to Log Analytics. Useful KQL:
```kusto
ContainerAppConsoleLogs_CL
| where ContainerAppName_s == "carma-api"
| where TimeGenerated > ago(1h)
| order by TimeGenerated desc
```

---

## 13. Spec Compliance Map

| Spec section | What's required | Where it lives |
|---|---|---|
| 4.1.1 Platform support | iOS 14+ / Android 11+ | the mobile frontend (Expo) |
| 4.1.2 BT pairing | Up to 2 vehicles | `User.bluetooth_device_id` (extendable) |
| **4.2.1 Phone + OTP auth** | SMS with code | `services/auth.py::register_with_otp / verify_otp` |
| 4.2.2 Registration details | name, age, license | `schemas/auth.py::RegisterIn / OtpRegisterIn` |
| 4.3.5 Scoring + gamification | Score + points | `Trip.avg_score`, `Trip.points`, `User.points` / `total_points` |
| 4.3.5.3 Roadmap 10 levels | Levels table | `Level` model + `app/seed.py` |
| 4.3.6 Marketplace | Catalog + QR | `services/rewards.py` |
| 4.3.6.2 One-time QR | Expires in 5 min | `VOUCHER_TTL_MINUTES = 5` |
| 4.4.4 Points accumulation | Updated on sync | `services/trips.py::save` |
| 4.5 / 5.2.3 GDPR | Self-deletion | `DELETE /api/users/me` |
| **5.2.1 TLS 1.3** | All traffic | Azure Container Apps ingress |
| **5.2.4 Attempt limiting** | 5 fails → 15 min | `services/auth.py::_record_failure` |
| **5.2.5 QR 5-min validity** | Expiry | `Redemption.expires_at` + `VOUCHER_TTL_MINUTES` |
| **5.3 Data entities** | All spec tables | `app/models/` |

### Not 1:1 to spec — deliberate

- **Field naming:** spec uses e.g. `cost_points`, models use Python `cost_points`, wire format is `costPoints` (camelCase). Both styles are accepted on input for `trips`.
- **Email-based auth:** spec only covers phone. We added email+password because the mobile frontend was already wired for it. Both paths are active.
- **Friendships:** spec doesn't define a friends table. We use `user_friends` — one row per mutual friendship, requester → recipient, with a `pending`/`accepted`/`blocked` status.

---

## 14. Out of Scope

Matching spec section 8:

- **OBD-II integration**
- **Offline redemption**
- **Driver chat**
- **Social media sharing**
- **Web admin panel** — admins use the same mobile app.

Deliberately deferred:

- **Full CARMA Score algorithm** (Appendix C) — ✅ implemented server-side in `app/services/scoring.py` (v2.1). Server is the sole scoring oracle; client sends raw telemetry only. The v1 engine it replaced was deleted in #53; only its night-risk multiplier survives, in `app/services/risk.py`.
- **Notification + Achievement + Friendship models**.
- **License image upload** (needs Azure Blob Storage). The `license_img_url` field is in the schema.
- **Refresh tokens** — current JWT is 7 days, single token.

---

## 15. Next Steps

### Right now (mobile integration)

1. Run `.\scripts\dev.ps1` from the monorepo root — starts everything. Visit `/api/docs` at `http://localhost:3000/api/docs`.
2. The emulator is already pre-configured to reach the server at `http://10.0.2.2:3000` via `serverConfig.ts` — no changes needed.
3. Log in in the app with `daniel@carma.app` / `password123` — should hit the real server.
4. Run a trip in the app and verify it persists in the DB (`docker exec -it carma_db psql -U carma -d carma -c "SELECT id, user_id, distance_km, avg_score FROM trips ORDER BY created_at DESC LIMIT 5;"`).

### Soon

5. ~~Implement the full Score algorithm~~ ✅ Done — server-side scoring oracle live since v1.5.
6. Add `Notification`, `Achievement`, `Friendship` models + migrations.
7. Replace the notifications stub with real data + push notifications (Expo Push).
8. Add e2e tests for auth + trips + rewards.
9. Stand up Azure with the commands above and ship the first deploy.
10. Set `APPLICATIONINSIGHTS_CONNECTION_STRING` and confirm telemetry.

### Later

11. **PostGIS GEOGRAPHY** column on `businesses` + GIST index for fast radius searches.
12. **Refresh tokens** with rotation.
13. **Per-user rate limiting** (slowapi with a Redis storage).
14. **Multi-language SMS templates**.
15. **Admin endpoints** for tuning scoring parameters (spec Appendix C-VI).

---

> **Questions / feedback:** This document is the single source of truth for how the server is built and integrates with the frontend. If something changes in code but not here — update it.

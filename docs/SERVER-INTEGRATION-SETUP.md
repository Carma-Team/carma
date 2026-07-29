# Server Integration Setup — Pre-Build Checklist

This document describes the changes made to enable the mobile app to communicate with a
real backend server and database, and the steps required before building an installable
APK/IPA for real-device testing.

> **For AI assistants:** If you are onboarding to this project and need to understand how
> the mobile app connects to the backend, or what is required before a production build,
> start here.

---

## What was changed in the mobile app

### `mobile/src/constants/serverConfig.ts`

This is the **only file that controls which server the app talks to**. It contains two values:

```ts
USE_REAL_SERVER    // boolean — false = local mock server, true = real server
STAGING_SERVER_URL // string  — URL of the real server (used when USE_REAL_SERVER = true)
```

**Development mode** (`USE_REAL_SERVER = false`): requests are routed through the Metro
bundler proxy to a local mock server (`mock-server/local-server/`). This only works inside
Expo Go or a dev client — not in a standalone APK.

**Build mode** (`USE_REAL_SERVER = true`): all requests go directly to `STAGING_SERVER_URL`.
This is what must be set before building an APK/IPA for device testing.

### `mobile/src/services/api/health.api.ts`

A lightweight `pingServer()` function that calls `GET /health/live` on the configured server.
`AppContext` calls this on app startup. If the server does not respond, a warning toast is
shown to the user. This check requires no authentication.

---

## Server requirements

The FastAPI server (`server/`) is the real backend. Before a build can connect to it, the
following must be in place.

### 1. PostgreSQL database

A PostgreSQL database must be running and reachable from the server host. The connection
string format is:

```
postgresql+asyncpg://<user>:<password>@<host>:<port>/<database>
```

### 2. Environment variables

The server reads its configuration from environment variables. The full list of required
variables is documented in `server/.env.example`. The minimum set for a working deployment:

| Variable | Description |
|---|---|
| `ENV` | `production` or `development` |
| `DATABASE_URL` | PostgreSQL connection string (see above) |
| `JWT_SECRET` | Long random string (minimum 16 characters) — signs auth tokens |
| `PORT` | Port the server listens on (default: `3000`) |
| `CORS_ORIGINS` | Comma-separated allowed origins, or `*` to allow all |
| `SMS_PROVIDER` | `console` (logs OTPs to stdout) or `twilio` (real SMS) |

### 3. Database migrations

After the server is running for the first time against a fresh database, run:

```bash
cd server
alembic upgrade head
```

This creates all tables. It is safe to run on every deploy — Alembic skips already-applied
migrations. On platforms that support pre-deploy hooks, this command can be set to run
automatically before each release.

### 4. Verify the server is reachable

Open the following URL in a browser or send a GET request:

```
<server-url>/health/live
```

A healthy server returns HTTP 200 with a JSON body. If this endpoint is unreachable, the
mobile app will display a warning toast on startup and API calls will fail.

```json
{ "status": "ok", "uptime": 123 }
```

---

## Building the APK / IPA

Once the server is deployed and verified, update the mobile app configuration and trigger
the build.

### Step 1 — Update `serverConfig.ts`

```ts
// mobile/src/constants/serverConfig.ts
export const USE_REAL_SERVER    = true;
export const STAGING_SERVER_URL = 'https://<your-server-url>';
```

Commit this change (or keep it as a local build-time change — do not merge to `main` with
a hardcoded staging URL).

### Step 2 — Build

**Android APK** (internal distribution — installs directly without the Play Store):

```bash
cd mobile
eas build -p android --profile preview
```

**iOS IPA** (requires an Apple Developer account):

```bash
cd mobile
eas build -p ios --profile preview
```

EAS builds in the cloud. When the build finishes, a download link is provided. The APK
can be installed directly on any Android device. The IPA requires TestFlight or direct
device provisioning.

### Step 3 — Verify connectivity on device

After installation, open the app. If the server is reachable, no warning appears and
login/registration works normally. If a yellow warning toast appears, the server is either
down or the URL in `STAGING_SERVER_URL` is incorrect.

---

## Notes for the backend developer

- The server's `HOST` should be set to `0.0.0.0` (already the default in `.env.example`)
  so it is reachable from outside the host machine.
- If deploying on a free-tier cloud plan that spins the server down after inactivity,
  the first request after a cold start may take 30–60 seconds. The health check toast
  in the app handles this gracefully.
- All API endpoints the mobile app calls are prefixed with `/api/`. The health endpoints
  (`/health`, `/health/live`) are outside this prefix and require no authentication.
- After any schema change in `server/app/models/`, a new Alembic migration must be
  generated and committed:
  ```bash
  cd server
  alembic revision --autogenerate -m "description"
  alembic upgrade head
  ```

---

## Quick reference — which file to change for what

| Goal | File |
|---|---|
| Point the app at a different server URL | `mobile/src/constants/serverConfig.ts` |
| Toggle between mock and real server | `mobile/src/constants/serverConfig.ts` — `USE_REAL_SERVER` |
| Add a new API endpoint | `mobile/src/services/api/<resource>.api.ts` |
| Change server port or database | `server/.env` (copy from `.env.example`) |
| Add a new database table | `server/app/models/` + Alembic migration |
| Re-enable the SWERVE detection feature | Search codebase for `// EVT_SWERVE disabled` and uncomment all matching blocks |

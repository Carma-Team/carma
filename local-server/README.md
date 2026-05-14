# CARMA — Local Development Server (`carma-local-server`)

An Express server that mirrors the routes and JSON shape of the real CARMA backend (Nave's FastAPI server). All data lives in `db.json` and is read/written on every request — no in-memory state, restarts are safe.

**Current role: mock backend.**
The real server (built with FastAPI by Nave) is not yet available. This server acts as a stand-in — same route paths, same request/response shapes — so the app can be fully tested end-to-end today.

**Future role: proxy.**
Once the real server is live, this server can be switched to proxy mode: forward each incoming request to the real backend and return its response. Because the API contract is already aligned, the transition requires only replacing the `db.json` read/write logic with `http-proxy-middleware` calls — no changes needed in the app itself.

---

## Prerequisites

- Node.js 18+
- Run inside WSL if the Expo dev server is also running in WSL (they must share the same `localhost`)

---

## Running

```bash
npm install        # first time only
node server.js     # production-style start
# or
npm run dev        # nodemon (auto-restarts on file change)
```

Server starts on **port 3000**. The terminal prints the local and network URLs on startup.

---

## Demo Credentials

| Email | Password | Role |
|---|---|---|
| `admin@carma.app` | `admin123` | admin |
| `daniel@carma.app` | `password123` | driver |
| `arcaffe@carma.app` | `business123` | business (Arcaffe) |
| `superpharm@carma.app` | `business123` | business (Super-Pharm) |

---

## Project Structure

```
carma-local-server/
├── server.js       # Single-file Express server — all routes and logic
├── db.json         # The database — all data lives here, edited in place
└── package.json
```

### `server.js`

Organized in sections:

| Section | What it does |
|---|---|
| **DB helpers** | `readDb()` / `writeDb()` — reads and writes `db.json` on every request |
| **Serializers** | Convert snake_case DB fields to camelCase for the API response |
| **Auth middleware** | `requireAuth` — verifies JWT, attaches `req.currentUser` |
| **`GET /health`** | Health check + uptime |
| **`POST /api/auth/login`** | Password check, returns JWT + user |
| **`POST /api/auth/register`** | Creates new driver user, returns JWT + user |
| **`GET /api/auth/me`** | Returns current user from token |
| **`PATCH /api/users/me`** | Updates name, language, age, city |
| **`GET /api/user/stats`** | Aggregated trip stats for the current user |
| **`GET /api/trips`** | Lists trips for the current user |
| **`POST /api/trips`** | Saves a completed trip, updates user points and level |
| **`GET /api/trips/:id`** | Single trip with events |
| **`GET /api/rewards`** | Active rewards + user's vouchers |
| **`POST /api/rewards/:id/redeem`** | Deducts points, creates a voucher with QR code |
| **`GET /api/vouchers`** | All vouchers for the current user |
| **`GET /api/leaderboard`** | National / city / friends ranking |
| **`GET /api/levels`** | Level configuration (thresholds, names, icons, perks) |
| **`GET /api/business/rewards`** | Lists rewards belonging to the authenticated business |
| **`POST /api/business/rewards`** | Creates a new reward (business only) |
| **`PATCH /api/business/rewards/:id`** | Updates a reward |
| **`DELETE /api/business/rewards/:id`** | Deletes a reward |

### `db.json`

A flat JSON file that acts as the database. Top-level keys:

| Key | Contents |
|---|---|
| `users` | All user accounts (drivers, admins, business accounts) |
| `businesses` | Business profiles linked to business user accounts |
| `trips` | All completed trips, referenced by `user_id` |
| `rewards` | Reward catalog entries, referenced by `business_id` |
| `redemptions` | Vouchers issued when a user redeems a reward |
| `levels` | Level configuration: thresholds, names, icons, perks |
| `events` | (optional) Driving events associated with trips |

---

## How It Fits Into the Project

```
Phone (Expo Go)
  │  HTTPS
  ▼
Expo Tunnel URL  (exp.direct)
  │
  ▼
Metro Dev Server  (port 8081, running in WSL)
  │  /api/* requests intercepted by metro.config.js proxy middleware
  ▼
carma-local-server  (port 3000, running in WSL)
  │  read / write
  ▼
db.json
```

The real backend (Nave's FastAPI server) is not yet available. This server acts as a proxy stand-in: same routes, same response shapes, data persisted locally in `db.json`.

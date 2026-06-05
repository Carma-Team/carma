# CARMA — Backend Architecture Sync · Meeting Dashboard
**Date:** 2026-05-21 · **Time:** 10:30 AM · **Attendees:** Dan (CTO) · Sean (Backend Lead) · Naveh (DB Lead)
**Purpose:** Live screen-share reference. Everything we need to align on before the Academic Demo in 2 weeks.

---

> **One goal for this session:** Walk out with every P0 task assigned to a single owner, unblocked, and sequenced in the right order.

---

## Table of Contents

1. [Feature Status Matrix](#1-feature-status-matrix)
2. [Demo Environment Strategy — Local Pipeline, Not Production](#2-demo-environment-strategy--local-pipeline-not-production)
3. [Folder Architecture — Current vs. Demo Target](#3-folder-architecture--current-vs-demo-target)
4. [Full Vision vs. Two-Week Demo Target](#4-full-vision-vs-two-week-demo-target)
5. [Task Backlog by Owner — Notion-Ready](#5-task-backlog-by-owner--notion-ready)
6. [Appendix A — P0 Dependency Chain](#appendix-a--p0-dependency-chain)
7. [Appendix B — Demo Green Checklist](#appendix-b--demo-green-checklist)

---

## 1. Feature Status Matrix

> `🟢 Fully Operational` — Works end-to-end, tested, stable.
> `🟡 In Development` — Feature exists, but has a known critical flaw.
> `🔴 Not Started` — Designed and planned; zero working server-side code today.

| Feature Name | Status | Current Reality |
|---|---|---|
| GPS Sampling & Distance | `🟢 Fully Operational` | Haversine formula; GPS ticks below 3 km/h ignored to prevent noise |
| Hard Brake Detection (IMU) | `🟢 Fully Operational` | 10Hz accelerometer + EMA gravity filter; threshold 0.4g; 3s cooldown |
| Aggressive Acceleration Detection (IMU) | `🟢 Fully Operational` | Same pipeline as hard brakes; fires on positive (forward) force |
| Sharp Turn Detection (IMU) | `🟢 Fully Operational` | Gyroscope yaw rate threshold: 1.5 rad/s |
| Phone Usage — Speed-Weighted Penalties | `🟢 Fully Operational` | Each touched second is scaled by current speed; weighted value feeds score |
| Trip Start Validation — 30-Second Rule | `🟢 Fully Operational` | Requires 30 continuous seconds above 10 km/h before scoring begins |
| Trip End Detection — 3-Minute Rule | `🟢 Fully Operational` | Trip ends after 3 continuous minutes below 10 km/h |
| Fraud Detection — Train/Bus Classifier | `🟢 Fully Operational` | 3-signal physics classifier on a 60s rolling window; score threshold 0.70 |
| Fraud Detection — Mid-Trip Monitoring | `🟢 Fully Operational` | Runs continuously throughout the trip, not just at start |
| Scoring Engine | `🟢 Fully Operational` | Pure function: `score = 100 − (HB×5 + AA×3 + ST×2 + phoneWeighted/duration×40)` |
| Night / Weekend Risk Multiplier | `🟢 Fully Operational` | ×1.5 for late night; ×2.0 for Friday/Saturday night (Israeli weekend) |
| Gamification — 10-Tier Level System (Client) | `🟡 In Development` | Level logic fully built and tested on the client. Server never saves the updated level. Everyone is stuck at level 1. |
| Level Persistence in Database | `🔴 Not Started` | `users.level` column exists and defaults to 1. Nothing ever updates it. |
| Offline Sync Queue — SyncManager | `🟢 Fully Operational` | FIFO queue in AsyncStorage; mutex lock; max 5 retries; 409 Conflict treated as success |
| Idempotency Key — Safe Retries | `🟢 Fully Operational` | `localTripId` sent as `Idempotency-Key` header; stored in a UNIQUE DB column |
| Backend Trip Ingestion | `🟡 In Development` | Saves the trip row, but accepts any payload blindly and corrupts points under concurrent load |
| User Points Accumulation | `🟡 In Development` | Python-level read-then-add-then-write. Not atomic. **Live data corruption bug.** |
| TelemetryDigest Storage — RFC-001 | `🔴 Not Started` | Client sends `telemetryDigest` + `payloadSignature`; server schema has no fields for either — both silently discarded |
| HMAC Payload Signing — Client | `🟡 In Development` | Client computes HMAC-SHA256 with a placeholder key; sends `ph:` prefix to signal "don't enforce yet" |
| HMAC Signature Verification — Server | `🔴 Not Started` | No verification function. No `TRIP_SIGNING_SECRET` env var. Signature is completely ignored. |
| Fraud Report API | `🟢 Fully Operational` | `POST /api/fraud` saves anomaly data to `fraud_reports` table |
| Raw Event Data Persistence | `🔴 Not Started` | Client sends a full `events` array per trip. Server accepts it, then throws it away. Nothing writes to the `events` table. |
| Leaderboard | `🟢 Fully Operational` | Full table scan — fast enough for demo scale (~10 users) |
| OTP Phone Authentication | `🟢 Fully Operational` | SMS OTP, bcrypt-hashed, 5-attempt lockout, 5-minute expiry; dev mode prints code to console |
| Global Rate Limiting | `🟡 In Development` | 500/hr + 30/min by IP via `slowapi`. No per-user daily cap exists. |
| Rewards Redemption | `🟢 Fully Operational` | QR generation, stock decrement, and point deduction all happen in one DB transaction |
| CORS Policy | `🟡 In Development` | Default `*` wildcard — fine for mobile-only, but must be locked before any web dashboard |

---

## 2. Demo Environment Strategy — Local Pipeline, Not Production

> **This is the most important alignment point for this meeting.**

For the academic presentation in two weeks, **we are not modifying or touching the live production server on Azure**. The cloud environment stays frozen exactly as it is. Zero risk.

**Instead, the goal is a fully functional local/staging pipeline:**

Sean and Naveh will implement all P0 fixes and run the Python server + PostgreSQL database locally on a dev machine. Dan will point the mobile app at that local server to demonstrate a real, un-hackable end-to-end flow live in front of the professors.

| What | Owner | How |
|---|---|---|
| Python/FastAPI server running locally | Sean | `uvicorn app.main:app --reload` on local machine |
| PostgreSQL database running locally | Naveh | Local Postgres instance (Docker or native); migration 0004 applied |
| All P0 fixes implemented locally | Sean + Naveh | Work on feature branch; does not touch production |
| Mobile app pointed at local server | Dan | Toggle `BASE_URL` in mobile client to local IP |
| Live end-to-end demo | Dan | Real device → real local server → real local database |

**The demo proves:**
- The server independently validates physics (a forged payload is rejected live)
- Points accumulate correctly even under retry load (the race condition is gone)
- The full RFC-001 audit trail works (telemetry digest is stored and queryable)

**What is explicitly not happening:** No production deployments. No Azure changes. No touching the cloud database.

---

## 3. Folder Architecture — Current vs. Demo Target

### 3.1 `./server/app` — What Changes and Why

```
server/app/  ── CURRENT STATE ──────────────────      server/app/  ── DEMO TARGET (2 weeks) ──────────────
                                                      
├── config.py                                         ├── config.py
│   ├── jwt_secret          (min 16 chars, HS256)     │   ├── jwt_secret                (unchanged)
│   ├── database_url                                  │   ├── database_url              (unchanged)
│   ├── cors_origins = "*"  ← open wildcard           │   ├── cors_origins = "*"        (demo-acceptable)
│   └── [NO trip_signing_secret] ← MISSING            │   └── trip_signing_secret = "" ← NEW env var
│                                                     │       (empty = unenforced; set in staging)
│                                                     │
├── database.py                                       ├── database.py  (NO CHANGES)
│   ├── AsyncEngine (pool_pre_ping=True)              │
│   └── SessionLocal (expire_on_commit=False)         │
│                                                     │
├── core/  (NO CHANGES NEEDED)                        ├── core/  (NO CHANGES)
│   ├── audit.py    ─ structured audit log   ✅       │
│   ├── deps.py     ─ CurrentUser, DbSession ✅       │
│   ├── logging.py  ─ JSON request formatter ✅       │
│   └── security.py ─ JWT HS256, bcrypt, OTP ✅       │
│                                                     │
├── models/                                           ├── models/
│   ├── trip.py                                       │   ├── trip.py
│   │   ├── idempotency_key: String(64) UNIQUE ✅     │   │   ├── idempotency_key        ✅ (unchanged)
│   │   ├── [NO telemetry_digest] ← MISSING ❌        │   │   ├── telemetry_digest: JSONB ← NEW column
│   │   └── [NO payload_signature] ← MISSING ❌       │   │   └── payload_signature: String(128) ← NEW
│   │                                                 │   │
│   └── user.py                                       │   └── user.py  (schema unchanged)
│       ├── points: Integer, default=0   ✅           │       ├── points: Integer         ✅
│       └── level:  Integer, default=1   ✅           │       └── level: Integer
│           └── [NEVER UPDATED] ← BUG ❌              │           └── recalculated in save() ← FIXED
│                                                     │
├── schemas/                                          ├── schemas/
│   └── trip.py                                       │   └── trip.py
│       └── SaveTripIn:                               │       └── SaveTripIn:
│           ├── points, avg_score, distance_km ✅     │           ├── points, avg_score, ...  ✅
│           ├── hard_brakes, risk_multiplier   ✅     │           ├── hard_brakes, risk_multiplier ✅
│           ├── [NO telemetry_digest] ← ❌            │           ├── telemetry_digest: dict|None ← NEW
│           └── [NO payload_signature] ← ❌           │           └── payload_signature: str|None ← NEW
│                                                     │
├── services/                                         ├── services/
│   └── trips.py  ← ⚠️  4 CRITICAL FLAWS            │   └── trips.py  ← ALL 4 FLAWS RESOLVED
│       save():                                       │       save():
│       ┌─────────────────────────────────────┐      │       ┌──────────────────────────────────────────┐
│       │ 1. Idempotency check          ✅    │      │       │ 1. Idempotency check               ✅   │
│       │ 2. [NO plausibility gate] ← ❌      │      │       │ 2. _validate_plausibility()    ← NEW ✅  │
│       │ 3. [NO HMAC verify]       ← ❌      │      │       │ 3. _verify_signature()         ← NEW ✅  │
│       │ 4. db.add(trip)               ✅    │      │       │ 4. db.add(trip)                    ✅   │
│       │ 5. user.points += trip.points ← ❌  │      │       │ 5. atomic UPDATE points + totals ← FIXED │
│       │    [Python RMW — Lost Update]       │      │       │    UPDATE users SET points=points+delta  │
│       │ 6. [NO events INSERT]     ← ❌      │      │       │ 6. db.add_all(event_objects)   ← NEW ✅  │
│       │ 7. [NO telemetry save]    ← ❌      │      │       │ 7. trip.telemetry_digest = dto.digest ✅ │
│       │ 8. [NO level recalc]      ← ❌      │      │       │ 8. level = points_to_level(total) ← NEW  │
│       └─────────────────────────────────────┘      │       └──────────────────────────────────────────┘
│                                                     │
│   └── [NO levels.py service] ← MISSING ❌           │   └── levels.py ← NEW (Python mirror of
│                                                     │       mobile/src/lib/gamification.ts thresholds)
│                                                     │
└── alembic/versions/                                 └── alembic/versions/
    ├── 0001_initial_schema.py           ✅               ├── 0001_initial_schema.py           ✅
    ├── 0002_idempotency_key_fraud.py    ✅               ├── 0002_idempotency_key_fraud.py    ✅
    └── 0003_fraud_index.py              ✅               ├── 0003_fraud_index.py              ✅
        [HEAD — DB is behind RFC-001]                     └── 0004_rfc001_telemetry_digest.py  ← NEW
                                                              (adds telemetry_digest JSONB,
                                                               payload_signature String(128),
                                                               partial index on non-null digest)
```

---

### 3.2 `./mobile/src` — Annotated Structure

> **Hard Boundary Rule:** `driving-sdk/` is a generic, extractable sensor library.
> Sean and Naveh: **do not add a single line inside `driving-sdk/`**. All CARMA-specific logic belongs in `lib/` directly, one level up.

```
mobile/src/
│
├── context/
│   └── AppContext.tsx                      ← Global state and event handling
│       ├── processEndTrip()               ─ calculates score, builds digest, signs it, queues it
│       ├── buildTelemetryDigest()         ─ RFC-001: packages 11 trip metrics into one clean object
│       ├── signTelemetryDigest()          ─ HMAC-SHA256 over the digest (Sprint 1: ph: prefix)
│       └── SIGNING_KEY                    ─ placeholder key — replaced by hardware key in Sprint+1
│
├── lib/                                    ← Pure TypeScript business logic (no React, no server calls)
│   │
│   ├── FraudDetector.ts                   ─ 3-signal train/bus classifier, 60-sample circular buffer
│   │   └── FRAUD_SCORE_THRESHOLD = 0.70
│   │
│   ├── TripValidationManager.ts           ─ Rule 1 (30s start), Rule 2 (3min stop), Rule 3 (fraud)
│   │   ├── START_THRESHOLD_MS  = 30_000
│   │   ├── END_THRESHOLD_MS    = 180_000
│   │   └── SPEED_THRESHOLD_KMH = 10
│   │
│   ├── gamification.ts                    ─ 10-tier level map, calculateLevel(), detectLevelUp()
│   │   └── LEVEL_DEFINITIONS[10]          ← must stay in sync with server/app/services/levels.py
│   │
│   ├── scoring.ts                         ─ calculateScore(), getRiskMultiplier() — pure math
│   │
│   ├── __tests__/                         ← 4 suites, 125 tests — ALL GREEN ✅
│   │   ├── gamification.test.ts
│   │   ├── scoring.test.ts
│   │   ├── syncQueue.test.ts
│   │   └── tripValidation.test.ts
│   │
│   └── driving-sdk/                       ← ⛔ HARD BOUNDARY — GENERIC SENSOR SDK ONLY
│       │                                     No CARMA business logic. No exceptions.
│       ├── index.ts                       ─ CarmaDrivingSDK: Bluetooth + sensors + trip lifecycle
│       ├── BluetoothManager.ts            ─ BLE device connect / disconnect
│       ├── types.ts                       ─ SDK-internal type definitions
│       └── sensors/
│           ├── SensorManager.ts           ─ GPS, accelerometer, gyroscope; EMA gravity filter
│           └── PhoneUsageManager.ts       ─ phone screen usage with kinetic speed weighting
│
└── services/
    ├── api/
    │   ├── client.ts                      ─ base HTTP wrapper + mock intercept flag
    │   ├── trips.api.ts                   ─ save(): attaches telemetryDigest + payloadSignature
    │   └── fraud.api.ts                   ─ syncInvalidTrip() → POST /api/fraud
    └── sync/
        ├── SyncManager.ts                 ─ FIFO offline queue, isFlushing mutex, MAX_ATTEMPTS=5
        └── types.ts                       ─ ValidTripPayload, TelemetryDigest, SyncQueueItem
```

---

### 3.3 The Core Problem: The Server Trusts Everything the Client Sends

All the smart validation logic lives on the phone. The fraud detection, the scoring formula, the trip validation rules — they only run on the device. The server's `save()` function does one check: *"Does this request have a valid JWT?"* If yes, it writes whatever numbers it received directly to the database.

This means any user who knows the API can skip the app entirely:

```bash
curl -X POST https://api.carma.app/api/trips \
  -H "Authorization: Bearer <any_valid_jwt>" \
  -H "Idempotency-Key: exploit-$(uuidgen)" \
  -d '{"points": 99999, "avgScore": 100, "distanceKm": 0.1, "durationSeconds": 61}'
```

That request succeeds today. One row is written to `trips`. `user.points` jumps by 99,999. **The server has no way to stop it.** The P0 tasks for Sean and Naveh close this gap by adding an independent server-side judge.

---

### 3.4 Deep Dive: The Lost Update Race Condition

This is the most critical data integrity bug right now. It causes silent, undetectable point loss any time two trip saves run at the same time for the same user — which happens regularly during a `SyncManager` queue flush.

**The exact sequence of what goes wrong:**

> The user's phone was offline for 20 minutes and drove 3 trips. When back online, SyncManager sends all 3 trips rapidly. A timeout causes Trip 2 to retry at the same moment Trip 3 is sending. Request A (+50 pts) and Request B (+80 pts) hit the server simultaneously.

| Time | Request A (+50 pts) | Request B (+80 pts) | DB: `users.points` |
|---|---|---|---|
| T=0 | Reads `user.points` → **100** | | 100 |
| T=1 | | Reads `user.points` → **100** | 100 |
| T=2 | Calculates 100 + 50 = **150** | | 100 |
| T=3 | | Calculates 100 + 80 = **180** | 100 |
| T=4 | Commits → writes **150** | | 150 |
| T=5 | | Commits → writes **180** | **180** ← overwrites 150! |

**Result:** Database shows 180. Correct answer is 100 + 50 + 80 = **230**. 50 points silently lost with no error, no warning, no log entry.

**The fix:** Move the addition into the SQL statement itself — `UPDATE users SET points = points + 50`. PostgreSQL executes this under a row-level lock as a single atomic operation. Concurrent requests on the same row are serialized. The race condition becomes structurally impossible.

---

### 3.5 Deep Dive: How the Plausibility Gate Catches Cheaters

The server checks all 11 `TelemetryDigest` fields on every incoming trip. Each has a valid range; together they form a web of cross-checks that a cheater must satisfy simultaneously — which is far harder than inflating a single number.

| Field | Valid Range | What It Catches |
|---|---|---|
| `avgScore` | 0.0 – 100.0 | A score above 100 is mathematically impossible by our formula |
| `points` | 0 – 10,000 | Blocks obvious inflation; a perfect-score 10 km night drive earns ~200 pts |
| `distanceKm` | 0 – 2,000 | 2,000 km is a continuous drive across Europe; anything above is not a car trip |
| `durationSeconds` | > 0 | Negative or zero duration is physically impossible |
| `hardBrakes` | 0 – 500 | 500 hard brakes = one every 7 seconds for a full hour; beyond that, a corrupted payload |
| `riskMultiplier` | 0.5 – 3.0 | Our formula only produces 1.0, 1.5, or 2.0; anything outside this range was never generated by the real app |
| `distanceKm ÷ durationSeconds` | avg speed < 250 km/h | **Most powerful check.** Catches any combination of inflated distance with a realistic-looking duration |
| `phoneSeconds` | 0 – durationSeconds | Can't use the phone for more seconds than the trip lasted |

**The key insight:** A cheater needs to inflate `points`, `distanceKm`, or `riskMultiplier` to get meaningful gains. But inflating any of these while keeping the other fields consistent requires coordinated changes — and the speed cross-check (`distance ÷ duration`) catches the most common manipulation pattern immediately.

---

## 4. Full Vision vs. Two-Week Demo Target

### 4.1 The Full Production Security Architecture

This is where CARMA is heading — not in two weeks, but this is the north star.

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  LAYER 0 — HARDWARE ATTESTATION  (Production target — future sprint)        ║
║                                                                             ║
║  ┌─────────────────────────────┐  ┌──────────────────────────────────────┐  ║
║  │ iOS: App Attest API         │  │ Android: Play Integrity API          │  ║
║  │                             │  │                                      │  ║
║  │ Apple verifies the device   │  │ Google verifies the device hasn't    │  ║
║  │ is a real iPhone and the    │  │ been rooted, the app hasn't been     │  ║
║  │ app hasn't been tampered    │  │ tampered with, and it's running on   │  ║
║  │ with. Issues a hardware-    │  │ genuine hardware. Returns a signed   │  ║
║  │ backed signing key.         │  │ integrity token.                     │  ║
║  └──────────────┬──────────────┘  └──────────────────┬───────────────────┘  ║
║                 └─────────── Device-bound key ────────┘                     ║
║                    (can't be extracted or spoofed on a real device)         ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  LAYER 1 — RAW TELEMETRY STREAMING  (future sprint)                         ║
║                                                                             ║
║  Instead of a post-trip summary, the SDK streams raw GPS and sensor frames  ║
║  (10 Hz) to the server via WebSocket during the drive. The server holds     ║
║  the raw data independently of anything the client claims.                  ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  LAYER 2 — SERVER-SIDE SCORING (future sprint, deferred per RFC-001 §2.3)  ║
║                                                                             ║
║  The server runs its own calculateScore() on the raw frames. If the         ║
║  server's score differs from the client's claim by more than 7 points,     ║
║  the trip is rejected. Deferred because it requires formula versioning.    ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  LAYER 3 — VALIDATION GATE  ← THIS IS OUR DEMO TARGET                      ║
║                                                                             ║
║  • Plausibility checks on all 11 TelemetryDigest fields                    ║
║  • HMAC signature verification ('ph:' bypass accepted in Sprint 1)         ║
║  • TelemetryDigest saved to DB — creates a permanent audit trail            ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  LAYER 4 — ATOMIC DATA LAYER  ← THIS IS OUR DEMO TARGET                    ║
║                                                                             ║
║  • UPDATE users SET points = points + delta  (eliminates the Lost Update)  ║
║  • Bulk INSERT of all trip events to the events table                       ║
║  • User level recalculated and saved after every trip                       ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

---

### 4.2 Demo vs. Production — Side-by-Side Comparison

| Concern | Academic Demo (2 Weeks) | Full Production Target |
|---|---|---|
| **Environment** | Local machine — Sean + Naveh run Python + Postgres locally | Azure cloud, fully deployed |
| **Device trust** | JWT with a symmetric secret (HS256), 7-day expiry | JWT with asymmetric keys (RS256) + key rotation, 1-hour expiry |
| **Payload signing** | `ph:` prefix — server logs it and lets it through | Real `expo-crypto` HMAC-SHA256 with a hardware-provisioned device key |
| **Payload validation** | Plausibility gate checks 11 fields for physically impossible values | + server independently recalculates the score and rejects mismatches |
| **Fraud detection** | Client-only: 3-signal physics classifier blocks train rides | + server-side stream analysis on raw sensor data |
| **Points write** | Atomic `UPDATE ... SET points = points + delta` | + Redis sorted-set leaderboard updated in real time |
| **Event data** | Bulk `INSERT` to the `events` table | + real-time stream processing for live analytics |
| **Rate limiting** | IP-based cap (500/hr global) | Per-user daily cap (20 trips/day) via Redis counter |
| **Audit trail** | `telemetry_digest` JSONB column on every trip row | + cold storage (S3/Blob) for raw telemetry frame archives |
| **Level updates** | Calculated synchronously inside `trips_service.save()` | Asynchronous Celery worker |

---

### 4.3 Demo Scenarios — What the Professors Will See

**Scenario 1 — A Normal, Legitimate Car Trip**

> ① Driver connects to Bluetooth. SDK starts watching for movement above 10 km/h.
> ② After 30 continuous seconds of driving, Rule 1 fires and scoring begins.
> ③ FraudDetector runs in the background: car steering creates lateral G-forces, so Signal B never fires → no fraud flag.
> ④ The driver brakes twice and checks their phone briefly. Score penalized accordingly.
> ⑤ After arriving, the car stays below 10 km/h for 3 minutes → Rule 2 ends the trip.
> ⑥ `processEndTrip()` calculates score, builds `TelemetryDigest`, signs it, hands it to `SyncManager`.
> ⑦ Server: `_validate_plausibility()` — all 11 fields within range → passes.
> ⑧ Server: atomic `UPDATE` adds earned points. Level recalculated and saved.
>
> ✅ **Professor sees:** Trip in history, correct points balance, accurate level badge.

**Scenario 2 — A Train Ride Detected and Blocked**

> ① User opens the app while sitting on a high-speed train (120 km/h).
> ② FraudDetector collects 30 samples. Signal A: rock-steady speed. Signal B: zero lateral G. Signal C: zero yaw change. Weighted score = 1.00. Mode → TRAIN.
> ③ `handleFraud()` silently aborts the session. No trip is created.
> ④ `fraudApi.syncInvalidTrip()` sends a report to `POST /api/fraud`. A row is written to `fraud_reports`.
>
> ✅ **Professor sees:** "Train ride detected" notification in the app + a fraud log entry in the DB.

**Scenario 3 — A Forged API Request (Expected Professor Question)**

> Professor: *"What stops someone from just sending `{ points: 99999 }` directly to the API?"*
>
> ① `POST /api/trips` with `{ "points": 99999, "avgScore": 100, "distanceKm": 0.1 }`
> ② `_validate_plausibility()`: `points (99999) > MAX_POINTS_PER_TRIP (10,000)` → HTTP 422.
> ③ Request rejected before a single database write occurs.
>
> ✅ **Professor sees:** Server independently rejects the forged payload with a clear error message.

---

### 4.4 What Is Explicitly Out of Scope for This Sprint

| Item | Why It Stays Out |
|---|---|
| Play Integrity / Apple App Attest | 4–6 weeks of research + Azure Key Vault integration |
| RS256 JWT + JWKS key rotation | HS256 is perfectly safe for a demo environment |
| Real `expo-crypto` HMAC with a device key | Requires key provisioning infrastructure that doesn't exist yet |
| WebSocket raw telemetry streaming | Entirely new transport layer |
| Redis leaderboard cache | Full table scan is fast enough for 10 demo users |
| Server-side score recomputation | Explicitly deferred in RFC-001 §2.3 |
| **`driving-sdk/` — Mai's SDK layer** | **Hard boundary. Do not modify under any circumstances.** |

---

## 5. Task Backlog by Owner — Notion-Ready

> **Priority Tags:**
> `[P0 — CURRENT SPRINT / DEMO TARGET]` Must be done before 2026-06-04
> `[P1 — NEXT SPRINT]` Desirable for post-demo hardening
> `[P2 — BACKLOG]` No current deadline

---

### 🟥 NAVEH — Database Lead

---

#### `[NAVEH-P0-1]` Fix the Lost Update — Make Point Accumulation Atomic
> **`[P0 — CURRENT SPRINT / DEMO TARGET]`**
> **File:** `server/app/services/trips.py:72–75`
> **Why this is first:** Every one of Sean's P0 tasks depends on the DB being clean. This must land before Sean starts writing.
> **Estimated effort:** 2–3 hours

**The broken code today:**
```python
# trips.py:72–75 — NOT SAFE under concurrent requests
if trip.points > 0 or trip.distance_km > 0:
    user.points         += trip.points
    user.total_points   += trip.points
    user.total_distance += trip.distance_km
```

**The exact fix — replace those four lines with this:**
```python
from sqlalchemy import update

if trip.points > 0 or trip.distance_km > 0:
    await db.execute(
        update(User)
        .where(User.id == user.id)
        .values(
            points=User.points + trip.points,
            total_points=User.total_points + trip.points,
            total_distance=User.total_distance + trip.distance_km,
        )
    )
```

**Acceptance criteria:** Write a test that fires 10 concurrent trip-save requests for the same user, each with a different point value. The final `users.points` must exactly equal the sum of all 10 deltas — not one point less.

---

#### `[NAVEH-P0-2]` Migration 0004 — Add RFC-001 Columns to `trips`
> **`[P0 — CURRENT SPRINT / DEMO TARGET]`**
> **File:** `server/alembic/versions/0004_rfc001_telemetry_digest.py` *(create this file)*
> **Blocks:** SEAN-P0-1 cannot start until these columns exist in the database

```python
"""rfc001_telemetry_digest

Revision ID: c4d5e6f7a8b9
Revises: <revision_id_of_0003>
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "c4d5e6f7a8b9"
down_revision: str | None = "<revision_id_of_0003>"

def upgrade() -> None:
    op.add_column("trips", sa.Column(
        "telemetry_digest",
        postgresql.JSONB(astext_type=sa.Text()),
        nullable=True,
    ))
    op.add_column("trips", sa.Column(
        "payload_signature",
        sa.String(128),
        nullable=True,
    ))
    op.execute(
        "CREATE INDEX ix_trips_has_telemetry ON trips (id)"
        " WHERE telemetry_digest IS NOT NULL"
    )

def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_trips_has_telemetry")
    op.drop_column("trips", "payload_signature")
    op.drop_column("trips", "telemetry_digest")
```

**Also update `server/app/models/trip.py` to match:**
```python
from sqlalchemy.dialects.postgresql import JSONB

telemetry_digest:  Mapped[dict | None] = mapped_column(JSONB, nullable=True)
payload_signature: Mapped[str | None]  = mapped_column(String(128), nullable=True)
```

**Acceptance criteria:** `alembic upgrade head` → `alembic downgrade -1` → `alembic upgrade head` completes cleanly. `\d trips` in psql shows both new columns.

---

#### `[NAVEH-P1-1]` Level Threshold Table — Python Mirror of `gamification.ts`
> **`[P1 — NEXT SPRINT]`**
> **File:** `server/app/services/levels.py` *(new, small file)*

The 10-tier level map is defined in `mobile/src/lib/gamification.ts`. We need the exact same thresholds on the server so `trips_service.save()` can recalculate a user's level after adding points.

```python
# sync-with: mobile/src/lib/gamification.ts — LEVEL_DEFINITIONS
_LEVEL_THRESHOLDS = [0, 1000, 2500, 4500, 6500, 8500, 10500, 13000, 16000, 20000]

def points_to_level(total_points: int) -> int:
    """Returns the tier number (1–10) for a given lifetime points total."""
    for level, threshold in enumerate(reversed(_LEVEL_THRESHOLDS), 1):
        if total_points >= threshold:
            return len(_LEVEL_THRESHOLDS) - level + 1
    return 1
```

---

#### `[NAVEH-P2-1]` Redis Sorted-Set Leaderboard Cache
> **`[P2 — BACKLOG]`** Full table scan is fast enough for the demo. Revisit after launch.

---

### 🟦 SEAN — Backend Lead

---

#### `[SEAN-P0-1]` Accept and Save `telemetry_digest` + `payload_signature`
> **`[P0 — CURRENT SPRINT / DEMO TARGET]`**
> **Blocked by:** NAVEH-P0-2 — database columns must exist first
> **Files:** `server/app/schemas/trip.py` + `server/app/services/trips.py`

Right now, both fields are sent by the client but silently dropped by Pydantic. Add the fields and wire them through to the DB.

**Add to `SaveTripIn` in `schemas/trip.py`:**
```python
from typing import Any

telemetry_digest: dict[str, Any] | None = Field(
    default=None,
    validation_alias=AliasChoices("telemetryDigest", "telemetry_digest"),
)
payload_signature: str | None = Field(
    default=None,
    validation_alias=AliasChoices("payloadSignature", "payload_signature"),
)
```

**In `trips_service.save()`, add to the `Trip(...)` constructor:**
```python
trip = Trip(
    # ... all existing fields ...
    telemetry_digest=dto.telemetry_digest,
    payload_signature=dto.payload_signature,
)
```

**Acceptance criteria:** `POST /api/trips` with `{"telemetryDigest": {"avgScore": 85.0, ...}}` → `SELECT telemetry_digest FROM trips ORDER BY created_at DESC LIMIT 1` returns a non-null JSON object.

---

#### `[SEAN-P0-2]` Add the Plausibility Validation Gate
> **`[P0 — CURRENT SPRINT / DEMO TARGET]`**
> **Blocked by:** Nothing — can run in parallel with NAVEH-P0-1
> **File:** `server/app/services/trips.py`

```python
_MAX_POINTS_PER_TRIP   = 10_000
_MAX_DISTANCE_KM       = 2_000
_MAX_AVG_SPEED_KMH     = 250
_MAX_HARD_BRAKES       = 500
_RISK_MULTIPLIER_RANGE = (0.5, 3.0)

def _validate_plausibility(dto: SaveTripIn) -> None:
    if dto.avg_score is not None and not (0.0 <= dto.avg_score <= 100.0):
        raise HTTPException(422, f"avg_score={dto.avg_score} — must be in [0, 100]")
    if dto.points is not None and dto.points > _MAX_POINTS_PER_TRIP:
        raise HTTPException(422, f"points={dto.points} — implausible (max {_MAX_POINTS_PER_TRIP})")
    if dto.distance_km is not None and dto.distance_km > _MAX_DISTANCE_KM:
        raise HTTPException(422, f"distance_km={dto.distance_km} — implausible")
    if dto.hard_brakes is not None and dto.hard_brakes > _MAX_HARD_BRAKES:
        raise HTTPException(422, f"hard_brakes={dto.hard_brakes} — implausible")
    if dto.risk_multiplier is not None:
        lo, hi = _RISK_MULTIPLIER_RANGE
        if not (lo <= dto.risk_multiplier <= hi):
            raise HTTPException(422, f"risk_multiplier={dto.risk_multiplier} — out of [{lo}, {hi}]")
    if dto.distance_km and dto.duration_seconds:
        avg_speed = dto.distance_km / max(dto.duration_seconds / 3600, 0.001)
        if avg_speed > _MAX_AVG_SPEED_KMH:
            raise HTTPException(422, f"avg_speed={avg_speed:.1f} km/h — implausible")
```

Call at the top of `save()`, right after the idempotency fast-path.

**Acceptance criteria:** `pytest tests/test_plausibility.py` — 8 edge-case tests (score > 100, points > 10k, implausible speed, etc.). All 8 return HTTP 422.

---

#### `[SEAN-P0-3]` HMAC Signature Verification with Sprint-1 `ph:` Bypass
> **`[P0 — CURRENT SPRINT / DEMO TARGET]`**
> **Blocked by:** SEAN-P0-1 — `payload_signature` must be wired in first
> **Files:** `server/app/services/trips.py` + `server/app/config.py`

**Add to `config.py`:**
```python
trip_signing_secret: str = Field(default="", min_length=0)
# Empty = unenforced. Set this env var in staging/production only.
```

**`_verify_signature()` in `trips.py`:**
```python
import hmac as _hmac, hashlib, json

def _verify_signature(digest: dict | None, signature: str | None, secret: str) -> None:
    if not signature:
        return
    if signature.startswith("ph:"):
        audit("trips.signature.bypass", reason="ph-placeholder-sprint1")
        return
    if not secret:
        return
    if digest is None:
        raise HTTPException(403, "payloadSignature sent but telemetryDigest is missing")
    canonical = json.dumps(digest, sort_keys=True, separators=(",", ":"))
    expected = _hmac.new(
        secret.encode(), f"{secret}:{canonical}".encode(), hashlib.sha256
    ).hexdigest()
    if not _hmac.compare_digest(expected, signature):
        audit("trips.signature.rejected", reason="digest-mismatch")
        raise HTTPException(403, "Invalid payload signature")
```

Wire into `save()` after `_validate_plausibility()`.

**Acceptance criteria:** With `TRIP_SIGNING_SECRET` set: forged non-`ph:` signature → HTTP 403. `ph:`-prefixed signature → HTTP 201 + audit log line.

---

#### `[SEAN-P1-1]` Save Raw Trip Events to the `events` Table
> **`[P1 — NEXT SPRINT]`**
> **File:** `server/app/services/trips.py`

```python
if dto.events:
    valid_types = {e.value for e in EventType}
    event_rows = [
        Event(
            trip_id=trip.id,
            type=EventType[str(raw.get("type","")).upper()],
            severity=float(raw.get("severity", 1.0)),
            timestamp=raw.get("timestamp"),
            lat=raw.get("lat"),
            lng=raw.get("lng"),
            sensor_data={"speedKmh": raw.get("speedKmh"), "accelMagnitude": raw.get("accelMagnitude")},
        )
        for raw in dto.events
        if str(raw.get("type","")).upper() in valid_types
    ]
    if event_rows:
        db.add_all(event_rows)
```

**Acceptance criteria:** `POST /api/trips` with `events: [{type: "HARD_BRAKE", severity: 0.8}]` → `SELECT COUNT(*) FROM events WHERE trip_id = '<new_trip_id>'` returns `1`.

---

#### `[SEAN-P1-2]` Recalculate and Save User Level After Every Trip
> **`[P1 — NEXT SPRINT]`**
> **Blocked by:** NAVEH-P1-1 (`points_to_level()` must exist first)

```python
from app.services.levels import points_to_level

new_level = points_to_level(user.total_points)
if new_level != user.level:
    await db.execute(update(User).where(User.id == user.id).values(level=new_level))
    await db.commit()
    audit("user.level_up", user_id=user.id, from_level=user.level, to_level=new_level)
```

**Acceptance criteria:** User with 950 total points completes a 60-point trip → `SELECT level FROM users` returns `2`.

---

#### `[SEAN-P1-3]` Per-User Daily Trip Cap (20 trips/day)
> **`[P1 — NEXT SPRINT]`**

```python
_MAX_TRIPS_PER_DAY = 20

async def _check_daily_limit(db: AsyncSession, user_id: str) -> None:
    count = await db.scalar(
        select(func.count(Trip.id))
        .where(Trip.user_id == user_id)
        .where(func.date(Trip.created_at) == date.today())
    ) or 0
    if count >= _MAX_TRIPS_PER_DAY:
        raise HTTPException(429, f"Daily trip limit ({_MAX_TRIPS_PER_DAY}) reached")
```

---

#### `[SEAN-P2-1]` JWT — Move to RS256 with Key Rotation and 1-Hour Expiry
> **`[P2 — BACKLOG]`** Not needed for the demo. Schedule for post-launch.

---

### 🟨 DAN — CTO / SDK / ML

---

#### `[DAN-P0-1]` End-to-End Integration Test Before Demo Day
> **`[P0 — CURRENT SPRINT / DEMO TARGET]`**
> **When to run:** After Sean and Naveh have closed all their P0 items

**15-minute manual verification protocol:**

```
SETUP:
  Set USE_REAL_SERVER=true in the simulator config.
  Point BASE_URL at the local server IP.

SIMULATE A TRIP:
  1. Call simulateBluetoothConnection() — SDK enters validation phase.
  2. Feed speed above 10 km/h for 30 seconds — Rule 1 fires, trip starts scoring.
  3. Call debugAddDistance(5.0) to accumulate realistic distance.
  4. Trigger 3 HARD_BRAKE events.
  5. Call stopTrip() → processEndTrip() → SyncManager.enqueue() → flushQueue().

VERIFY IN THE DATABASE:
  SELECT points, total_points, level FROM users WHERE id = '<test_user_id>';
  SELECT telemetry_digest, payload_signature FROM trips ORDER BY created_at DESC LIMIT 1;
  SELECT COUNT(*) FROM events WHERE trip_id = '<last_trip_id>';

VERIFY REJECTION:
  POST /api/trips with { "points": 99999 } → expect HTTP 422
  POST /api/trips with { "avgScore": 150 }  → expect HTTP 422
```

---

#### `[DAN-P1-1]` Replace `ph:` Placeholder with Real `expo-crypto` Signing
> **`[P1 — NEXT SPRINT]`**
> **File:** `mobile/src/context/AppContext.tsx:74`
> **Requires:** Sean removes the `ph:` bypass branch from `_verify_signature()` at the same time

```typescript
import * as Crypto from 'expo-crypto';

async function signTelemetryDigest(digest: TelemetryDigest, key: string): Promise<string> {
  const canonical = JSON.stringify(digest, Object.keys(digest).sort());
  return Crypto.digestStringAsync(
    Crypto.CryptoAlgorithm.HMAC_SHA256,
    `${key}:${canonical}`,
    { key }
  );
}
```

> **Do not start until Sprint+1.** The signing key must be provisioned through a hardware-backed mechanism before this goes live. A hardcoded key with real enforcement is not safer than the current `ph:` bypass.

---

#### `[DAN-P2-1]` Android Device Attestation — Play Integrity API
> **`[P2 — BACKLOG]`** Start with `@react-native-google-play-integrity`. Research sprint only, no implementation yet.

#### `[DAN-P2-2]` iOS Device Attestation — Apple App Attest API
> **`[P2 — BACKLOG]`** Research `expo-app-attestation` path or a native module bridge.

---

### 🟪 MAI — UI/UX Developer

---

#### `[MAI-P0-1]` Fix TypeScript Type Errors in the UI Layer
> **`[P0 — CURRENT SPRINT / DEMO TARGET]`**
> **Context:** Some TypeScript errors from the recent screens refactor are currently suppressed with `// @ts-ignore` workarounds and a non-blocking tsconfig flag added in CI. These need to be properly resolved before the demo — professors may see a type-safe, clean codebase.
> **Files:** Identified in the CI commit `fix(ci): non-blocking tsc + tsconfig TODO for Mai's UI errors`

**What to do:**
1. Run `cd mobile && npx tsc --noEmit` to get the full current error list.
2. Fix each error at the source — proper type annotations, correct component prop types, resolved import types.
3. Remove any `// @ts-ignore` suppressions added as temporary workarounds.
4. Remove the `ignoreDeprecations` tsconfig bypass once the errors are clean.

**Acceptance criteria:** `npx tsc --noEmit` exits with zero errors and zero suppressions. `npm test -- --no-coverage` stays green at 125/125.

---

#### `[MAI-P0-2]` Visual Design Overhaul — Drive & Trip Dashboard Screens
> **`[P0 — CURRENT SPRINT / DEMO TARGET]`**
> **Goal:** The app needs to look polished and professional for the academic presentation. The professors will be looking at the UI as much as the backend logic.

**Screens to focus on:**

| Screen | Priority | What to Improve |
|---|---|---|
| Active Drive HUD | High | Real-time score display, current speed, event counters — must be clear and readable at a glance |
| Trip Summary | High | End-of-trip score breakdown with visual score ring, points earned, penalties breakdown |
| Trip History List | High | Clean card layout per trip — date, distance, score badge, points |
| User Profile / Level | Medium | Level badge, progress bar to next tier, total points — must feel like a proper game UI |
| Leaderboard | Medium | Clear ranking, avatar/name, score column — clean and competitive-feeling |

**Design direction:** Minimal, dark-mode-friendly, sports/fitness app aesthetic. Think Strava or Duolingo — clean cards, bold numbers, clear hierarchy. Not cluttered.

**Acceptance criteria:** A live walkthrough of the five screens looks polished enough to demo to a university audience without apology. No placeholder text, no unstyled components, no layout overflow on a standard phone screen.

---

#### `[MAI-P1-1]` Fraud Detection UI — Train Ride Blocked Notification
> **`[P1 — NEXT SPRINT]`**
> **Context:** When the client detects a train ride and calls `handleFraud()`, the user sees nothing right now. For the demo, this is a compelling moment the professors will want to see.

**What to build:**
- A clear, non-alarming notification or modal when a fraud trip is detected: e.g. *"Train detected — trip not counted"* with an icon.
- A "Detected Trips" section in history (separate from real trips) showing what was caught and why.

---

#### `[MAI-P2-1]` Onboarding Flow — First-Time User Experience
> **`[P2 — BACKLOG]`** Not needed for the demo. Design the welcome + permission request screens for post-launch.

---

## Appendix A — P0 Dependency Chain

```
     NAVEH-P0-1                       NAVEH-P0-2
  (atomic UPDATE —                 (migration 0004 —
   fixes Lost Update)               adds telemetry columns)
        │                                  │
        └──────────────┬───────────────────┘
                       │  both must land before Sean starts
                       ▼
                  SEAN-P0-1
           (wire telemetry_digest +
            payload_signature into SaveTripIn)
                       │
          ┌────────────┴────────────┐
          │                         │
          ▼                         ▼
     SEAN-P0-2                 SEAN-P0-3
  (plausibility gate)       (HMAC ph: bypass)
          │                         │
          └────────────┬────────────┘
                       │  all P0s done → Dan runs E2E
                       ▼
                  DAN-P0-1
            (E2E integration test —
             confirms full pipeline)
                       │
          ┌────────────┴────────────┐
          │                         │
          ▼                         ▼
     SEAN-P1-1                 SEAN-P1-2
   (events bulk INSERT)      (level recalc)
                                    │
                               NAVEH-P1-1
                            (Python gamification
                              level mirror)
```

---

## Appendix B — Demo Green Checklist

> Every item below must be checked off before the demo goes live.

```
  ☐ NAVEH-P0-1  — Concurrent test: 10 requests for 1 user → final points = exact sum of all deltas
  ☐ NAVEH-P0-2  — alembic upgrade head ↔ downgrade -1 ↔ upgrade head — clean round-trip
  ☐ SEAN-P0-1   — POST trip with telemetryDigest → SELECT telemetry_digest FROM trips → NOT NULL
  ☐ SEAN-P0-2   — POST { points: 99999 } → 422  |  POST { avgScore: 150 } → 422
  ☐ SEAN-P0-3   — POST { payloadSignature: "forged" } with secret configured → 403
  ☐ MAI-P0-1    — npx tsc --noEmit exits clean, zero suppressions
  ☐ MAI-P0-2    — All 5 screens reviewed live on device — polished and presentation-ready
  ☐ DAN-P0-1    — Full E2E run: trip saved, points correct, level updated, events inserted
  ☐ BASELINE    — cd mobile && npm test -- --no-coverage → 125/125 PASS, zero regressions
```

---

*Document authored: 2026-05-21 · Dan Ofri (CTO)*
*All architectural decisions from this meeting must be linked to RFC-001 §2 or recorded in a new ADR under `docs/`.*

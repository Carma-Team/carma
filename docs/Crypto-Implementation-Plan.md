# CARMA — Cryptographic & Scoring Architecture Implementation Plan
**Document:** CRYPTO-IMPL-001 | **Version:** 1.5 | **Date:** 2026-05-21
**Author:** Dan Ofri (CTO) | **References:** RFC-001 v1.5, Sprint-Execution-Plan-Demo.md
**Target Branch:** `feature/crypto-nonce-upgrade` off `develop`

---

> **Objective:** Two simultaneous upgrades delivered as a single coherent change:
>
> 1. **Cryptographic hardening** — Time-Based Nonce (millisecond Unix timestamp embedded
>    in `TelemetryDigest`) + production-grade HMAC-SHA256 replay/tamper protection.
>
> 2. **Absolute Metrics Decoupling** — The mobile client is a sensor node. It sends only
>    raw measurements. The FastAPI server is the sole scoring engine — it computes
>    `avg_score` and `points` from raw metrics after cryptographic verification.
>    No score is ever calculated or transmitted by the client.
>
> These two changes are inseparable: a signed payload carrying server-computed metrics
> is the only architecture that eliminates both score drift and data forgery simultaneously.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Layer 1 — Backend & Environment (Sean / Naveh)](#2-layer-1--backend--environment-sean--naveh)
3. [Layer 2 — Mobile Client (Dan / Mai)](#3-layer-2--mobile-client-dan--mai)
4. [Layer 3 — Zero-Regression Baseline](#4-layer-3--zero-regression-baseline)
5. [Migration Sequence & Cut-Over Protocol](#5-migration-sequence--cut-over-protocol)
6. [Acceptance Criteria](#6-acceptance-criteria)

---

## 1. Architecture Overview

### 1.1 End-to-End Data Flow

```
MOBILE CLIENT (Sensor Node)                   FASTAPI SERVER (Scoring Oracle)
───────────────────────────                   ──────────────────────────────
1. CarmaDrivingSDK collects raw events        5. _validate_plausibility(dto)
   (IMU + GPS → event counts, distance)          → HTTP 422 if physics violation

2. buildTelemetryDigest():                    6. _check_timestamp_drift(digest)
   { distanceKm, durationSeconds,                → HTTP 401 if |drift| > 5 min
     hardBrakes, aggressiveAccels,
     sharpTurns, phoneSeconds,                7. _verify_signature(digest, sig, secret)
     riskMultiplier, startTime,                  → HTTP 403 if HMAC mismatch
     endTime, timestamp=Date.now() }
                                              8. calculate_score(raw metrics)
3. signature = HMAC-SHA256(secret, JSON)         → avg_score, points, risk_multiplier
   (ph: prefix during current sprint)            ← THE ONLY SCORING CALL IN THE SYSTEM

4. POST /api/trips                            9. Atomic UPDATE user.points (Lost Update prevention)
   body.telemetryDigest = digest
   body.payloadSignature = signature         10. Persist Trip row with server-computed
                                                 avg_score + points + telemetry_digest

                                             11. TripOut { avg_score, points, ... } → client
                                                 Client displays score FROM SERVER RESPONSE
                                                 (not a locally calculated value)
```

### 1.2 What the HUD Shows (v1.5)

| During Active Trip | After Trip Completes |
|---|---|
| Current speed (GPS raw) | Server-returned `avg_score` |
| Elapsed distance (GPS accumulated) | Server-returned `points` |
| Elapsed time | Trip stored in history |
| Raw event toasts (hard brake, sharp turn…) | |
| ~~0–100 score~~ **REMOVED** | |
| ~~"X points earned"~~ **REMOVED** | |

### 1.3 Threat Mitigation Map

| Attack | How It Is Blocked |
|--------|-------------------|
| **Replay** — resend a captured valid request later | `timestamp` nonce inside signed digest expires after ±5 min → HTTP 401 |
| **Tampering** — modify raw metrics in transit | HMAC over canonical digest — any field change → mismatch → HTTP 403 |
| **Score forgery** — send inflated `avg_score` or `points` | Server ignores client-sent score/points; always recomputes from raw metrics |
| **Physics forgery** — inflate `distanceKm` or event counts | Plausibility gate checks speed, distance, duration maximums → HTTP 422 |
| **Replay with new idempotency key** | Timestamp drift window closes the reuse window |

### 1.4 Secret Management Tiers

| Environment | Secret Source | Rotation |
|-------------|---------------|----------|
| Local dev | `./server/.env` — `TRIP_SIGNING_SECRET=<hex>` | Manual, per-developer |
| CI | GitHub Actions secret `TRIP_SIGNING_SECRET` | Rotated quarterly |
| Production (Azure) | Azure Key Vault — `carma-trip-signing-secret` | Automated 90-day rotation |

**Minimum secret length:** 32 bytes (64 hex characters):
```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

---

## 2. Layer 1 — Backend & Environment (Sean / Naveh)

**Owner:** Sean (service + scoring logic) + Naveh (environment / Key Vault)
**Branch:** `feature/sean-crypto-scoring` off `develop`
**Files:**
- `server/app/services/trips.py` — gate ordering + scoring call
- `server/app/services/scoring.py` — new file, sole scoring engine
- `server/app/config.py` — secret validation
- `server/.env.example` — documentation

### 2.1 New File — `server/app/services/scoring.py`

This is the only location in the entire system where the scoring formula lives.
It must be a byte-for-byte port of `mobile/src/lib/scoring.ts`.

```python
"""
CARMA Trip Scoring Engine
=========================
This module is the single authoritative source for scoring calculations.
Any change to the formula requires a versioned RFC-001 amendment.

Port of: mobile/src/lib/scoring.ts
"""
import math
from datetime import datetime


def get_risk_multiplier(start_time: datetime) -> float:
    """
    Returns the time-of-day/day-of-week risk multiplier.
    Mirrors getRiskMultiplier() in mobile/src/lib/scoring.ts.

    Weekday mapping (Python datetime.weekday()):
        Mon=0, Tue=1, Wed=2, Thu=3, Fri=4, Sat=5, Sun=6
    Israeli weekend nights (Thu, Fri, Sat) → multiplier 2.0
    Other nights (23:00–03:59) → multiplier 1.5
    Daytime → multiplier 1.0
    """
    hour = start_time.hour
    weekday = start_time.weekday()
    is_night = hour >= 23 or hour < 4
    if not is_night:
        return 1.0
    is_weekend_night = weekday in (3, 4, 5)  # Thu, Fri, Sat
    return 2.0 if is_weekend_night else 1.5


def calculate_score(
    hard_brakes:       int,
    aggressive_accels: int,
    sharp_turns:       int,
    phone_seconds:     int,
    duration_seconds:  int,
    distance_km:       float,
    start_time:        datetime,
) -> tuple[float, float, float]:
    """
    Compute (avg_score, points, risk_multiplier) from raw trip metrics.

    Formula (must match scoring.ts exactly):
        penalties = hardBrakes*5 + aggressiveAccels*3 + sharpTurns*2
                    + (phoneSeconds / safeDuration) * 40
        score     = clamp(100 - penalties, 0, 100)
        factor    = log(distanceKm + 1) / log(11)
        points    = score * factor * riskMultiplier

    Returns values rounded to 1 decimal place.
    """
    safe_duration = max(duration_seconds, 1)
    penalties = (
        hard_brakes * 5
        + aggressive_accels * 3
        + sharp_turns * 2
        + (phone_seconds / safe_duration) * 40
    )
    score = max(0.0, min(100.0, 100.0 - penalties))
    distance_factor = math.log(distance_km + 1) / math.log(11)
    risk_multiplier = get_risk_multiplier(start_time)
    points = score * distance_factor * risk_multiplier

    return (
        round(score * 10) / 10,
        round(points * 10) / 10,
        risk_multiplier,
    )
```

### 2.2 Updated `server/app/services/trips.py` — Gate Ordering + Scoring Integration

Replace the current `save()` body with this execution order. The three security gates
run before scoring; scoring runs before persistence.

```python
from app.services.scoring import calculate_score

async def save(db, user, dto, idempotency_key=None):
    # ── 1. Idempotency fast-path (unchanged) ──────────────────────────────────
    if idempotency_key:
        existing = await db.scalar(...)
        if existing:
            return TripOut.from_orm_trip(existing)

    # ── 2. Physics plausibility gate → HTTP 422 ───────────────────────────────
    _validate_plausibility(dto)

    # ── 3. Timestamp drift gate → HTTP 401 ────────────────────────────────────
    _check_timestamp_drift(dto.telemetry_digest)

    # ── 4. HMAC integrity gate → HTTP 403 ────────────────────────────────────
    _verify_signature(dto.telemetry_digest, dto.payload_signature, settings.trip_signing_secret)

    # ── 5. Server-side scoring (sole score engine) ────────────────────────────
    start = dto.start_time or datetime.now(UTC)
    avg_score, points, risk_mul = calculate_score(
        hard_brakes       = dto.hard_brakes or 0,
        aggressive_accels = dto.aggressive_accels or 0,
        sharp_turns       = dto.sharp_turns or 0,
        phone_seconds     = dto.phone_seconds or 0,
        duration_seconds  = dto.duration_seconds or 0,
        distance_km       = dto.distance_km or 0.0,
        start_time        = start,
    )
    # dto.avg_score and dto.points are IGNORED — server values are authoritative.

    # ── 6. Persist ────────────────────────────────────────────────────────────
    trip = Trip(
        ...
        avg_score       = avg_score,    # server-computed
        points          = points,       # server-computed
        risk_multiplier = risk_mul,     # server-computed
        ...
    )
    ...
```

### 2.3 Timestamp Drift Check — `_check_timestamp_drift()`

```python
import time

_REPLAY_WINDOW_MS = 5 * 60 * 1000  # 300 000 ms — ±5 minutes

def _check_timestamp_drift(digest: dict | None) -> None:
    if digest is None:
        return
    ts = digest.get("timestamp")
    if ts is None:
        return  # unsigned legacy payload — plausibility gate is the only backstop
    now_ms = int(time.time() * 1000)
    drift = abs(now_ms - int(ts))
    if drift > _REPLAY_WINDOW_MS:
        audit("trips.signature.replay", ts=ts, now_ms=now_ms, drift_ms=drift)
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            f"Timestamp outside ±5-minute window (drift={drift // 1000}s) — replay rejected",
        )
```

### 2.4 HMAC Integrity Check — `_verify_signature()`

The canonical HMAC message is the stable JSON of the full digest (timestamp is inside it
naturally). The secret is the HMAC *key*, not prepended to the message.

```python
def _verify_signature(digest: dict | None, signature: str | None, secret: str) -> None:
    if not signature:
        return
    if signature.startswith("ph:"):
        audit("trips.signature.bypass", reason="ph-placeholder-sprint1")
        return
    if not secret:
        return
    if digest is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "payloadSignature present but telemetryDigest is absent")
    canonical = json.dumps(digest, sort_keys=True, separators=(",", ":"))
    expected = _hmac.new(secret.encode(), canonical.encode(), hashlib.sha256).hexdigest()
    if not _hmac.compare_digest(expected, signature):
        audit("trips.signature.rejected", reason="hmac-mismatch")
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Invalid payload signature")
```

### 2.5 Environment Variable

```python
# server/app/config.py — current state:
trip_signing_secret: str = Field(default="", min_length=0)
# Sprint+1: change min_length=32 once Key Vault is wired.
```

```dotenv
# server/.env.example
# Generate: python -c "import secrets; print(secrets.token_hex(32))"
# Empty = signing unenforced (dev only — NEVER deploy empty to Azure production).
TRIP_SIGNING_SECRET=
```

### 2.6 Server-Side Tests to Add (`server/tests/test_scoring.py`)

```python
import pytest
from datetime import datetime, timezone
from app.services.scoring import calculate_score, get_risk_multiplier

# Parity test vectors — must match scoring.ts output for identical inputs.
# See RFC-001 §8.3 for the full table.

def test_clean_trip_daytime():
    score, points, rm = calculate_score(0, 0, 0, 0, 1800, 15.0,
                                        datetime(2026, 5, 19, 14, 0, tzinfo=timezone.utc))
    assert score == 100.0
    assert rm == 1.0

def test_mixed_events_weekday():
    score, points, rm = calculate_score(3, 2, 1, 60, 600, 5.0,
                                        datetime(2026, 5, 18, 10, 0, tzinfo=timezone.utc))
    assert score == 73.0
    assert rm == 1.0

def test_score_floor_at_zero():
    score, points, rm = calculate_score(10, 5, 3, 300, 900, 8.0,
                                        datetime(2026, 5, 23, 23, 30, tzinfo=timezone.utc))
    assert score == 0.0
    assert points == 0.0

def test_weekend_night_multiplier_2x():
    # Thu night (weekday=3) → 2.0
    _, _, rm = calculate_score(0, 0, 0, 0, 3600, 10.0,
                               datetime(2026, 5, 21, 23, 0, tzinfo=timezone.utc))
    assert rm == 2.0

def test_weekday_night_multiplier_1_5x():
    # Mon night (weekday=0) → 1.5
    _, _, rm = calculate_score(0, 0, 0, 0, 3600, 10.0,
                               datetime(2026, 5, 18, 2, 0, tzinfo=timezone.utc))
    assert rm == 1.5
```

---

## 3. Layer 2 — Mobile Client (Dan / Mai)

**Owner:** Dan (crypto + TelemetryDigest) + Mai (HUD redesign + error surfaces)
**Branch:** `feature/dan-crypto-timestamp` off `develop`
**Files:**
- `mobile/src/services/sync/types.ts` — `TelemetryDigest` interface update
- `mobile/src/context/AppContext.tsx` — `buildTelemetryDigest()` + `signTelemetryDigest()`
- Active trip HUD screen/components — score display removal

**Hard boundaries:**
- Zero changes inside `mobile/src/lib/driving-sdk/`
- `mobile/src/lib/scoring.ts` is kept for unit-test reference only — not called at runtime

### 3.1 Dependency — `@noble/hashes` (Sprint+1)

```bash
cd mobile && npm install @noble/hashes
```

Zero-dependency, audited, pure-TypeScript HMAC library. Runs natively in Hermes without
any native module bridge. Required for Sprint+1 when `ph:` bypass is retired.

### 3.2 Updated `TelemetryDigest` Interface

```typescript
// mobile/src/services/sync/types.ts

export interface TelemetryDigest {
  // ── Raw sensor metrics — client measures, server scores ───────────────────
  distanceKm:       number;   // GPS-accumulated km, 3 decimal places
  durationSeconds:  number;   // elapsed seconds from startTime to endTime
  hardBrakes:       number;   // IMU hard-braking event count
  aggressiveAccels: number;   // IMU aggressive-acceleration event count
  sharpTurns:       number;   // IMU sharp-turn event count
  phoneSeconds:     number;   // seconds with phone screen active, rounded
  riskMultiplier:   number;   // time-of-day factor sent for audit; server recomputes independently
  startTime:        string;   // ISO 8601 UTC — used by server to verify riskMultiplier
  endTime:          string;   // ISO 8601 UTC
  // ── Cryptographic nonce (v1.4) ────────────────────────────────────────────
  timestamp:        number;   // Date.now() at signing time — millisecond Unix epoch

  // Fields REMOVED in v1.5 (now server-computed):
  //   avgScore  → server/app/services/scoring.py:calculate_score()
  //   points    → server/app/services/scoring.py:calculate_score()
}
```

### 3.3 Updated `buildTelemetryDigest()`

```typescript
// mobile/src/context/AppContext.tsx

function buildTelemetryDigest(tripData: TripData): TelemetryDigest {
  return {
    distanceKm:       Math.round(tripData.distanceKm * 1000) / 1000,
    durationSeconds:  tripData.durationSeconds,
    hardBrakes:       tripData.hardBrakes,
    aggressiveAccels: tripData.aggressiveAccels,
    sharpTurns:       tripData.sharpTurns,
    phoneSeconds:     Math.round(tripData.phoneSeconds),
    riskMultiplier:   getRiskMultiplier(tripData.startTime),  // audit field
    startTime:        tripData.startTime.toISOString(),
    endTime:          tripData.endTime.toISOString(),
    timestamp:        Date.now(),  // nonce — injected last, before signing
    // avgScore and points deliberately absent — server computes them
  };
}
```

### 3.4 HMAC Signing — Current Sprint vs Sprint+1

**Current sprint** (`ph:` placeholder — server accepts without verifying):
```typescript
function signTelemetryDigest(_digest: TelemetryDigest, _secret: string): string {
  return `ph:${Math.random().toString(16).slice(2).padEnd(32, "0")}`;
}
```

**Sprint+1** (real HMAC — requires `@noble/hashes`):
```typescript
import { hmac }        from "@noble/hashes/hmac";
import { sha256 }      from "@noble/hashes/sha2";
import { utf8ToBytes, bytesToHex } from "@noble/hashes/utils";

function stableStringify(obj: Record<string, unknown>): string {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

function signTelemetryDigest(digest: TelemetryDigest, secret: string): string {
  const canonical = stableStringify(digest as unknown as Record<string, unknown>);
  const mac = hmac(sha256, utf8ToBytes(secret), utf8ToBytes(canonical));
  return bytesToHex(mac);
}
```

**`stableStringify` contract:** Keys are sorted alphabetically — must produce an
identical string to Python's `json.dumps(digest, sort_keys=True, separators=(",",":"))`.

### 3.5 HUD Redesign — Score Display Removal (Mai)

Remove the `calculateScore()` call from the active trip UI path entirely. The HUD
must display only raw sensor readings and event notifications.

```typescript
// BEFORE (v1.4 and earlier):
const { score, points } = calculateScore({ hardBrakes, ... })
// rendered in HUD: <ScoreDisplay value={score} />

// AFTER (v1.5):
// No calculateScore() call during live trip.
// HUD renders only: speed, distance, elapsed time, event toasts.

// Trip summary — wait for server response:
const result = await tripsApi.save(payload)
// result.avgScore and result.points come from the server:
setCompletedTripScore(result.avgScore)
setCompletedTripPoints(result.points)
```

### 3.6 Error Surfaces (Mai)

```typescript
// AppContext.tsx — processEndTrip() catch block
} catch (e) {
  if (e instanceof ApiError) {
    switch (e.status) {
      case 401:
        // Device clock out of sync — user-fixable
        addToast({ type: 'error', title: 'Clock Sync Error',
                   message: 'Device clock is out of sync. Please correct it and retry.' });
        break;
      case 403:
        // Integrity check failed — permanent failure, do NOT retry
        addToast({ type: 'error', title: 'Trip Rejected',
                   message: `Security check failed. Trip ID: ${localTripId}` });
        break;
      case 422:
        // Implausible payload — permanent failure
        addToast({ type: 'error', title: 'Trip Rejected', message: 'Implausible trip data.' });
        break;
      default:
        await SyncManager.enqueue(validTripPayload);  // network/5xx — retry eligible
    }
  } else {
    await SyncManager.enqueue(validTripPayload);
  }
}
```

**401/403/422 must never enter `SyncManager`.** They are permanent failures.

---

## 4. Layer 3 — Zero-Regression Baseline

**Enforced by:** CI gate — `npx tsc --noEmit` (exit 0) + `npm test` (125/125)
**Hard constraint:** Zero files modified under `mobile/src/lib/driving-sdk/`

### 4.1 Test Impact Analysis

| Test Suite | Impact | Required Action |
|------------|--------|-----------------|
| Any test constructing `TelemetryDigest` | `avgScore` and `points` fields removed | Remove those fields from all fixture objects |
| `SyncManager.test.ts` | Digest fixtures need updating | Add `timestamp: expect.any(Number)` |
| `scoring.test.ts` | `calculateScore()` still tested as pure function | No change — `scoring.ts` is kept for test reference |
| `gamification.test.ts` | No overlap with signing layer | None |
| `FraudDetector.test.ts` | No overlap with signing layer | None |
| `TripValidationManager.test.ts` | No overlap | None |

### 4.2 TypeScript Compliance

After removing `avgScore` and `points` from `TelemetryDigest`:
- All call sites that constructed `TelemetryDigest` with those fields will produce **TS2353** errors (object literal may only specify known properties)
- Running `npx tsc --noEmit` surfaces every broken call site before any test runs
- Fix each call site by removing the disallowed fields

**Do not add `avgScore?: number` as an optional field** — keeping it optional would silently
allow the old pattern to compile, defeating the architectural enforcement.

### 4.3 Runtime Regression Guard

```bash
# Run from project root before opening any PR:
cd mobile && npx tsc --noEmit && npm test -- --no-coverage
# Expected: exit 0 + "Tests: 125 passed, 125 total"
```

```bash
# Verify SDK boundary — must return empty:
git diff develop -- mobile/src/lib/driving-sdk/
```

---

## 5. Migration Sequence & Cut-Over Protocol

### 5.1 Current Sprint — Preparation (non-breaking)

All changes in this phase are backward-compatible. `ph:` bypass remains active.

| Step | Owner | Task | Gate |
|------|-------|------|------|
| 1 | Dan | Remove `avgScore` and `points` from `TelemetryDigest` interface | `tsc --noEmit` exits clean |
| 2 | Dan | Update `buildTelemetryDigest()` — no score fields, inject `timestamp` | Fixtures updated, 125/125 |
| 3 | Sean | Create `server/app/services/scoring.py` with `calculate_score()` | Parity tests pass (§2.6) |
| 4 | Sean | Wire `calculate_score()` into `trips.save()` — ignore client score/points | Integration test: server-computed score in DB |
| 5 | Sean | Add `_check_timestamp_drift()` to `trips.py` | Unit test: drift > 300s → 401 |
| 6 | Sean | Update `_verify_signature()` — canonical message only, no `secret:` prefix | Unit test: HMAC verify |
| 7 | Mai | Remove score render from active trip HUD | Visual review — no 0–100 visible |
| 8 | Mai | Add 401/403 error surfaces to `processEndTrip()` | Code review |
| 9 | Naveh | Document `TRIP_SIGNING_SECRET` in `.env.example` | PR review |

### 5.2 Sprint+1 — Production Enforcement (coordinated deploy)

**Server must deploy first.** A `ph:`-tolerant server safely accepts real-HMAC clients.
A strict server will reject all `ph:` clients still in the wild if deployed in reverse order.

| Step | Owner | Task |
|------|-------|------|
| 10 | Dan | Install `@noble/hashes`, implement real `signTelemetryDigest()` |
| 11 | Dan | Remove `ph:` branch from `signTelemetryDigest()` |
| 12 | Sean | Remove `ph:` bypass from `_verify_signature()` |
| 13 | Sean | Set `trip_signing_secret` `min_length=32` in `config.py` |
| 14 | Naveh | Provision `TRIP_SIGNING_SECRET` in Azure Key Vault, rotate quarterly |
| 15 | All | Deploy server → push app update to store |

### 5.3 Rollback Plan

If 403s appear unexpectedly after Step 12:
1. **Server:** Re-enable `ph:` bypass (one-line revert, < 5-minute deploy)
2. **Client:** No rollback needed — real HMAC is always accepted by `ph:`-tolerant server
3. **Root cause:** Verify `TRIP_SIGNING_SECRET` is identical across all server instances

---

## 6. Acceptance Criteria

### Current Sprint Gate

```
Scoring Decoupling
  ☐  server/app/services/scoring.py created with calculate_score()
  ☐  All 5 parity test vectors pass (RFC-001 §8.3)
  ☐  trips.save() uses server-computed avg_score/points (dto values ignored)
  ☐  avgScore and points removed from TelemetryDigest interface
  ☐  Active trip HUD: no 0–100 score rendered anywhere during live trip
  ☐  Post-trip summary: score and points come from POST /api/trips response body

Cryptographic Preparation
  ☐  timestamp field present in TelemetryDigest and injected via Date.now()
  ☐  _check_timestamp_drift() present in trips.py (ts=None → pass through)
  ☐  _verify_signature() uses canonical JSON as message (no secret: prefix)
  ☐  TRIP_SIGNING_SECRET documented in .env.example

Baseline
  ☐  npx tsc --noEmit → exit 0, zero type errors
  ☐  npm test -- --no-coverage → 125/125 PASS
  ☐  git diff develop -- mobile/src/lib/driving-sdk/ → empty
```

### Sprint+1 Enforcement Gate

```
Cryptographic Enforcement
  ☐  _check_timestamp_drift: drift=299 999 ms → HTTP 200
  ☐  _check_timestamp_drift: drift=300 001 ms → HTTP 401
  ☐  _verify_signature: correct HMAC  → HTTP 200
  ☐  _verify_signature: tampered field → HTTP 403
  ☐  ph: bypass removed from both client and server
  ☐  TRIP_SIGNING_SECRET min_length=32 enforced in config.py

Client Hardening
  ☐  @noble/hashes installed and used for HMAC
  ☐  stableStringify key-sort parity verified against Python json.dumps(sort_keys=True)
  ☐  401 → clock-sync toast, no SyncManager.enqueue()
  ☐  403 → integrity-failure toast with trip_id, no SyncManager.enqueue()
  ☐  422 → implausible-data toast, no SyncManager.enqueue()
```

---

*CRYPTO-IMPL-001 v1.5 | Author: Dan Ofri (CTO) | 2026-05-21*
*Cross-references: RFC-001 v1.5 §7–§8, Sprint-Execution-Plan-Demo.md §5*

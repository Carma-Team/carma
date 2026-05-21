# CARMA — Cryptographic Upgrade Implementation Plan
**Document:** CRYPTO-IMPL-001 | **Version:** 1.0 | **Date:** 2026-05-21
**Author:** Dan Ofri (CTO) | **References:** RFC-001 v1.4, Sprint-Execution-Plan-Demo.md
**Target Branch:** `feature/crypto-nonce-upgrade` off `develop`

---

> **Objective:** Harden the Hybrid Validation pipeline against Replay Attacks and Data
> Tampering by implementing a Time-Based Nonce (millisecond Unix timestamp embedded in
> `TelemetryDigest`) combined with a production-grade HMAC-SHA256 signature loop.
> The `ph:` placeholder introduced in Sprint 1 must be fully retired by Sprint+1.

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

### 1.1 Signing Flow (end-to-end)

```
MOBILE CLIENT                               FASTAPI SERVER
─────────────                               ──────────────
1. Build TelemetryDigest                    4. _validate_plausibility()
   (metrics + timestamp = Date.now())          → 422 if physics violation

2. canonical = stableJSON(digest)           5. _check_timestamp_drift(digest)
   signature = HMAC-SHA256(secret, canonical)  → 401 if |drift| > 5 min

3. POST /api/trips                          6. _verify_signature(digest, sig, secret)
   body.telemetryDigest = digest               → 403 if HMAC mismatch
   body.payloadSignature = signature
                                            7. Atomic UPDATE user points
                                            8. Persist trip + telemetry_digest to DB
```

### 1.2 Threat Mitigation Map

| Attack | How It Is Blocked |
|--------|-------------------|
| **Replay** — resend a captured valid request | `timestamp` inside the signed digest expires after ±5 min (HTTP 401) |
| **Tampering** — modify `points` or `distanceKm` in transit | HMAC recomputed over canonical digest — any bit flip → mismatch (HTTP 403) |
| **Forgery** — construct a fake payload from scratch | Attacker does not have `TRIP_SIGNING_SECRET`; all unsigned payloads are accepted at plausibility level only until `ph:` is retired |
| **Score inflation** — inflate `points` field | Plausibility gate (existing, HTTP 422) + HMAC (Layer 1) |

### 1.3 Secret Management Tiers

| Environment | Secret Source | Rotation |
|-------------|---------------|----------|
| Local dev (`ENV=development`) | `./server/.env` — `TRIP_SIGNING_SECRET=<hex>` | Manual, per-developer |
| CI | GitHub Actions secret `TRIP_SIGNING_SECRET` | Rotated quarterly |
| Production (Azure) | Azure Key Vault secret `carma-trip-signing-secret` | Automated 90-day rotation |

**Minimum secret length:** 32 bytes (64 hex characters). Generate with:
```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

---

## 2. Layer 1 — Backend & Environment (Sean / Naveh)

**Owner:** Sean (service logic) + Naveh (environment / Key Vault wiring)
**Branch:** `feature/sean-crypto-drift-verify` off `develop`
**Files:** `server/app/services/trips.py`, `server/app/config.py`, `server/.env.example`

### 2.1 Environment Variable

Ensure `TRIP_SIGNING_SECRET` is documented and enforced. The current default is an
empty string (signing disabled). This is acceptable for demo-day; it must not reach
Azure production with an empty value.

```python
# server/app/config.py — already present, verify min_length comment:
trip_signing_secret: str = Field(default="", min_length=0)
# TODO Sprint+1: change min_length=32 and remove default once Key Vault is wired.
```

Add to `server/.env.example`:

```dotenv
# Minimum 32 bytes (64 hex chars). Generate: python -c "import secrets; print(secrets.token_hex(32))"
# Empty string = signing unenforced (development only — NEVER deploy empty to production).
TRIP_SIGNING_SECRET=
```

### 2.2 Timestamp Drift Check — Replay Prevention (HTTP 401)

Add `_check_timestamp_drift()` to `server/app/services/trips.py` **above**
`_verify_signature()`. The `timestamp` field is read directly from `dto.telemetry_digest`
(the raw JSONB dict stored without modification).

```python
import time

_REPLAY_WINDOW_MS = 5 * 60 * 1000  # 300 000 ms — ±5 minutes

def _check_timestamp_drift(digest: dict | None) -> None:
    if digest is None:
        return
    ts = digest.get("timestamp")
    if ts is None:
        return  # unsigned legacy payload — passes through; plausibility gate is sole backstop
    now_ms = int(time.time() * 1000)
    drift = abs(now_ms - int(ts))
    if drift > _REPLAY_WINDOW_MS:
        audit("trips.signature.replay", ts=ts, now_ms=now_ms, drift_ms=drift)
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            f"Timestamp outside ±5-minute window (drift={drift // 1000}s) — replay rejected",
        )
```

**Why HTTP 401, not 422:** A stale timestamp is an authentication-layer failure (the
credential — the signed timestamp — is expired), not a semantic validation failure.
RFC-7235 semantics: 401 = "unauthenticated or credential expired."

### 2.3 HMAC Integrity Check — Tamper Prevention (HTTP 403)

Replace the current `_verify_signature()` body in `server/app/services/trips.py`.
The critical change from v1.3: the HMAC *message* is now `canonical` alone (not
`f"{secret}:{canonical}"`). The secret is the HMAC *key* exclusively.

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
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "payloadSignature present but telemetryDigest is absent",
        )
    canonical = json.dumps(digest, sort_keys=True, separators=(",", ":"))
    expected = _hmac.new(
        secret.encode(),
        canonical.encode(),          # message = full canonical JSON (timestamp is inside)
        hashlib.sha256,
    ).hexdigest()
    if not _hmac.compare_digest(expected, signature):
        audit("trips.signature.rejected", reason="hmac-mismatch")
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Invalid payload signature")
```

### 2.4 Call-Site Ordering in `save()`

The three gates must execute in strict order inside `trips.save()`:

```python
async def save(db, user, dto, idempotency_key=None):
    # 1. Fast-path deduplication (unchanged)
    if idempotency_key:
        ...

    # 2. Physics plausibility — reject impossible payloads
    _validate_plausibility(dto)

    # 3. Replay protection — reject stale timestamps (HTTP 401)
    _check_timestamp_drift(dto.telemetry_digest)

    # 4. Integrity check — reject tampered payloads (HTTP 403)
    _verify_signature(dto.telemetry_digest, dto.payload_signature, settings.trip_signing_secret)

    # 5. Persist (unchanged)
    ...
```

**Order is load-bearing.** Plausibility runs first because it is computationally free
and eliminates trivially invalid payloads before cryptographic work begins.

### 2.5 Server-Side Tests to Add

Add to `server/tests/` (pytest-asyncio):

```python
# test_trips_crypto.py

async def test_drift_within_window_passes(client, auth_headers):
    payload = build_signed_payload(ts_offset_ms=0)
    r = await client.post("/api/trips", json=payload, headers=auth_headers)
    assert r.status_code == 201

async def test_drift_at_boundary_passes(client, auth_headers):
    payload = build_signed_payload(ts_offset_ms=299_999)
    r = await client.post("/api/trips", json=payload, headers=auth_headers)
    assert r.status_code == 201

async def test_drift_over_window_rejects_401(client, auth_headers):
    payload = build_signed_payload(ts_offset_ms=300_001)
    r = await client.post("/api/trips", json=payload, headers=auth_headers)
    assert r.status_code == 401

async def test_tampered_digest_rejects_403(client, auth_headers):
    payload = build_signed_payload(ts_offset_ms=0)
    payload["telemetryDigest"]["points"] += 1_000   # tamper after signing
    r = await client.post("/api/trips", json=payload, headers=auth_headers)
    assert r.status_code == 403

async def test_ph_prefix_still_bypasses(client, auth_headers):
    payload = build_payload_with_ph_sig()
    r = await client.post("/api/trips", json=payload, headers=auth_headers)
    assert r.status_code == 201
```

---

## 3. Layer 2 — Mobile Client (Dan / Mai)

**Owner:** Dan (crypto logic) + Mai (error surface / toast UX)
**Branch:** `feature/dan-crypto-timestamp` off `develop`
**Files:** `mobile/src/services/sync/types.ts`, `mobile/src/context/AppContext.tsx`
**SDK Boundary:** Zero changes inside `mobile/src/lib/driving-sdk/` — this layer is
strictly in `src/context/` and `src/services/`.

### 3.1 Dependency — `@noble/hashes`

```bash
cd mobile && npm install @noble/hashes
```

`@noble/hashes` (Paul Miller, MIT) is a zero-dependency, audited, tree-shakeable
TypeScript cryptography library. It runs natively in the Hermes JS engine without
any native module bridge.

**Do not use:**
- `crypto-js` — outdated API, not tree-shakeable, 43 kB gzip
- `expo-crypto` — does not expose HMAC (SHA only, no key parameter)
- Any native module that would require changes inside `driving-sdk/`

### 3.2 Type Extension — `TelemetryDigest`

```typescript
// mobile/src/services/sync/types.ts

export interface TelemetryDigest {
  avgScore:         number;
  points:           number;
  distanceKm:       number;
  durationSeconds:  number;
  hardBrakes:       number;
  aggressiveAccels: number;
  sharpTurns:       number;
  phoneSeconds:     number;
  riskMultiplier:   number;
  startTime:        string;  // ISO 8601 UTC
  endTime:          string;  // ISO 8601 UTC
  timestamp:        number;  // [v1.4] millisecond Unix epoch — Date.now() at signing time
}
```

### 3.3 Signing Implementation — `AppContext.tsx`

Two functions must be updated. `buildTelemetryDigest` injects `timestamp`; `signTelemetryDigest`
computes the HMAC using `@noble/hashes`.

```typescript
import { hmac }        from "@noble/hashes/hmac";
import { sha256 }      from "@noble/hashes/sha2";
import { utf8ToBytes, bytesToHex } from "@noble/hashes/utils";

// Deterministic JSON serialisation — keys sorted alphabetically.
function stableStringify(obj: Record<string, unknown>): string {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

function buildTelemetryDigest(tripData: TripData, secret: string): TelemetryDigest {
  const digest: TelemetryDigest = {
    avgScore:         Math.round(tripData.score * 10) / 10,
    points:           tripData.points,
    distanceKm:       Math.round(tripData.distanceKm * 1000) / 1000,
    durationSeconds:  tripData.durationSeconds,
    hardBrakes:       tripData.hardBrakes,
    aggressiveAccels: tripData.aggressiveAccels,
    sharpTurns:       tripData.sharpTurns,
    phoneSeconds:     Math.round(tripData.phoneSeconds),
    riskMultiplier:   tripData.riskMultiplier,
    startTime:        tripData.startTime.toISOString(),
    endTime:          tripData.endTime.toISOString(),
    timestamp:        Date.now(),  // injected last — becomes part of the signed message
  };
  return digest;
}

function signTelemetryDigest(digest: TelemetryDigest, secret: string): string {
  if (!secret || secret.startsWith("ph:")) {
    // Sprint 1 placeholder — server accepts ph: prefix without HMAC verification
    return `ph:${Math.random().toString(16).slice(2).padEnd(32, "0")}`;
  }
  const canonical = stableStringify(digest as unknown as Record<string, unknown>);
  const mac = hmac(sha256, utf8ToBytes(secret), utf8ToBytes(canonical));
  return bytesToHex(mac);
}
```

**`stableStringify` contract:** The key-sort order used on the client must produce an
identical string to Python's `json.dumps(digest, sort_keys=True, separators=(",",":"))`.
Both sort alphabetically. The test suite in Layer 3 must include a cross-language
parity check.

### 3.4 Secret Distribution (Sprint+1)

During the current sprint, `TRIP_SIGNING_SECRET` may be hardcoded in `.env` or left
empty (signing disabled). For Sprint+1, the secret must be fetched at app launch from a
server-side endpoint that requires a valid JWT — never shipped inside the app bundle.

```
App launch
  ↓
POST /api/auth/signing-key  (JWT-authenticated)
  ← { signingSecret: "<hex>" }
  ↓
Stored in memory only — never persisted to AsyncStorage or SecureStore.
```

### 3.5 Error Handling — 401 and 403 Surfaces

Mai is responsible for the UI layer when the server rejects a signed payload:

```typescript
// mobile/src/context/AppContext.tsx — processEndTrip() catch block

} catch (e) {
  if (e instanceof ApiError) {
    if (e.status === 401) {
      // Clock drift — device time is out of sync
      addToast({
        type: 'error',
        title: 'Clock Sync Error',
        message: 'Your device clock appears to be out of sync. Please correct it and retry.',
      });
    } else if (e.status === 403) {
      // Signature mismatch — payload was tampered in transit (or signing key mismatch)
      addToast({
        type: 'error',
        title: 'Trip Rejected',
        message: `Server rejected this trip (integrity check failed). Trip ID: ${localTripId}`,
      });
      // Do NOT enqueue for retry — this is a permanent failure.
    } else if (e.status === 422) {
      addToast({ type: 'error', title: 'Trip Rejected', message: 'Implausible trip data.' });
    } else {
      await SyncManager.enqueue(validTripPayload);
    }
  } else {
    await SyncManager.enqueue(validTripPayload);
  }
}
```

**401 and 403 must never enter `SyncManager`.** They are permanent failures. Only
network errors and 5xx responses are retry-eligible.

---

## 4. Layer 3 — Zero-Regression Baseline

**Enforced by:** CI gate (`ci-mobile.yml`) — `npx tsc --noEmit` + `npm test`
**Constraint:** 125/125 tests must pass. TypeScript must emit zero errors.
**Hard boundary:** Zero files modified under `mobile/src/lib/driving-sdk/`.

### 4.1 Test Impact Analysis

| Test Suite | Impact | Action Required |
|------------|--------|-----------------|
| `SyncManager.test.ts` | `buildTelemetryDigest` now returns a `timestamp` field | Update fixture objects to include `timestamp: expect.any(Number)` |
| `TripValidationManager.test.ts` | No impact — validation is in `src/lib/`, not the signing layer | None |
| `FraudDetector.test.ts` | No impact — fraud detection is pre-signing | None |
| `gamification.test.ts` | No impact — no overlap with crypto layer | None |
| `scoring.test.ts` | No impact | None |

### 4.2 Fixture Pattern for `timestamp`

Any test that constructs a `TelemetryDigest` literal must include the `timestamp` field
to satisfy the TypeScript interface. Use `Date.now()` or a fixed value:

```typescript
// Before (will fail TypeScript after TelemetryDigest is extended):
const digest: TelemetryDigest = { avgScore: 85, points: 60, ... };

// After:
const digest: TelemetryDigest = { avgScore: 85, points: 60, ..., timestamp: Date.now() };
// or, for deterministic test snapshots:
const digest: TelemetryDigest = { avgScore: 85, points: 60, ..., timestamp: 1748000000000 };
```

### 4.3 TypeScript Strict-Mode Compliance

The `timestamp: number` addition to `TelemetryDigest` is a **required field** (not
optional). Every callsite that constructs a `TelemetryDigest` object must supply it.
`tsc --noEmit` will surface any missed callsites before CI runs.

### 4.4 CI Gate Configuration

No changes required to `.github/workflows/ci-mobile.yml`. The existing strict gate
already blocks on both TypeScript errors and test failures:

```yaml
- name: TypeScript (no emit)
  working-directory: ./mobile
  run: npx tsc --noEmit         # must exit 0

- name: Unit tests
  working-directory: ./mobile
  run: npm test -- --no-coverage  # must be 125/125
```

### 4.5 SDK Boundary Compliance Check

Before opening any PR for this feature, verify:

```bash
# Must return nothing — no files changed inside driving-sdk/
git diff develop -- mobile/src/lib/driving-sdk/
```

If this command produces output, the PR must be rejected.

---

## 5. Migration Sequence & Cut-Over Protocol

### 5.1 Current Sprint (before demo — 2026-06-04)

> `ph:` bypass remains active. The timestamp field is added to the type system but
> the server does not yet enforce drift. This is a safe, non-breaking preparation step.

| Step | Owner | Task | Done When |
|------|-------|------|-----------|
| 1 | Dan | Add `timestamp: number` to `TelemetryDigest` in `sync/types.ts` | `tsc --noEmit` exits clean |
| 2 | Dan | Inject `Date.now()` in `buildTelemetryDigest()` | All fixture tests updated + 125/125 |
| 3 | Sean | Add `_check_timestamp_drift()` to `trips.py` (no enforcement — `ts is None` → return) | Server tests pass |
| 4 | Sean | Update `_verify_signature()` canonical string to `canonical` only (no `secret:` prefix) | HMAC unit test passes |
| 5 | Naveh | Add `TRIP_SIGNING_SECRET` to `.env.example` with generation instructions | Reviewed in PR |

### 5.2 Sprint+1 Cut-Over (post-demo)

> Simultaneous deployment required — client and server must both upgrade in the same
> release. A server that enforces HMAC will reject all `ph:` clients still in the wild.

| Step | Owner | Task |
|------|-------|------|
| 6 | Dan | Install `@noble/hashes`, implement real `signTelemetryDigest()` |
| 7 | Dan | Remove `ph:` branch in `signTelemetryDigest()` |
| 8 | Sean | Remove `ph:` bypass in `_verify_signature()` — all signatures now verified |
| 9 | Sean | Set `TRIP_SIGNING_SECRET` minimum length to 32 in `config.py` |
| 10 | Naveh | Rotate Key Vault secret, distribute to all server instances |
| 11 | All | Deploy server first, then push app update to store |

**Deployment order is critical:** Server must enforce HMAC before client removes the
`ph:` branch. If deployed in reverse order, clients send real HMACs to a server still
accepting `ph:` — this is safe. The opposite (server enforces before client upgrades)
causes all existing app installs to fail with 403.

### 5.3 Rollback Plan

If HMAC enforcement causes unexpected 403s in production after Step 8:

1. Server: re-enable `ph:` bypass (one-line revert, deploy in < 5 minutes)
2. Client: no rollback needed — real HMAC signatures are always accepted by a `ph:`-tolerant server
3. Root cause analysis: verify `TRIP_SIGNING_SECRET` is identical on all server instances

---

## 6. Acceptance Criteria

### Current Sprint (demo-ready gate)

```
Infrastructure
  ☐  timestamp field in TelemetryDigest interface (types.ts)
  ☐  Date.now() injected in buildTelemetryDigest()
  ☐  _check_timestamp_drift() present in trips.py (non-enforcing for ts=None)
  ☐  _verify_signature() uses canonical message (no secret: prefix)
  ☐  TRIP_SIGNING_SECRET documented in .env.example

Baseline
  ☐  npx tsc --noEmit → exit 0, zero type errors
  ☐  npm test -- --no-coverage → 125/125 PASS
  ☐  git diff develop -- mobile/src/lib/driving-sdk/ → empty (no SDK files touched)
```

### Sprint+1 (production enforcement gate)

```
Security
  ☐  _check_timestamp_drift: drift=299 999 ms → HTTP 200
  ☐  _check_timestamp_drift: drift=300 001 ms → HTTP 401
  ☐  _verify_signature: correct HMAC → HTTP 200
  ☐  _verify_signature: tampered point value → HTTP 403
  ☐  ph: bypass removed from both client and server
  ☐  TRIP_SIGNING_SECRET min_length=32 enforced in config.py

Client
  ☐  @noble/hashes installed, signTelemetryDigest() computes real HMAC
  ☐  stableStringify key-sort parity verified against Python json.dumps(sort_keys=True)
  ☐  401 → clock-sync toast displayed (no SyncManager enqueue)
  ☐  403 → integrity-failure toast with trip_id displayed (no SyncManager enqueue)
```

---

*CRYPTO-IMPL-001 v1.0 | Author: Dan Ofri (CTO) | 2026-05-21*
*Cross-references: RFC-001 v1.4 §7, Sprint-Execution-Plan-Demo.md §5*

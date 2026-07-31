# CARMA — Fraud Detection (v1, current)

> What is actually implemented and running in production today.
> For the next-version roadmap see [fraud-detection-roadmap.md](fraud-detection-roadmap.md).

---

## Coverage at a glance

### Transport mode fraud — can someone earn points without driving?

| Scenario | Blocked? | Layer | Mechanism |
|---|---|---|---|
| Train passenger | ✅ Yes | Client | FraudDetector — signals A + B + C |
| Bus passenger | ❌ No | — | Not implemented (reserved as Phase 2) |
| Metro / subway | ❌ No | — | Not implemented |
| Bicycle / scooter rider | ❌ No | — | Not implemented |
| Car passenger (non-driver) | ❌ No | — | Indistinguishable without OBD-II or BT seat detection |

### Data integrity fraud — can someone send fake trip data?

| Scenario | Blocked? | Layer | Mechanism |
|---|---|---|---|
| Inflated score or points | ✅ Yes | Server | `_validate_plausibility` — range check [0, 100] / max 10,000 pts |
| Impossible average speed | ✅ Yes | Server | `_validate_plausibility` — rejects avg > 250 km/h |
| Impossible distance | ✅ Yes | Server | `_validate_plausibility` — rejects distance > 2,000 km |
| Negative event counts | ✅ Yes | Server | `_validate_plausibility` — 422 on any count < 0 |
| Replay attack (resending old trip) | ✅ Yes | Server | `_check_timestamp_drift` — ±5 min window on telemetry digest |
| Tampered telemetry digest | ✅ Yes (when signed) | Server | `_verify_signature` — HMAC-SHA256 |
| Duplicate trip submission | ✅ Yes | Server | `idempotency_key` unique constraint in DB |

---

## 1. Architecture — two independent layers

The fraud system has two completely separate concerns that happen to share the name "fraud":

```
┌─────────────────────────────────────────────────────────────┐
│  LAYER 1 — Transport mode detection (client-side)           │
│                                                             │
│  FraudDetector.ts  ←  SensorManager (IMU + GPS, 10 Hz)     │
│       ↓                                                     │
│  TripValidationManager.ts  →  rejects trip before start     │
│       ↓  if mid-trip detection                              │
│  fraud.api.ts  →  POST /api/fraud  →  fraud_reports table   │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  LAYER 2 — Data integrity validation (server-side)          │
│                                                             │
│  POST /api/trips                                            │
│    → _validate_plausibility()   (physics + range checks)   │
│    → _check_timestamp_drift()   (replay attack window)      │
│    → _verify_signature()        (HMAC-SHA256 digest)        │
│    → calculate_score()          (server is sole oracle)     │
│    → persist Trip                                           │
└─────────────────────────────────────────────────────────────┘
```

Layer 1 runs on the device and prevents a fraudulent trip from being scored at all.
Layer 2 runs on the server and rejects any tampered or implausible payload, regardless
of what the client claims.

---

## 2. Layer 1 — Transport mode detection

### How it works

`FraudDetector` analyses a **60-second sliding window** of IMU + GPS samples (1 Hz)
and scores the probability that the user is on a train using three physical signals:

| Signal | Reported as | Measures | Threshold | Weight |
|---|---|---|---|---|
| A — Speed profile | `constantHighSpeed` | Low variance + high average speed (train = constant, car = variable) | variance < 8 km/h², avg > 60 km/h | 0.40 |
| B — Lateral acceleration | `noLateralForce` | Near-zero lateral force (rails prevent sway; cars always produce some) | max(|accelX|) < 0.12 g | 0.35 |
| C — Yaw rate variance | `noHeadingChange` | Near-zero heading change (track is fixed; cars micro-steer continuously) | variance(gyroZ) < 0.02 rad²/s² | 0.25 |

```
fraud_score = 0.40 × A + 0.35 × B + 0.25 × C        (0.0 – 1.0)

mode = TRAIN   if  fraud_score ≥ 0.70  AND  B = TRUE  AND  C = TRUE
       UNKNOWN otherwise
```

The B∩C requirement prevents a false positive on a straight motorway with cruise control:
that scenario can satisfy A + B (score 0.75) while still producing measurable yaw — Signal C
rejects it.

### When the check runs

The check is embedded in `TripValidationManager`'s state machine:

```
           speed > 10 km/h
IDLE ──────────────────────► PRE_TRIP
                                │
               speed drops  ◄──┘  (reset, < 30 s)
                                │
               30 s continuous > 10 km/h
                                │
                     ┌── Rule 3: fraud check ──┐
               TRAIN detected              no fraud
              (reset → IDLE,                   │
               fires onFraudSuspected)         ▼
                                           SCORING ──── continuous monitoring
                                               │         (fires once if detected mid-trip)
                               3 min continuous < 10 km/h
                                               ▼
                                            ENDED
```

**At trip start (primary gate):** evaluated exactly when Rule 1 is satisfied (30 s of movement).
The buffer has 30 samples — the minimum for a verdict. A TRAIN verdict rejects the trip silently
before `onTripConfirmed` is ever called.

**Mid-trip (secondary gate):** the detector continues sampling during SCORING. If the signal
shifts to train-like (user boards a train partway through), `onFraudSuspected` fires once and
the event is sent to `POST /api/fraud` for server-side review.

### Manual start — bypass prevention

A user on a train who taps "start trip" manually bypasses Bluetooth-triggered validation.
The SDK guards this path explicitly (D-FRAUD-3): if validation is not already running,
it starts it — ensuring all code paths go through the same Rule 1 + Rule 3 gate.

### Output sent to the server

`POST /api/fraud` carries the verdict **and the evidence behind it**. The score alone
says a session was flagged; the signals say which gate fired and the telemetry says by
how much — which is what a threshold recalibration or a false-positive investigation
actually needs.

```jsonc
{
  "idempotencyKey": "fraud_<userId>_<timestamp>",
  "tripDurationSeconds": 240,
  "distanceKm": 4.8,              // null for a pre-trip rejection — see below
  "anomalyFlags": [
    "TRANSPORT_MODE_TRAIN",
    "HIGH_FRAUD_SCORE",           // score > 0.80
    "SIGNAL_CONSTANT_HIGH_SPEED", // one flag per gate that fired
    "SIGNAL_NO_LATERAL_FORCE",
    "SIGNAL_NO_HEADING_CHANGE"
  ],
  "detection": {
    "fraudScore": 1.0,
    "detectedMode": "TRAIN",
    "signals": {                  // Signal A / B / C, by name
      "constantHighSpeed": true,
      "noLateralForce": true,
      "noHeadingChange": true
    },
    "telemetry": {
      "avgSpeedKmh": 82.4,
      "maxLateralAccelG": 0.03,
      "yawVariance": 0.001        // rad²/s² — variance of yaw *rate*
    },
    "maxSpeedKmh": 96.2,
    "detectedAt": "2026-08-01T09:00:00.000Z"
  }
}
```

Three properties of this contract are deliberate:

- **One name per value, end to end.** `fraudScore` is `fraudScore` in `FraudDetector`,
  on the wire, and in the column. A value renamed at a layer boundary can no longer be
  traced back to the rule that produced it.
- **Gates are duplicated into `anomalyFlags`.** "Which rule caught this?" is then a
  query on one indexed array rather than a scan through stored evidence.
- **`distanceKm` is null at the primary gate.** A trip rejected before confirmation
  never accumulated distance — the null is the true value, not a missing one.

`detection` is validated against a schema and stored in its own JSONB column; `rawPayload`
remains as the escape hatch for anything not yet modelled. Everything stored is a window
aggregate — no raw sample traces leave the device. Thresholds can be recalibrated
server-side from this data without a client release.

**Retention — agreed, not yet enforced:** `fraud_reports` rows are to be kept for
**12 months** from `reported_at`. They are anti-fraud evidence, so they outlive a normal
session, but not indefinitely — GDPR storage limitation applies to derived behavioural
data as much as to raw location. No job deletes them today; that is tracked separately.

---

## 3. Layer 2 — Server-side data integrity

Every `POST /api/trips` passes through three gates before scoring and persistence.
Gate order: plausibility (422) → drift (401) → signature (403).

### Gate 1 — Plausibility (`_validate_plausibility`)

Rejects payloads that are physically impossible:

| Check | Limit | Error |
|---|---|---|
| `avg_score` out of range | must be in [0, 100] | 422 |
| `points` too high (no digest) | max 10,000 | 422 |
| `distance_km` negative | must be ≥ 0 | 422 |
| `distance_km` impossible | max 2,000 km | 422 |
| `hard_brakes` negative | must be ≥ 0 | 422 |
| Average speed (distance / duration) | max 250 km/h | 422 |
| Average speed from digest | same 250 km/h cap | 422 |

Two defense-in-depth layers sit behind that 422: counts read from the telemetry digest
are floored with `max(0, …)` in `trips._compute_score`, and `scoring` clamps the derived
event rate with `max(0.0, rate)`. A negative value cannot reduce a penalty at any stage.

### Gate 2 — Timestamp drift (`_check_timestamp_drift`)

When a `telemetryDigest` is present, its `timestamp` must be within **±5 minutes** of
server time. A stale timestamp means the client is replaying a previously recorded trip.

```python
if abs(server_ms - client_ms) > 300_000:   # 5 min in ms
    raise HTTPException(401, "Stale timestamp — possible replay attack")
```

Audit-logged as `trips.timestamp.stale` with drift in milliseconds.

### Gate 3 — HMAC signature (`_verify_signature`)

When `payloadSignature` is present, the server recomputes HMAC-SHA256 over the canonical
JSON of `telemetryDigest` and compares with `hmac.compare_digest` (constant-time).
A mismatch means the digest was tampered with in transit.

```python
canonical = json.dumps(digest, sort_keys=True, separators=(",", ":"))
expected  = hmac.new(secret.encode(), canonical.encode(), sha256).hexdigest()
if not hmac.compare_digest(expected, signature):
    raise HTTPException(403, "Invalid payload signature")
```

Audit-logged as `trips.signature.rejected`.

Note: signatures starting with `ph:` are accepted without verification during sprint 1
(placeholder sprint convention). See `trips.signature.bypass` in the audit log.

### Gate 4 — Idempotency

Each trip carries an `idempotency_key`. A second `POST /api/trips` with the same key
returns the already-persisted trip without re-scoring or re-crediting points — preventing
double-submission from network retries.

---

## 4. Constants reference

### Client (Appendix E)

| Constant | Value | Role |
|---|---|---|
| `WINDOW_SIZE` | 60 samples | Sliding window length |
| `MIN_SAMPLES_TO_EVALUATE` | 30 | Minimum fill before verdict |
| `SPEED_VARIANCE_THRESHOLD` | 8 km/h² | Signal A upper bound |
| `MIN_AVG_SPEED_KMH` | 60 km/h | Signal A lower bound |
| `LATERAL_ACCEL_MAX_G` | 0.12 g | Signal B upper bound |
| `YAW_VARIANCE_THRESHOLD` | 0.02 rad²/s² | Signal C upper bound |
| `FRAUD_SCORE_THRESHOLD` | 0.70 | Classification threshold |
| `SPEED_THRESHOLD_KMH` | 10 km/h | Rule 1 / Rule 2 boundary |
| `START_THRESHOLD_MS` | 30,000 ms | Rule 1 duration |
| `END_THRESHOLD_MS` | 180,000 ms | Rule 2 duration |

### Server (`server/app/services/trips.py`)

| Constant | Value | Role |
|---|---|---|
| `_MAX_POINTS_PER_TRIP` | 10,000 | Plausibility cap |
| `_MAX_DISTANCE_KM` | 2,000 km | Plausibility cap |
| `_MAX_AVG_SPEED_KMH` | 250 km/h | Plausibility cap |
| `_MAX_HARD_BRAKES` | 500 | Plausibility cap |
| `_DRIFT_WINDOW_MS` | 300,000 ms (5 min) | Replay attack window |

# CARMA — Fraud Detection v2 (Roadmap)

> Planning document for the next-generation fraud prevention system.
> Current production state is documented in [fraud-detection.md](fraud-detection.md).

---

## Coverage comparison — v1 vs. v2

### Transport mode fraud

| Scenario | v1 | v2 | Notes |
|---|---|---|---|
| Train passenger | ✅ | ✅ | Already implemented; thresholds to be recalibrated from field data |
| Bus passenger | ❌ | ✅ | New signal profile — frequent stops are the key differentiator |
| Metro / subway | ❌ | ✅ | Similar to bus; underground GPS dropout is an additional signal |
| Bicycle / e-scooter | ❌ | ✅ | Low speed + high cadence vibration pattern |
| Car passenger (non-driver) | ❌ | ⚠️ Partial | Soft heuristic only — full detection requires OBD-II or BT seat |
| Stationary phone (GPS spoofing) | ❌ | ✅ | Zero IMU variance + moving GPS = spoofed location |

### Data integrity fraud

| Scenario | v1 | v2 | Notes |
|---|---|---|---|
| Inflated score / points | ✅ | ✅ | Already implemented |
| Impossible average speed | ✅ | ✅ | Already implemented |
| Impossible distance | ✅ | ✅ | Already implemented |
| Negative event counts | ✅ | ✅ | Already implemented |
| Replay attack | ✅ | ✅ | Already implemented |
| Tampered telemetry (signed) | ✅ | ✅ | Already implemented |
| Duplicate submission | ✅ | ✅ | Already implemented |
| GPS coordinate teleportation | ❌ | ✅ | Jump between consecutive GPS points exceeds physical speed limit |
| Accelerometer–GPS speed mismatch | ❌ | ✅ | IMU-derived speed vs GPS speed diverge on fabricated data |
| Anomalous scoring pattern | ❌ | ✅ | Cross-trip statistical outlier detection per user |
| Signature always required | ⚠️ Optional | ✅ | Remove the `ph:` placeholder bypass; make HMAC mandatory |

---

## 1. New transport mode classifiers

### 1.1 Bus detection

Buses share some train-like signals (high speed, low lateral accel on a straight road)
but have a distinctive stop pattern that trains do not:

**Key differentiating signals:**
- **Frequent full stops** — buses stop every 1–3 km; trains rarely stop mid-route.
  Detect periodic `speed → 0 → speed` cycles within the window.
- **Door vibration spike** — bus doors opening/closing produce a short, sharp IMU spike
  (~0.3–0.5 g, < 200 ms) while stationary. Distinct from braking events (which occur
  while moving).
- **Acceleration profile at departure** — buses accelerate at ~0.8–1.2 m/s² from stops;
  this is below the hard-acceleration threshold but above idle drift.

```
signalBus = stopCount >= 2 within 10 min window
            AND doorSpikeDetected
            AND avgSpeed in [15, 70] km/h
```

**Challenge:** a car stuck in heavy traffic with frequent full stops overlaps.
Discriminator: a car in traffic produces continuous steering corrections (Signal C active);
a bus produces near-zero yaw between stops (Signal C inactive). Use `NOT signalC` as a
bus-confirming signal.

### 1.2 Metro / subway detection

Metro has a unique signature: **GPS dropout** inside tunnels combined with
**train-like kinematics** when above ground or in open stations.

```
signalMetro = gpsDropoutSeconds > 30 within trip
              AND kinematicPattern == TRAIN_LIKE
              AND avgSpeed in [25, 90] km/h
```

GPS dropout alone is not sufficient (tunnels on roads also lose signal briefly).
The combination with train-like IMU makes it reliable.

**Implementation dependency:** requires the SDK to track GPS fix quality
(`accuracy`, `numSatellites`) and expose dropout duration — not currently recorded.

### 1.3 Bicycle / e-scooter detection

Bicycles operate at low speed with a characteristic **pedalling vibration** on the
vertical IMU axis (Z-axis) at ~1–2 Hz cadence, and near-zero lateral accel.

```
signalBicycle = avgSpeed in [8, 35] km/h
                AND cadenceHz in [0.8, 2.5]    (vertical IMU periodicity)
                AND maxLateralAccelG < 0.20 g
```

**Challenge:** cadence detection requires FFT or autocorrelation on the Z-axis, which
is more computationally expensive than the current variance checks. Can be limited to a
subsample of the window (every 10th second) to keep it O(n).

### 1.4 Car passenger (soft heuristic)

This is the hardest scenario to solve without hardware. A passenger in a car
experiences the same kinematics as the driver. Soft signals only:

- **No Bluetooth pairing to a known vehicle** — if the user's registered vehicle BT device
  is not connected, they are likely not the driver.
- **Phone orientation** — a passenger's phone is more often horizontal (on lap) vs.
  a driver's phone in a mount (vertical). Requires calibration per user.
- **Steering micro-corrections absent** — a driver produces subtle periodic lateral micro-inputs
  aligned with road curves; a passenger does not. Requires GPS route + IMU correlation.

None of these is individually reliable. v2 should emit a `PASSENGER_LIKELY` flag with
a confidence score rather than a hard block, and use it as a soft signal in the
server-side anomaly detector (see §2.3) rather than rejecting the trip outright.

### 1.5 GPS spoofing detection

A user running a GPS mock app produces moving coordinates with **zero IMU response** —
the phone is stationary but GPS claims movement.

```
signalSpoofed = GPSspeedKmh > 20
                AND accelMagnitude < 0.05 g    (phone not moving at all)
                AND gyroMagnitude < 0.01 rad/s
```

Both the accelerometer and gyroscope should register *something* in a moving vehicle.
Near-zero IMU across all axes while GPS reports speed is a near-certain spoof.

---

## 2. Server-side improvements

### 2.1 GPS teleportation check

Add a per-event coordinate plausibility check: the straight-line distance between
two consecutive GPS points divided by elapsed time must not exceed a physical maximum.

```python
MAX_INSTANTANEOUS_SPEED_KMH = 400   # faster than any road vehicle

for (p1, t1), (p2, t2) in consecutive_gps_pairs:
    dist_km = haversine(p1, p2)
    dt_h    = (t2 - t1).total_seconds() / 3600
    if dist_km / max(dt_h, 1e-6) > MAX_INSTANTANEOUS_SPEED_KMH:
        raise HTTPException(422, "GPS teleportation detected")
```

This catches fabricated route data that passes the average-speed check
but has impossible point-to-point jumps.

### 2.2 IMU–GPS speed consistency

When both IMU-derived speed (integrated from accelerometer) and GPS speed are present
in the telemetry digest, they must agree within a tolerance band.
A fabricated GPS track paired with real IMU data (or vice versa) will diverge.

```python
for sample in telemetry_samples:
    if abs(sample.gps_speed_kmh - sample.imu_speed_kmh) > 40:   # km/h tolerance
        mismatch_count += 1

if mismatch_count / len(telemetry_samples) > 0.20:   # >20% samples diverge
    raise HTTPException(422, "IMU–GPS speed mismatch — possible fabricated data")
```

**Implementation dependency:** requires the mobile SDK to include per-sample IMU speed
in the telemetry digest, which it does not currently do.

### 2.3 Cross-trip anomaly detection

A per-user statistical baseline built from their trip history. Flags trips that are
outliers on one or more dimensions:

| Metric | Flag condition |
|---|---|
| Score jump | score > user_avg + 3σ on a single trip |
| Distance jump | distance > user_avg × 5 on a single trip |
| Points per km | points/km > fleet 99th percentile |
| Event rate | hard_brakes/km < fleet 1st percentile (suspiciously perfect) |

Flagged trips are not rejected automatically — they are stored with an `anomaly_flags`
array in `fraud_reports` for manual review or future automated action.

The `fraud_reports` table already has an `anomaly_flags JSONB` column (migration 0002)
ready to receive these flags.

### 2.4 Make HMAC signature mandatory

Currently `payloadSignature` is optional, and the `ph:` prefix bypasses verification.
v2 should:

1. Remove the `ph:` bypass path from `_verify_signature`.
2. Make `TRIP_SIGNING_SECRET` a required setting (server startup fails if absent).
3. Require the mobile client to always sign the `telemetryDigest` before sending.

This closes the gap where a client that sends no signature at all is not verified.

---

## 3. Implementation priorities

| Priority | Item | Effort | Dependency |
|---|---|---|---|
| 1 | Make HMAC mandatory (remove `ph:` bypass) | Low | Coordinate with mobile client release |
| 2 | GPS teleportation check | Low | Server-only change |
| 3 | Cross-trip anomaly flags | Medium | Needs 30+ days of real trip history per user |
| 4 | GPS spoofing detection | Medium | SDK must expose raw IMU magnitude |
| 5 | Bus detection | Medium | Field data to calibrate stop thresholds |
| 6 | Metro detection | Medium | SDK must track GPS fix quality / dropout |
| 7 | IMU–GPS speed consistency | High | SDK must include per-sample IMU speed in digest |
| 8 | Bicycle detection | High | FFT/autocorrelation on IMU — CPU cost to measure |
| 9 | Car passenger heuristic | High | Multi-signal, no hard block — soft score only |

---

## 4. Files impacted when implemented

| File | Change |
|---|---|
| `mobile/src/lib/FraudDetector.ts` | Add bus / metro / bicycle / spoof classifiers |
| `mobile/src/lib/driving-sdk/types.ts` | Add `BUS`, `BICYCLE`, `SPOOFED` to `TransportMode` |
| `mobile/src/lib/driving-sdk/sensors/SensorManager.ts` | Expose GPS fix quality, IMU magnitude, dropout duration |
| `server/app/services/trips.py` | Add `_check_gps_teleportation`, `_check_imu_gps_consistency`; remove `ph:` bypass |
| `server/app/services/fraud.py` | Add `_flag_anomalies(user, trip)` for cross-trip analysis |
| `server/app/models/fraud.py` | `anomaly_flags` column already exists — no schema change needed |
| `server/alembic/versions/` | New migration only if adding columns |
| `mobile/src/types/index.ts` | Regenerate after any server schema change |

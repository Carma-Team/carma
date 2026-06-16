# CARMA Scoring Algorithm

> **Status: RETIRED.** Superseded by [scoring-algorithm-v2.md](scoring-algorithm-v2.md), which is now the sole authoritative engine. The `get_risk_multiplier` time-of-day factor from `scoring.py` is still reused by the v2 engine. `scoring.ts` in the mobile client is kept for unit-test reference only — not called at runtime.

---

## Architecture

The server is the **sole scoring oracle** (RFC-001 v1.5 — Absolute Metrics Decoupling). The mobile client is a sensor node only: it collects raw telemetry and shows raw event notifications during the trip. No score is calculated or displayed on the client during a live trip.

```
Mobile (sensor node — no scoring)   Server (sole oracle)
  CarmaDrivingSDK                →    scoring.py::calculate_score()
  raw telemetry + events              ↓ final value written to DB
  HUD: speed, distance, events   ←   Trip.avg_score, Trip.points
  post-trip summary from server       (returned in POST /api/trips response)
```

`scoring.ts` is kept in `mobile/src/lib/` for unit-test reference only. It is not called at runtime.

---

## Step 1 — Penalty calculation

Each driving event incurs a fixed penalty deducted from 100.

| Event | Field | Penalty |
|---|---|---|
| Hard brake | `hardBrakes` | **−5 per event** |
| Aggressive acceleration | `aggressiveAccels` | **−3 per event** |
| Sharp turn | `sharpTurns` | **−2 per event** |
| Phone touch epoch | `touchEpochs` | **−4 per epoch** |
| Screen time ratio | `screenInteractionSeconds / durationSeconds` | **−40 × ratio** |

```
penalties = hardBrakes×5 + aggressiveAccels×3 + sharpTurns×2
          + touchEpochs×4 + (screenSeconds / max(durationSeconds, 1))×40
```

A "touch epoch" is a discrete window where the phone screen was active while driving (not raw seconds — the SDK batches continuous touch into epochs).

---

## Step 2 — Raw score (0–100)

```
score = clamp(100 − penalties, 0, 100)
```

A perfect trip with no events scores 100. The score cannot go below 0 or above 100.

---

## Step 3 — Distance factor

Points scale logarithmically with distance to reward longer trips without making short trips worthless.

```
distanceFactor = log(distanceKm + 1) / log(11)
```

| Distance | Factor |
|---|---|
| 0 km | 0.00 |
| 1 km | 0.30 |
| 5 km | 0.68 |
| 10 km | 1.00 |
| 20 km | 1.31 |

At 10 km the factor equals exactly 1.0 (log(11)/log(11)). This is the reference trip length.

---

## Step 4 — Risk multiplier

Night driving on Israeli weekend nights is weighted higher to reward extra caution during statistically riskier periods.

```
get_risk_multiplier(startTime):
  isNight         = hour >= 23 or hour < 4
  isWeekendNight  = day in {Thu, Fri, Sat}   # Israeli weekend

  if not isNight        → 1.0
  if isWeekendNight     → 2.0
  else (weeknight)      → 1.5
```

The server converts `startTime` to `Asia/Jerusalem` before evaluating. The mobile client uses the device's local timezone (assumed to be correct for Israeli users).

---

## Step 5 — Points earned

```
points = score × distanceFactor × riskMultiplier
```

Both `score` and `points` are rounded to one decimal place before storage.

### Example

A 5 km trip at 23:30 on a Friday with 2 hard brakes and 1 touch epoch:

```
penalties       = 2×5 + 1×4 = 14
score           = 100 − 14 = 86
distanceFactor  = log(6) / log(11) ≈ 0.735
riskMultiplier  = 2.0   (Friday night)
points          = 86 × 0.735 × 2.0 ≈ 126.4
```

---

## Grades and colors

After scoring, `score` maps to a display grade and color:

| Score | Grade | Color |
|---|---|---|
| 90–100 | `excellent` | `#22c55e` (green) |
| 75–89 | `good` | `#84cc16` (lime) |
| 55–74 | `fair` | `#f59e0b` (amber) |
| 0–54 | `poor` | `#ef4444` (red) |

---

## Points → Levels

Earned points accumulate in `User.total_points` (never decremented). The level threshold table lives in the `levels` DB table (seeded in `server/app/seed.py`). `User.points` is the redeemable balance — it decreases when a voucher is redeemed.

---

## Files

| File | Role |
|---|---|
| `mobile/src/lib/scoring.ts` | Client-side (display only) |
| `server/app/services/scoring.py` | Server oracle (authoritative) |
| `server/app/services/trips.py` | Calls `calculate_score`, writes to DB |
| `mobile/src/types/index.ts` | `ScoringInput`, `ScoringResult` types |

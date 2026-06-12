# CARMA Scoring Algorithm

> Describes the scoring and points formula used in both the mobile client (`mobile/src/lib/scoring.ts`) and the server oracle (`server/app/services/scoring.py`). The two implementations are kept in sync manually — any change to one must be reflected in the other.

---

## Architecture

The server is the **sole scoring oracle**. The mobile client computes a local score in real-time for display purposes only. When the trip ends, the raw telemetry is sent to the server, which recomputes the authoritative score before persisting the trip.

```
Mobile (real-time display)          Server (authoritative)
  scoring.ts::calculateScore()  →    scoring.py::calculate_score()
       ↓ local preview                      ↓ final value written to DB
  shown on trip-end screen          Trip.avg_score, Trip.points
```

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

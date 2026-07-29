# Where the scoring constants came from

**Status: current.** Covers the constants in [`scoring.py`](../server/app/services/scoring.py) as they stand today — trips scored with them are stamped `2.1.0`.

The score's shape is set by five decay constants — one per component. This document records what they were fitted to, and what is still waiting on more data.

---

## The problem the July 2026 recalibration fixed

We looked at 57 real trips from the cloud (May–July 2026) and found the score was not working:

| Symptom | Cause |
|---|---|
| Exact 100.0 on every trip, whatever the driving | Some phones upload all-zero event counts (issue #13) |
| Either 100.0 or a cliff to ~50 — nothing in between | One hard brake on a 7.5 km trip scored 54.3. No real trip ever landed in 85–95. |
| Motorway speeding not costing anything | The GPS trace showed 131.8 km/h and 304 samples above 110 km/h on trips reported as event-free |

The last one is the important one: **the phone was already sending a GPS trace the server never looked at.** That trace is an independent witness to what happened on a drive.

---

## What changed

All four changes are server-side — no app release was needed.

| Change | Effect |
|---|---|
| **Server detects events from the GPS trace** | Brakes, accelerations and turns are re-derived from speed and bearing. Merged as `max(phone, GPS)` per type — counts only ever go up. |
| **Speeding switched on** | Time over a conservative absolute limit (120 km/h national max + 10 km/h buffer, so only above 130 counts). No map data needed. |
| **Confidence cap** | A sparse or gappy trace limits how far a trip can score *above* the driver's rolling score. Kills the fake flat 100 without diluting real events. |
| **Constants re-fitted** | From the fleet's own rate distributions, weighted so recent trips count more (weights halve every 30 days). Bench rides under 1 km excluded. |

### The new constants

| Constant | Old (a guess) | v2.1 | Range the data supported |
|---|---|---|---|
| `k_brake` | 0.075 | **0.018** | 0.008–0.028 |
| `k_accel` | 0.089 | **0.022** | 0.012–0.052 |
| `k_corner` | 0.064 | **0.012** | 0.007–0.018 |
| `k_speed` | 0.045 | **0.012** | no data — kept proportional |
| `k_distraction` | 0.112 | **0.020** | 0.018–0.021 |

### What it did to real scores

Re-scoring the full history under the new constants:

| | Before | After |
|---|---|---|
| Median trip | 84.3 | 88.5 |
| Worst 10% | 38.2 | 72.7 |
| Trips scoring exactly 100 | 6 | 0 |
| Spread preserved? | — | yes: worst 56.1, best 99.3 |

**Old scores were not rewritten.** Existing rows keep the score and version stamp they were given.

---

## What is still not calibrated

The target was a median near 80 and a worst-10% near 45. We hit the median but not the tail — the tail figure assumes severity-weighted counts, which we cannot produce yet.

Full calibration needs **all three** of:

- **~200 or more real trips.** Fitting five constants to 57 fits noise as much as signal.
- **Trustworthy phone-side detection** (issue #13), so client counts mean something.
- **Per-event severity flowing** (issues #12 and #14), so we calibrate severity-weighted rates rather than raw counts.

**Method when we get there:** pull the real distance and rate distributions, set the exposure floor where rate variance stabilises, solve each constant for median ≈ 80 and worst-10% ≈ 45, re-score history, and flip at a level-season boundary.

**The bigger move after that** is to stop using fixed constants at all. CMT score each component against the driver population rather than against an absolute curve. That is the better method and it becomes possible the moment we have a real fleet distribution.

---

## Notes

- **The same work is tracked under two id schemes.** Per-event severity appears as issue #14 here and as CAR-6 in [scoring.md](scoring.md). Reconcile before either is picked up — new issues go in Linear only.
- **GPS sampling density varies by device.** Some phones emit a 6-second median with gaps over 15 seconds, which permanently caps their confidence. Raised with May, July 2026.
- `python -m app.seed --driver-scores-only` backfills a NULL `driver_score` without touching live-computed values.

---

## Appendix — why this was deferred until July

The original decision (2026-06-15) was to leave the constants at their initial guesses:

1. **Volume.** ~15 trips at the time.
2. **Dirty data.** No way to separate bench rides from real ones.
3. **Detection still being fixed.** Calibrating on mis-detected counts bakes in the wrong shape.
4. **Deferring was free.** Constants affect only the displayed score, never the stored raw data.

By July, points 1 and 2 had improved and point 4 had flipped: the uncalibrated curve was actively destroying trust in the score — it gave the CTO's own commute a flat 100. That is what triggered the partial recalibration above.

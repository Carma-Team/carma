# Scoring v2 — Calibration Status & Deferral Decision

> **Decision (2026-06-15, Dan):** v2's tunable constants are **deliberately left at their
> initial estimates. Do not recalibrate yet.** Revisit per the trigger below.

The v2 method for calibration is already specified — see
[scoring-algorithm-v2.md §6.1](scoring-algorithm-v2.md) (the `k_c` decay constants) and
[§10](scoring-algorithm-v2.md) (shadow mode, percentile fit, rollout). This file records
*why we are not running that procedure now*, so the decision is deliberate and dated rather
than forgotten.

---

## What "calibration" would tune

All in `server/app/services/scoring_v2.py::ScoringConfigV2` — every value is an estimate,
not yet fit to real data (the module docstring says so outright):

- **`k_brake … k_distraction`** — the exponential-decay constants mapping an event *rate*
  (events per 100 km / per hour) to a 0–100 subscore. Should be fit so the fleet **median**
  trip lands ≈ 80 and the 90th-percentile-worst ≈ 45 (spec §6.1).
- **`exposure_floor_km = 4.0`** — short trips have their event rate computed as if they were
  at least 4 km, to stop a single event on a 0.5 km trip from nuking the score. The *value*
  4.0 is a guess; the right floor is the distance below which the rate estimate is
  noise-dominated, read off the real distance/rate distribution.
- **`short_trip_km / short_trip_min`** and the 50/50 blend with the driver's standing score
  — same story: thresholds picked by intuition, not data.

## Why we are deferring

1. **Volume.** As of 2026-06-15 there are **~15 trips total** in the cloud DB (11 in the last
   two days). Fitting five decay constants plus floors to ~15 points fits **noise**, not a
   driving distribution.
2. **Dirty data.** An unknown share of those trips were **experimental / bench rides**, not
   real driving (e.g. a 0.46 km / 24.5 min "trip" at ~1 km/h). We currently have **no way to
   separate test rides from real ones**, so even the volume we have is not clean.
3. **Detection is still being fixed.** Event *counts* themselves are unreliable until the SDK
   calibration lands (phantom events when stationary, missed events while driving — issue
   #13). Calibrating the scoring curve on top of mis-detected events would bake in the wrong
   shape.
4. **Deferring is free.** The exposure floor and decay constants affect only the **displayed
   score**, never the **stored raw data** — event counts, the signed digest, and the
   per-event `events` rows are all persisted faithfully regardless. Waiting costs us nothing
   on the data side; recalibrating later loses no history.

## Trigger to revisit

Recalibrate when **all** hold:

- **≥ ~200 real (non-test) trips** accumulated — aligns with the `credibility_full_km = 300`
  belief already encoded in the config.
- SDK detection calibration shipped (issue #13) so event counts are trustworthy.
- Ideally, per-event severity flowing (issues #12 + #14) so we calibrate severity-weighted
  rates, not raw counts.

## Method when the trigger is met

Follow [§10](scoring-algorithm-v2.md) — in short:

1. Pull the real distributions of trip **distance** and per-component **event rate** from the
   cloud DB.
2. Set `exposure_floor_km` at the distance where rate variance stabilises.
3. Solve each `k_c` from the real percentiles so median ≈ 80, p90-worst ≈ 45 (§6.1 table).
4. **Re-score the full history** under the candidate constants and confirm the score
   distribution is sane (no cliff at 0/100, median in band) before activating.
5. Flip at a level-season boundary so nobody's points jump mid-progression (§10.4).

## Related

- Live-data diagnosis (2026-06-15): the empty `events` table (now fixed server-side),
  mixed `scoring_version`, and mostly-NULL `driver_score`.
- Issues: #12 (mobile sends events), #13 (SDK detection calibration), #14 (SDK emits
  `peak_g`/`duration_ms` → unblocks severity).

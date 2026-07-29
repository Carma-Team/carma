# Scoring v2 — Calibration Status

> **Decision (2026-07-19, Dan):** partial recalibration executed — **v2.1**. The
> full percentile fit remains deferred per the original trigger (below), but the
> shape defects that made scores unusable (flat 100s, single-event cliffs) were
> fixed now using the data we do have. Original deferral decision (2026-06-15)
> is preserved at the bottom for the record.

## What v2.1 changed (2026-07)

Diagnosis on 57 cloud trips (2026-05-15 → 2026-07-13) showed:

- Devices affected by issue #13 upload **all-zero digest counts** → exact 100.0
  every trip, regardless of driving.
- The initial `k_c` estimates produced a **bimodal distribution**: one hard brake
  on a 7.5 km trip → 54.3; zero events → 100.0. No real trip landed in 85–95.
- `route_waypoints` (sent by every v2 client) is an **independent witness** the
  server never used: GPS kinematics found sharp turns and sustained motorway
  speeding (131.8 km/h max, 304 samples >110) on trips reported as event-free.

The v2.1 response, all server-side (`telemetry.py` + `scoring_v2.py` + `trips.py`):

1. **Server-side GPS detection** — brakes/accels/turns from speed deltas and
   bearing rates; merged into scoring via `max(digest, gps)` per type (counts
   only ever go up — anti-fraud is one-way).
2. **Speeding component activated** — time-over-threshold (§3.3) against a
   conservative absolute limit (120 national max + 10 buffer; only >130 counts).
   `has_speed_data=True` whenever waypoint coverage suffices.
3. **Confidence cap** (`apply_confidence`) — sparse/gappy traces cap how far a
   trip can score *above* the driver's rolling score. Kills the fake flat 100;
   never dilutes reported events.
4. **Decay constants re-fit** from recency-weighted per-component rate
   percentiles of the real fleet (weights halve every 30 days; sub-1 km bench
   rides excluded):

   | constant | old (estimate) | v2.1 | anchor range from data |
   |---|---|---|---|
   | `k_brake` | 0.075 | 0.018 | 0.008–0.028 |
   | `k_accel` | 0.089 | 0.022 | 0.012–0.052 |
   | `k_corner` | 0.064 | 0.012 | 0.007–0.018 |
   | `k_speed` | 0.045 | 0.012 | no data — kept proportional |
   | `k_distraction` | 0.112 | 0.020 | 0.018–0.021 |

   Full-history re-score under v2.1 (§10.3 sanity check): median 84.3 → 88.5,
   p10 38.2 → 72.7, perfect-100 count 6 → 0, gradient preserved (worst 56.1,
   best 99.3). The spec's p90-worst ≈ 45 anchor is intentionally not hit yet:
   it assumes severity-weighted counts, which need issue #14.

`scoring_version` bumped to **2.1.0**. History is not rewritten — old rows keep
their stored scores and version stamp.

## Still deferred (original trigger unchanged)

Full percentile calibration — including severity-weighted rates and per-band
speeding against map-matched limits — waits for **all** of:

- **≥ ~200 real (non-test) trips** accumulated.
- SDK detection calibration shipped (issue #13) so client counts are trustworthy.
- Per-event severity flowing (issues #12 + #14) so we calibrate severity-weighted
  rates, not raw counts.

Method when the trigger is met: spec §10 — pull real distance/rate
distributions, set `exposure_floor_km` where rate variance stabilises, solve
each `k_c` for median ≈ 80 / p90-worst ≈ 45, re-score history, flip at a
level-season boundary.

## Related

- Issues: #12 (mobile sends events), #13 (SDK detection calibration), #14 (SDK
  emits `peak_g`/`duration_ms`), and the GPS sampling-density issue (Dan → May,
  2026-07: 6 s median + >15 s gaps on some devices caps their confidence).
- `python -m app.seed --driver-scores-only` backfills NULL `driver_score` for
  seeded users without touching live-computed values.

---

## Appendix — original deferral decision (2026-06-15, superseded in part)

The v2 constants were deliberately left at their initial estimates because:

1. **Volume.** ~15 trips total at the time — fitting five decay constants to
   that fits noise.
2. **Dirty data.** No way to separate bench rides from real ones.
3. **Detection still being fixed.** Calibrating on mis-detected counts bakes in
   the wrong shape.
4. **Deferring was free.** Constants affect only the displayed score, never the
   stored raw data.

By 2026-07 points 1–2 had improved (57 trips, bench rides identifiable by
distance/duration) and point 4 had flipped — the uncalibrated curve was
actively destroying score trust (flat 100s for the CTO's own commute) — hence
the partial recalibration above.

# CARMA Scoring Algorithm v2 — Next Generation

> **Status: LIVE — v2 is the sole authoritative, user-facing scoring engine.**
> v1 ([scoring-algorithm.md](archive/scoring-algorithm.md)) is retired; only its
> `get_risk_multiplier` time-of-day factor is still reused. Remaining SDK and UI work
> (severity capture, driver-score UI) is tracked in
> [scoring-v2-handoff.md](scoring-v2-handoff.md). See **§13 Implementation status**.
>
> This document specifies the next-generation scoring engine, aligned with industry practice
> in usage-based insurance (UBI) and smartphone telematics (Cambridge Mobile Telematics,
> Zendrive/Credit Karma, Geotab, Samsara, Damoov).

---

## 1. Why v1 needs to evolve

The v1 formula (`score = 100 − Σ event_count × fixed_penalty`) is simple and shippable, but has
five structural weaknesses that every serious telematics program has already solved:

| # | v1 weakness | Consequence |
|---|---|---|
| 1 | **Raw event counts, no exposure normalization** | A 200 km highway trip with 3 hard brakes scores *worse* than a 2 km trip with 2 — the opposite of actual risk. Industry standard is events **per 100 km**. |
| 2 | **Binary events, no severity** | A 0.31 g brake and a 0.75 g emergency stop both cost −5. Severity (peak g, duration, speed at event) is the strongest risk signal in the data. |
| 3 | **Linear penalty with hard clamp at 0** | After ~20 penalty points of events, additional bad behavior is free ("saturation cliff"). No gradient → no incentive to improve once you're bad. |
| 4 | **No speeding component** | At-risk speeding is one of the top two crash predictors (with phone distraction) in CMT's claims-correlation studies. v1 ignores it entirely. |
| 5 | **Trip score = driver score** | One bad trip whipsaws the user's profile. Industry uses recency-weighted rolling aggregation (e.g. 28-day window) plus a credibility prior for new drivers. |

v2 fixes all five while keeping the parts of v1 that work: the 0–100 scale, the logarithmic
distance factor, the Israeli-calendar risk multiplier, and the server-as-sole-oracle architecture.

---

## 2. Pipeline overview

```
 Raw telemetry (SDK)                                SERVER (sole oracle)
┌─────────────────────┐      ┌──────────────┐     ┌──────────────────┐
│ accel xyz @ ≥25 Hz  │      │ 1. EVENT     │     │ 4. COMPONENT     │
│ GPS speed + posted  │ ───► │   DETECTION  │ ──► │    SUBSCORES     │
│ limit (map-matched) │      │   + SEVERITY │     │  (exp. decay)    │
│ screen/touch state  │      └──────────────┘     └────────┬─────────┘
└─────────────────────┘      ┌──────────────┐              ▼
                             │ 2. LOW-SPEED │     ┌──────────────────┐
                             │    FILTER    │     │ 5. TRIP SCORE    │
                             └──────────────┘     │  (weighted sum)  │
                             ┌──────────────┐     └────────┬─────────┘
                             │ 3. EXPOSURE  │              ▼
                             │ NORMALIZATION│     ┌──────────────────┐
                             │  (per 100km) │     │ 6. DRIVER SCORE  │
                             └──────────────┘     │ (EWMA+credibility)│
                                                  └────────┬─────────┘
                                                           ▼
                                                  ┌──────────────────┐
                                                  │ 7. POINTS ENGINE │
                                                  └──────────────────┘
```

Stages 1–2 can run on-device (inside the Driving SDK) for real-time feedback;
stages 3–7 run **server-side only**, from raw event records. The client never
computes an authoritative score (consistent with the v1.5 oracle decision).

---

## 3. Stage 1 — Event detection with severity tiers

### 3.1 Kinematic events

Instead of one binary threshold per event type, v2 uses **tiered g-force thresholds**
(industry convention: ~0.3 g = harsh, ~0.45 g = severe, ~0.6 g+ = extreme; Geotab/Samsara
detect a second "abrupt" tier separately):

| Event | Axis | Tier 1 (moderate) | Tier 2 (severe) | Tier 3 (extreme) |
|---|---|---|---|---|
| Hard brake | longitudinal − | 0.30–0.44 g | 0.45–0.59 g | ≥ 0.60 g |
| Aggressive accel | longitudinal + | 0.27–0.39 g | 0.40–0.54 g | ≥ 0.55 g |
| Sharp turn | lateral | 0.35–0.49 g | 0.50–0.64 g | ≥ 0.65 g |

Each detected event is recorded with:

```
{ type, peak_g, duration_ms, speed_kmh_at_event, timestamp, lat, lng }
```

### 3.2 Continuous severity weight

Rather than counting tiers, each event gets a continuous severity weight — this removes
threshold-gaming ("brake at 0.29 g is free") and rewards smoothness everywhere:

```
severity(e) = g_factor × duration_factor × speed_factor

g_factor        = clamp((peak_g − g_min) / (g_max − g_min), 0, 1)^1.5 + 1
                  # 1.0 at threshold → 2.0 at extreme; superlinear in g

duration_factor = 1 + min(duration_ms / 2000, 0.5)
                  # sustained events up to +50%

speed_factor    = 1 + min(speed_kmh / 120, 1) × 0.5
                  # same maneuver at 100 km/h is worse than at 30 km/h
```

Per-type ranges: brakes `g_min=0.30, g_max=0.60`; accels `0.27–0.55`; turns `0.35–0.65`.
Weighted event count per type: `W_type = Σ severity(e)`.

### 3.3 Speeding (new in v2)

Speeding is measured **contextually** against the map-matched posted limit, as
*time-over-threshold* rather than discrete events:

```
For each GPS sample (1 Hz):
  over = speed − posted_limit
  band = none      if over < 10 km/h          # GPS noise / flow-of-traffic buffer
         minor     if 10 ≤ over < 20  (w=1)
         major     if 20 ≤ over < 30  (w=3)
         extreme   if over ≥ 30       (w=8)

W_speed = Σ band_weight × sample_duration_s / 60        # severity-weighted minutes
```

> **Dependency:** posted speed limits require a map-matching source (OpenStreetMap
> `maxspeed` via on-device tiles, or a snap-to-road API). Until that lands, the speeding
> component weight is redistributed to the other components (see §6) — the formula is
> forward-compatible.

### 3.4 Phone distraction (upgraded)

v1's "touch epochs + screen ratio" stays, but each interaction is weighted by vehicle speed
at the time — handling the phone at 90 km/h is categorically worse than at a red light:

```
For each touch epoch:
  w = 0                    if speed < 8 km/h        # standstill / crawling — ignore
      1 × speed_factor     otherwise

W_distraction = Σ w  +  (handheld_motion_detected ? 1.5 × per_event : 0)
```

`handheld_motion_detected` (phone physically picked up while driving, from IMU pattern) is
a CMT-style signal the SDK can add later; the formula accepts it from day one.

---

## 4. Stage 2 — Low-speed filter

All kinematic events at `speed < 5 km/h` are discarded (parking maneuvers, speed bumps,
phone drops). This is standard practice (Geotab, Motive) and eliminates the largest source
of false positives in smartphone telematics.

---

## 5. Stage 3 — Exposure normalization

Every weighted count is normalized to **per 100 km**, with a floor that prevents tiny trips
from producing absurd rates (1 brake in 0.5 km ≠ 200 brakes/100 km):

```
exposure_km = max(distance_km, 4)                  # minimum-exposure floor
R_type      = W_type × 100 / exposure_km           # severity-weighted rate per 100 km
```

For distraction, exposure is *time*, not distance:

```
R_distraction = W_distraction × 60 / max(duration_min, 5)    # per driving-hour
```

---

## 6. Stage 4+5 — Component subscores and composite trip score

### 6.1 Exponential decay subscores

Each component maps its rate to a 0–100 subscore via exponential decay — smooth, never
saturates, always leaves a gradient to improve:

```
subscore_c = 100 × exp(−k_c × R_c)
```

`k_c` is calibrated so that the **fleet median rate ≈ 80 points** and the
90th-percentile-worst rate ≈ 45 points. Initial values (to be recalibrated from real
CARMA data after 3 months — see §10):

| Component | k (initial) | Rate at score 80 | Rate at score 45 |
|---|---|---|---|
| Braking | 0.075 | 3.0 /100 km | 10.6 /100 km |
| Acceleration | 0.089 | 2.5 /100 km | 9.0 /100 km |
| Cornering | 0.064 | 3.5 /100 km | 12.5 /100 km |
| Speeding | 0.045 | 5.0 min-wt/100 km | 17.7 |
| Distraction | 0.112 | 2.0 /hour | 7.1 /hour |

### 6.2 Composite weights (crash-risk-aligned)

Weights follow the published risk hierarchy — phone distraction and speeding are the top
two crash predictors, then hard braking:

```
trip_score = 0.30 × S_distraction
           + 0.25 × S_speeding
           + 0.20 × S_braking
           + 0.15 × S_acceleration
           + 0.10 × S_cornering
```

**Until speed-limit data is available**, redistribute proportionally:
`distraction 0.40, braking 0.27, acceleration 0.20, cornering 0.13`.

### 6.3 Short-trip dampening

Trips under 2 km or 5 minutes get their score blended 50/50 with the driver's current
rolling score — too little exposure to judge.

---

## 7. Stage 6 — Driver score (new layer)

The driver-level score is a separate, persistent quantity — what the leaderboard, levels,
and any future insurance partner consume. Two mechanisms, both industry-standard:

### 7.1 Recency-weighted aggregation (EWMA over exposure)

Trips are aggregated with exponential time decay (half-life **14 days**, ≈ a 28-day
effective window — the rolling window used by major UBI scores), weighted by exposure:

```
driver_raw = Σ (trip_score_i × km_i × 0.5^(age_days_i / 14))
           / Σ (km_i × 0.5^(age_days_i / 14))
```

A bad trip fades in two weeks instead of haunting a lifetime average; a good streak shows
up quickly. Sustained behavior, not single trips, moves the number.

### 7.2 Credibility blending (cold start)

New drivers have too little data for a trustworthy score. Standard actuarial credibility:

```
credibility   = min(total_km_in_window / 300, 1)            # full credibility at 300 km
driver_score  = credibility × driver_raw + (1 − credibility) × 75   # prior = fleet median
```

A brand-new user starts at 75 ("good, unproven") rather than a meaningless 100 or
an unstable raw value. The prior updates yearly to the actual fleet median.

---

## 8. Stage 7 — Points engine

Points remain the gamification currency, decoupled from the score. v2 keeps the v1 skeleton
and adds two anti-grind/engagement mechanics:

```
points = trip_score_factor × distance_factor × risk_multiplier × streak_bonus

trip_score_factor = trip_score                       # unchanged scale
distance_factor   = log(distance_km + 1) / log(11)   # unchanged (1.0 at 10 km)
risk_multiplier   = unchanged from v1 (Israeli weekend nights ×2.0, weeknights ×1.5)
streak_bonus      = 1 + 0.05 × min(consecutive_days_with_score≥80, 5)   # up to ×1.25
```

**Anti-grind caps** (protects the rewards economy):

- Daily points cap: **300** (≈ 3 excellent 10 km night trips).
- Per-day distance counted toward points: max **150 km** (commercial drivers can't farm).
- Trips flagged by `FraudDetector` (transport-mode mismatch, impossible kinematics,
  GPS teleportation) earn **0 points** and are excluded from the driver score window.

---

## 9. Score display (unchanged)

Grade bands and colors stay identical to v1 (`excellent ≥ 90`, `good ≥ 75`, `fair ≥ 55`,
else `poor`) so existing UI code in `scoreToGrade` / `scoreToColor` is untouched. The app
shows **two numbers** from v2 onward: the trip score (per drive) and the driver score
(profile/leaderboard).

---

## 10. Calibration, versioning, rollout

1. **Parameters live server-side** in a versioned config table (spec Appendix C-VI already
   anticipates admin tuning endpoints). Every persisted trip records `scoring_version`.
2. **Shadow mode first:** run v2 alongside v1 for ≥ 4 weeks, persist both scores, compare
   distributions. No user-facing change until the v2 distribution is sane
   (median ≈ 80, no cliff at 0/100).
3. **Recalibrate `k_c`** from the shadow-period percentiles before activation.
4. **Switch points to v2** only at a level-season boundary, so nobody's balance jumps
   mid-progression.
5. The client SDK change (event severity capture, speed-at-event) ships before the server
   flips — old clients sending v1-shaped telemetry keep getting v1 scoring until they update
   (`scoring_version` negotiated per request).

---

## 11. What we deliberately did NOT adopt

Keeping the CARMA "simplicity is the advantage" principle, the following industry techniques
were evaluated and rejected for this version:

- **ML crash-probability models** (GBM / multilevel claims models): need claims data we don't
  have; opaque to users; revisit only if an insurance partnership materializes.
- **Bayesian network driver profiles** (per the TrueMotion/Allstate patents): heavy
  machinery for marginal gain at our scale; EWMA + credibility achieves 90% of the benefit
  in 10 lines of code.
- **Road-type / weather context multipliers:** real signal, but each adds an external data
  dependency. Deferred until map-matching (needed anyway for speeding) is in place.

---

## 12. File impact map (when implemented)

| File | Change |
|---|---|
| `server/app/services/scoring.py` | Rewrite: stages 3–7, parameter table, `scoring_version` |
| `server/app/models/` | `Event`: add `peak_g`, `duration_ms`, `speed_kmh`; `User`: add `driver_score`; new `ScoringConfig` |
| `mobile/src/lib/driving-sdk/SensorManager.ts` | Tiered thresholds, severity capture, low-speed filter (generic — belongs in SDK) |
| `mobile/src/lib/scoring.ts` | Mirror stages 1–5 for local real-time preview only |
| `mobile/src/lib/FraudDetector.ts` | Emit exclusion flag consumed by points engine |
| `mobile/src/types/index.ts` | Regenerate after server schema change (`npm run gen:api`) |

---

## 13. Implementation status

**Implemented and live:**

| Piece | File |
|---|---|
| Stages 3–7 as pure functions (exposure normalization, exp-decay subscores, composite weights, EWMA+credibility driver score, points engine with anti-grind caps) | `server/app/services/scoring_v2.py` |
| Continuous severity weight `event_severity()` (§3.2) — implemented and unit-tested, **dormant** until the SDK emits per-event `peak_g`/`duration`/`speed` | `server/app/services/scoring_v2.py` |
| v2 is sole engine: trip score, driver score, and points written by `_compute_v2()`; no v1 fallback | `server/app/services/trips.py` |
| DB columns: `trips.score_v2`, `trips.scoring_version`, `users.driver_score` | migration `a1c2e3f4d5b6` |
| Unit tests for every stage | `server/tests/test_scoring_v2.py` |

**Current approximations (upstream signals not yet available — see [scoring-v2-handoff.md](scoring-v2-handoff.md)):**

- **Severity:** weighted counts collapse to raw counts (each event weight 1.0). The
  moment the SDK provides per-event severity, the trips service sums `event_severity()`
  instead of counting — no downstream change.
- **Speeding:** `has_speed_data=False`, so the speeding weight is redistributed (§6.2).
  Needs map-matching.
- **Distraction:** weighted as `touch_epochs + screen_seconds/60` (per-epoch speed
  weighting from §3.4 awaits the SDK).

**Not implemented yet (blocked on other owners — see [scoring-v2-handoff.md](scoring-v2-handoff.md)):**

- SDK: tiered thresholds, severity capture, low-speed filter, speed-at-event. *(SDK owner)*
- Mobile UI: surfacing the second number (driver score) alongside the trip score. *(Mai)*
- `mobile/src/lib/scoring.ts` real-time preview mirror — kept on v1 deliberately; it
  depends on SDK severity data, and per the §10.5 rollout order the SDK ships first.
- Speeding component: map-matching / posted-limit source.
- Calibration of `k_c` decay constants from real data — deferred (see [scoring-v2-calibration-status.md](scoring-v2-calibration-status.md)).

---

## Sources

Industry methodology research behind this design:

- [Cambridge Mobile Telematics — How the DriveWell platform works](https://www.cmtelematics.com/safe-driving-technology/how-it-works/)
- [CMT × TransUnion — portable driving scores (28-day rolling window)](https://beinsure.com/news/cambridge-mobile-telematics-portable-driving-scores/)
- [CMT study — Motivating Safer Driving with Telematics (PDF)](https://m.cmtelematics.com/hubfs/CMT%20Study%20-%20UBI%20Engagement%20Impact.pdf)
- [Geotab — What is g-force and how is it related to harsh driving?](https://www.geotab.com/blog/what-is-g-force/)
- [Samsara — Harsh event detection](https://kb.samsara.com/hc/en-us/articles/5321169919501-Harsh-Event-Detection)
- [Motive — Harsh driving detection (low-speed filtering)](https://helpcenter.gomotive.com/hc/en-us/articles/31054170471837-Harsh-Driving)
- [Damoov — Safety score documentation](https://docs.damoov.com/docs/safety-score)
- [Journal of Big Data — Survey on driving behavior analysis in usage-based insurance](https://journalofbigdata.springeropen.com/articles/10.1186/s40537-019-0249-5)
- [arXiv — Can Telematics Improve Driving Style? Behavioural data in motor insurance](https://arxiv.org/pdf/2309.02814)
- [arXiv — Nightly automobile claims prediction from telematics-derived features](https://arxiv.org/pdf/2205.04616)
- [American Academy of Actuaries — Toward the regulatory adequacy of usage-based insurance](https://actuary.org/article/toward-the-regulatory-adequacy-of-usage-based-insurance/)
- [USPTO — Two-stage Bayesian networks for portable driving scores (patent 10,210,479)](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/10210479)

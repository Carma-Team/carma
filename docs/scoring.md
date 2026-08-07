# How the CARMA Score Works

**Target architecture and product specification.**

This document defines the CARMA scoring system: what it measures, how a trip becomes a number, and how that number drives the rewards economy.

Every trip is stamped with the version of the formula that scored it, in `trips.scoring_version`. Old trips keep their original score and stamp, so a score from any past month stays readable. That stamp is the only purpose of the version number.

Reference implementation: [`server/app/services/scoring.py`](../server/app/services/scoring.py).

---

## 1. Core Purpose

### What the score measures

A CARMA trip score is a number from **0 to 100** that rates one drive on five behaviours:

| # | Behaviour | Weight |
|---|---|---|
| 1 | Phone distraction | 0.30 |
| 2 | Speeding | 0.25 |
| 3 | Hard braking | 0.20 |
| 4 | Aggressive acceleration | 0.15 |
| 5 | Sharp cornering | 0.10 |

These are the same five behaviours Cambridge Mobile Telematics (CMT) measures in DriveWell, using the same units. Matching the industry method means our numbers can be compared against a published baseline.

### Design principles

- **Rates, not totals.** Three hard brakes over 200 km is good driving. Three over 2 km is not. Every measurement is normalised per 100 km or per driving hour, so a long trip is never punished for being long.
- **The server decides.** The phone collects sensor data and may show a live preview. Only the server produces a real score.
- **Counts only move up.** Where the phone and the server disagree, the higher count wins. This is a one-way anti-fraud rule.
- **Improvement always pays.** The scoring curve never reaches zero, so even a low-scoring driver gains from driving better.

### What the score is for

**Built for:** driver feedback, the leaderboard, the level ladder, and the rewards economy.

**Not built for:** insurance pricing, underwriting, employment or fleet-hiring decisions, or any use with a legal or financial consequence for a person. The score has not been validated against crash or claim data.

**Valid input range:** private cars, Israeli roads, a phone carried or mounted inside the vehicle, and trips that clear the distance and time floors with a GPS trace dense enough to measure. Outside that range — motorcycles, commercial fleets, a phone left at home, a trip through a tunnel — the score is uninformed rather than wrong, and it does not flag this on its face.

---

## 2. System Architecture & Data Flow

### The journey from phone to score

```
   Phone                            Server
┌───────────────┐        ┌──────────────────────────────┐
│ accelerometer │        │ 1. Re-detect events from GPS │
│ gyroscope     │  ───►  │ 2. Drop low-speed events     │
│ GPS trace     │        │ 3. Convert to rates          │
│ phone handling│        │ 4. Rate → subscore           │
└───────────────┘        │ 5. Blend the five            │
                         │ 6. Cap by trace confidence   │
                         │ 7. Update driver score       │
                         │ 8. Award points              │
                         └──────────────────────────────┘
```

### What the phone sends

The phone uploads two things per trip:

1. **A signed telemetry digest.** Event counts, severities, distraction seconds, and distance. This is the input to the score. The signature is what makes it trustworthy.
2. **A waypoint trace.** The GPS path, thinned to one point every 5 seconds. The server uses it to re-detect events independently and to verify the claimed distance.

Anything that feeds the score travels inside the signed digest. Unsigned data is stored for diagnostics and never scored.

### Two detectors, one result

Events are detected twice — once on the phone in real time, once on the server from the waypoint trace.

- The phone sees a denser stream and catches short events the thinned trace misses.
- The server sees a verified trace and cannot be influenced by a modified client.
- The final count for each event type is `max(phone, server)`.

### Trip boundaries

- A trip **starts** when sustained vehicle movement is detected.
- A trip **ends** after 3 minutes continuously below 10 km/h.
- Trips below **4 km or 5 minutes** are scored, but softly (see §3.6).

---

## 3. The Scoring Engine

### 3.1 Phone distraction — weight 0.30

Distraction is measured in **seconds of phone use per driving hour**, counted only while the vehicle is moving **above 15 km/h**. A red light, a traffic jam, or the stationary tail at the end of a trip costs nothing.

Two separate counters feed it, matching CMT's two published metrics:

| Counter | What it counts | How it is detected |
|---|---|---|
| **Screen interaction** | Typing, tapping, using apps | Foreground and background app interaction, confirmed by IMU movement |
| **Phone motion** | Physically handling the device | Accelerometer variance above **0.025 g²** over a 1-second window |

The counters are **mutually exclusive**. A second already counted as screen interaction is not counted again as phone motion, so a driver typing while holding the phone is charged once.

```
distraction rate = (screen_interaction_seconds + phone_motion_seconds)
                 / driving_hours_above_15_kmh
```

**Reference baseline (CMT, US average 2024):**

| Metric | Average per driving hour |
|---|---|
| Screen interaction | 1 min 56 s |
| Phone motion | 1 min 22 s |

Our measured population averages should land in the same region. A large gap indicates a sensor problem, not a fleet of unusually good or bad drivers.

**Design decisions:**

| Decision | Reason |
|---|---|
| Count time, not taps | "What is one tap?" has no answer — typing a message is dozens. Counting seconds removes the question. |
| Holding without touching counts | The hand and the eyes are the risk, not the tap. |
| Below 15 km/h is free | Stopped traffic is not distracted driving. |
| Screen-lock state is ignored | Android exposes it, iOS does not. Using it would score the same behaviour differently on two phones. |

### 3.2 Speeding — weight 0.25

Speeding measures **time spent over the limit, weighted by how far over** — not a count of incidents.

| How far over the limit | Weight |
|---|---|
| Under 10 km/h | Ignored — GPS noise and normal traffic flow |
| 10–19 km/h | ×1 |
| 20–29 km/h | ×3 |
| 30 km/h and above | ×8 |

The limit is the road's **posted speed limit** where map data covers the road. Where it does not, the system falls back to a flat **120 km/h** national maximum. With the 10 km/h buffer, the fallback only charges sustained speed above 130 km/h.

### 3.3 Harsh events — braking, acceleration, cornering

All three are detected from **GPS dynamics**: change in speed over time, and speed multiplied by rate of heading change. The accelerometer cross-confirms that a real horizontal force occurred and refines the severity. It is a witness, not the trigger.

This is orientation-free by design. A phone in a vent clip, a cup holder or a pocket points its axes in an unknown direction, so no fixed accelerometer axis can be trusted. Speed change and heading change do not care how the phone is held.

**Detection thresholds:**

| Event | Phone triggers at | Server triggers at (from the waypoint trace) |
|---|---|---|
| Hard brake | GPS deceleration **2.7 m/s²** (~0.28 g) | **3.0 m/s²** sustained deceleration |
| Aggressive acceleration | GPS acceleration **3.0 m/s²** (~0.31 g) | **2.5 m/s²** |
| Sharp turn | speed × turn rate ≥ **3.5 m/s²** (~0.36 g) | **18°/s** bearing change |

The phone averages over a window of at least **1.5 seconds**. The two sides use different thresholds because they see data at different densities; the merge rule (`max`) resolves the difference.

**Low-speed floors.** Events below these speeds are discarded on both sides. This removes parking manoeuvres, speed bumps and a dropped phone — the largest source of false alarms in phone-based telematics.

| Event | Minimum speed |
|---|---|
| Hard brake | 15 km/h |
| Aggressive acceleration | 15 km/h |
| Sharp turn | 25 km/h |

### 3.4 Event severity

Events are **not** counted equally. An emergency stop costs more than a firm tap on the brakes, on a smooth curve, so there is no threshold to game.

Every event carries its **peak g-force**, **duration**, and the **speed** at which it occurred. These produce a severity weight:

```
g_norm          = clamp((peak_g − g_min) / (g_max − g_min), 0, 1)
g_factor        = g_norm^1.5 + 1.0
duration_factor = 1.0 + min(duration_ms / 2000, 0.5)
speed_factor    = 1.0 + min(speed_kmh / 120, 1.0) × 0.5

severity = g_factor × duration_factor × speed_factor
```

**Severity ranges by event type:**

| Event | g_min | g_max |
|---|---|---|
| Braking | 0.30 g | 0.60 g |
| Acceleration | 0.27 g | 0.55 g |
| Cornering | 0.35 g | 0.65 g |

Severity runs from **1.0** at the detection threshold to about **3.0** for an extreme, sustained, high-speed event. The engine sums severities instead of counting events.

### 3.5 Rates and subscores

**Exposure normalisation:**

| Measure | Divided by | Floor |
|---|---|---|
| Braking, acceleration, cornering, speeding | 100 km | 4 km |
| Distraction | Driving hour | 5 minutes |

The floors prevent very short trips from exploding. Without them, one brake in a 500 m trip reads as 200 brakes per 100 km.

**Rate to subscore.** Each of the five components produces its own 0–100 subscore:

```
subscore = 100 × exp(−k × rate)
```

| Component | k |
|---|---|
| Braking | 0.018 |
| Acceleration | 0.022 |
| Cornering | 0.012 |
| Speeding | 0.012 |
| Distraction | 0.020 |

The exponential curve never reaches zero and never flattens. There is always something to gain by improving, including for a driver scoring badly. A straight-line penalty stops mattering once a driver is bad enough, which removes the incentive exactly where it is needed most.

### 3.6 Blending the five

```
trip score = 0.30 × distraction
           + 0.25 × speeding
           + 0.20 × braking
           + 0.15 × acceleration
           + 0.10 × cornering
```

**When the trace cannot support speed measurement**, speeding drops out and its 0.25 is redistributed across the other four:

| Component | Weight without speeding |
|---|---|
| Distraction | 0.40 |
| Braking | 0.27 |
| Acceleration | 0.20 |
| Cornering | 0.13 |

This is decided **per trip**. A trip qualifies for speeding only with at least **20 waypoints**, covering at least **half its duration**, at a **median gap of 10 seconds or less**. A phone whose location updates are throttled fails this test and is scored on four components. GPS cadence is therefore a scoring concern, not only a battery one.

### 3.7 Final adjustments

| Adjustment | Effect |
|---|---|
| **Short trips are judged gently** | Under 2 km or 5 minutes, the trip score is blended half-and-half with the driver's standing score. Too little happened to draw a conclusion. |
| **Weak GPS caps the upside only** | A sparse or gappy trace stops a trip scoring far above the driver's rolling average. Reported events still count in full. A weak signal must not let a bad trip look good, and must not invent a good one. |
| **Claimed distance is verified** | The server integrates the GPS trace and rejects a distance claim more than **35%** above what the trace witnesses. Distance multiplies points directly, so it needs an independent check. |

---

## 4. Gamification & Economy

### 4.1 The driver score

The trip score rates one drive. The **driver score** is the persistent number the leaderboard and the level ladder are built on.

- **Recent trips matter more.** Trips are averaged with a **14-day half-life**, weighted by distance — an effective window of about 28 days, matching the rolling window CMT uses for portable driver scores. A bad trip fades in roughly two weeks instead of haunting a lifetime average.
- **New drivers start at 75.** With too few trips there is too little evidence, so the number is blended toward a starting assumption of 75 — "good, unproven" — reaching full confidence at **300 km**.

### 4.2 Levels

The driver score caps the level a driver is shown. `total_points` only ever climbs, so without a cap a driver who reached level 8 and then drove badly would display level 8 forever.

| Driver score | Maximum level shown |
|---|---|
| 80+ | 10 (no effective cap) |
| 70–79 | 8 |
| 60–69 | 6 |
| 50–59 | 4 |
| Under 50 | 2 |

Nothing is destroyed. When the driver score recovers, the earned level returns with no points to re-accumulate.

### 4.3 Points

Points are the game currency and deliberately **not** the score.

```
points = trip score
       × distance factor    (log scale — 1.0 at 10 km)
       × risk multiplier    (Israeli weekend nights ×2.0, weeknights ×1.5)
       × streak bonus       (+5% per consecutive day with a trip, up to ×1.25)
       × level bonus        (the level entering the trip — ×1.00 to ×2.00)
                            ↓
                     then clipped by the limits below
```

The level bonus sits **inside** the formula, before clipping. The level changes how fast a driver reaches the ceiling; it never raises the ceiling itself. This matches tiered loyalty practice — per-tier earn rates under one flat ceiling.

### 4.4 Economic limits

| Limit | Value | Purpose |
|---|---|---|
| **Monthly cap** | 3,000 points per rolling 30 days | The economic ceiling — what the catalogue will pay one driver. At roughly ₪0.10 a point, that is ₪300 a month. Rolling rather than calendar, because a reset date is a farming date. |
| **Daily cap** | 500 points per day | A rate limiter, not a second economic ceiling. It sits above every honest driving pattern (an ordinary commute at level 10 is ~240 points, a Friday night out ~285, an 80 km day ~310) and exists only so a bug or an exploit cannot drain a month in an afternoon. |
| **Daily distance cap** | 150 km counted toward points | A delivery driver cannot farm the system. |
| **Fraud exclusion** | Zero points | Fraudulent trips earn nothing and are excluded from the driver score entirely: transport-mode mismatch, impossible physics, GPS jumps. |

---

## 5. Known Limitations & Edge Cases

### Measurement limits

- **Phone touches cannot be seen directly.** No app can observe touches delivered to another app, on either platform. Handling is inferred from how the device moves.
- **A phone typed on in a fixed mount is invisible.** Detection looks for the phone moving; a phone clamped to a mount moves with the car. This matters more in Israel than in the US, because regulation 28(b) bans texting whether the phone is mounted or not. The alternative signal — screen state — is exposed only by Android, which would create a blind spot for half the user base instead of a shared one.
- **A phone loose on a seat can read as a phone in a hand.** A sliding phone produces variance similar to handling.
- **No GPS speed means no harsh events.** Both detectors trigger on GPS, so a tunnel, a parking garage or a street of tall buildings blinds both at once. Distance and distraction keep working; braking, acceleration and cornering do not.

### Calibration limits

- **The decay constants are provisional.** They are fitted to a small trip sample — enough to produce a working curve, not enough to call settled. A proper fit needs roughly 200 trips with severity data.
- **Subscores use a fixed curve, not the driver population.** Scoring each component as a percentile against the fleet is the stronger method and requires a fleet distribution large enough to be stable.
- **The level thresholds are a first calibration**, not fitted to real fleet behaviour.
- **The component weights are not derived from crash data.** They reflect the published direction of risk — distraction highest — but not a measured ratio. CMT does not publish its own weights.

### Scoring edge cases

- **A throttled phone is scored on four components, not five.** Some Android handsets defer location updates hard enough that the trace cannot support speed measurement. That trip loses speeding and has its upside capped. Nobody is penalised, but two drivers can be scored by different formulas on the same drive.
- **Speeding accuracy depends on map coverage.** On a road with no posted-limit data, only sustained speed above 130 km/h is charged.
- **The streak bonus rewards showing up, not driving well.** It counts consecutive days with any trip, at any score.
- **The score has never been validated against crash or claim data.** The method matches the industry leader, which makes the numbers comparable to theirs. It does not make them validated. Validation requires claims data.

---

## References

**Cambridge Mobile Telematics — the primary method reference:**

- [How the DriveWell platform works](https://www.cmtelematics.com/safe-driving-technology/how-it-works/)
- [DriveWell programme FAQ (MoDOT)](https://www.modot.org/sites/default/files/documents/MO%20Drivewell%20FAQs.pdf) — the five components, and percentile scoring against the driver population over a two-week window
- [Distracted driving fell 8.6% in 2024](https://www.cmtelematics.com/news/distracted-driving-fell-8-6-in-2024-preventing-an-estimated-105000-crashes-and-480-fatalities/) — the screen-interaction and phone-motion baselines
- [Rising phone distraction calls for new methods of measurement](https://www.cmtelematics.com/blog/rising-phone-distraction-calls-for-new-methods-of-measurement/)
- [Portable driving scores with TransUnion](https://beinsure.com/news/cambridge-mobile-telematics-portable-driving-scores/) — the 28-day rolling window
- [Patent 11,485,369 — determining, scoring and reporting phone distraction](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11485369)
- [Patent 9,228,836 — inferring vehicle trajectory from an arbitrarily-oriented phone](https://patents.google.com/patent/US9228836B2/en)
- [GHSA + CMT — distraction raises crash risk by 240%](https://www.ghsa.org/news/distracted-driving-raises-crash-risk-240-percent) — note the units: 240% is crash likelihood for the most distracted drivers, while the 103% braking and 71% speeding figures are expected losses

**Harsh-event detection and thresholds — industry-wide:**

- [Geotab — what g-force means for harsh driving](https://www.geotab.com/blog/what-is-g-force/) — thresholds for a fixed-orientation device
- [Smartphone-based hard-braking event detection at scale](https://arxiv.org/abs/2202.01934) — a fused model scores 0.83 PR-AUC, 3.8× a GPS-speed heuristic and 166.6× an accelerometer-only heuristic
- [Damoov — safety score documentation](https://docs.damoov.com/docs/safety-score)
- [American Academy of Actuaries — regulatory adequacy of usage-based insurance](https://actuary.org/article/toward-the-regulatory-adequacy-of-usage-based-insurance/)

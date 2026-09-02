# How the CARMA Score Works

**Target architecture.**

This document defines the CARMA scoring system: what it measures, how a trip becomes a number, and how that number drives the rewards economy.

Every trip is stamped with the version of the formula that scored it, in `trips.scoring_version`. Old trips keep their original score and stamp, so a score from any past month stays readable. That stamp is the only purpose of the version number: it is forensic, nothing reads it back into a computation.

The version is a flat `<year>-<month>-<subject>` identifier, not semver — semver's compatibility contract has no meaning for a scoring formula. It changes whenever the same input would score differently, and the subject names what changed (`2026-08-posted-limit`, not a number bump).

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
2. **A waypoint trace.** The GPS path, one point every **2 seconds**. The server uses it to re-detect events independently and to verify the claimed distance.

#### Why the cadence is 2 seconds

The cadence is not a payload preference — it is fixed by the threshold it has to catch. The server detects braking as the *average* deceleration between two consecutive points, so the sampling interval is the denominator of the physics:

```
decel = (speed_prev - speed_cur) / 3.6 / dt
```

A detection at the 3.0 m/s² threshold therefore needs a speed drop between two consecutive points of:

| Cadence | Required drop |
|---|---|
| 6 s | 65 km/h |
| 5 s | 54 km/h |
| 4 s | 43 km/h |
| **2 s** | **22 km/h** |

A real hard brake is about 3.5 m/s² sustained for about two seconds — a drop of roughly 25 km/h. Averaged over a 6-second gap, four of those seconds contain nothing, the event reads 1.2 m/s², and it is never detected. **The sampling interval must not exceed the event it has to measure.** A hard brake lasts ~2 s, so the cadence is 2 s. Sharp turns follow the same rule — bearing rate divides by the same `dt`.

The phone already requests a GPS fix every 2 seconds and pays that battery cost today, so this costs no power — only payload. A 30-minute trip carries ~900 points (~68 KB), against DriveQuant's ~150 KB at 1 Hz for the same trip.

**Full confidence is granted at 2.5 s, not at 2 s.** That is the ceiling of the same arithmetic: the widest median gap at which a 2 s brake at 3.75 m/s² still averages to the 3.0 m/s² threshold (2 × 3.75 / 3.0). The target sits below the ceiling so a device that complies with this spec is never penalised for ordinary jitter.

Anything that feeds the score travels inside the signed digest. Unsigned data is stored for diagnostics and never scored.

### Two detectors, one result

Events are detected twice — once on the phone in real time, once on the server from the waypoint trace.

- The phone sees a denser stream and catches events shorter than the 2-second trace can resolve.
- The server sees a verified trace and cannot be influenced by a modified client.
- The final count for each event type is `max(phone, server)`.

### Trip boundaries

- A trip **starts** when sustained vehicle movement is detected.
- A trip **ends** after 3 minutes continuously below 10 km/h.
- Trips below **4 km or 5 minutes** are scored, but softly (see §3.6).

---

## 3. The Scoring Engine

### 3.1 Phone distraction — weight 0.30

We measure **distraction by the phone, not contact with it.** A tap is not the unit. A hand off the wheel and eyes off the road is.

Two counters, matching CMT's two published metrics. Both count only while the vehicle is moving **above 15 km/h** — a red light, a traffic jam, or the stationary tail at the end of a trip costs nothing.

| Counter | What it counts | How it is detected |
|---|---|---|
| **Screen interaction** | Typing, tapping, scrolling | A rhythmic **pattern** of gyroscope peaks. Tapping a screen produces taps in a cadence; that cadence is the signature, not the force of any one of them. |
| **Phone motion** | Holding and handling the device | Gyroscope variance over a 1-second window. A handled phone rotates unlike any fixed placement, and the variance is what separates the two. |

The counters are **mutually exclusive**. Each second is assigned to one or the other, never both, so a driver typing while holding the phone is charged once.

```
distraction rate = (screen_interaction_seconds + phone_motion_seconds)
                 / driving_hours_above_15_kmh
```

**The denominator.** Driving hours come from the GPS trace, under three rules:

- **A segment between two fixes counts by the mean of its two speeds**, not by the closing one. Letting the last fix decide zeroes any segment whose closing fix happens to land below 15 km/h, so a minute of identical stop-and-go driving was worth anywhere between a full minute and nothing — depending only on when the fixes came back. Tightening the cadence to 2 seconds shrinks each misallocated segment; it does not remove the bias, so the mean rule stays.
- **Time the trace never saw is credited as driving.** The counters are whole-trip totals, so a denominator drawn only from what the GPS witnessed would charge every handling second against a trace that may have died after five minutes of a 45-minute drive. Crediting the unwitnessed remainder errs in the driver's favour, which is the direction to err when speed data is missing.
- **It never falls below 5 minutes.** A two-minute drive with fifteen seconds of handling is not a 7.5-minute-per-hour driver, it is a short drive. Small exposure must not produce a large rate. At the driver level the same job is done by weighting each trip by its distance, so one short trip moves the CARMA Score very little either way.

**Reference baselines (CMT, US average 2024). Each counter is checked against its own:**

| Counter | Average per driving hour |
|---|---|
| Screen interaction | 1 min 56 s |
| Phone motion | 1 min 22 s |

Our measured population averages should land in the same region, counter by counter. Collapsing them into a single figure and comparing that against a combined total would hide which of the two detectors drifted — separating them is the whole diagnostic value. A large gap on one indicates a sensor problem in that detector, not a fleet of unusually good or bad drivers.

**Design decisions:**

| Decision | Reason |
|---|---|
| Holding without touching counts | The hand and the eyes are the risk, not the tap. |
| Below 15 km/h is free | Stopped traffic is not distracted driving. |
| Screen state is not required by either counter | iOS exposes no screen state to a backgrounded app, so a detector that depended on it would measure nothing on every iPhone. CMT's patent treats it as one optional corroborator — "screen state **and/or** phone-lock state" — never as the discriminator. |
| The gyroscope decides both counters, not the accelerometer | CMT's placement study tested accelerometer variance and published it as a negative result: most of that variance is vehicle dynamics, not hands. The same sensor separates both metrics — a *pattern* of peaks is typing, a sustained *variance* is holding. |
| Taps are counted as seconds, not as events | "What is one tap?" has no answer — typing a message is dozens. And a single-sample force threshold cannot separate a finger from a pothole at any value, which is why counting individual taps was abandoned. The cadence can; a single sample cannot. |

### 3.2 Speeding — weight 0.25

Speeding measures **the share of a trip's distance driven above the limit, weighted by how far above** - not a count of incidents, and not minutes.

```
speeding ratio = SUM(distance in band x band weight)
                 ───────────────────────────────────
                        distance we can judge
```

Distance rather than time, because a car covers less ground per minute of speeding in a 50 zone than on a motorway. Charged by time, the identical offence costs a city driver roughly twice what it costs a motorway driver. The ratio carries its own exposure and is not divided by kilometres again.

| How far over the limit | Weight |
|---|---|
| Inside the buffer | Ignored |
| Buffer to 19 km/h over | x1 |
| 20-29 km/h over | x3 |
| 30 km/h and above | x8 |

The ratio therefore runs from 0 to 8, not 0 to 1: 1.0 is a whole trip spent just over the buffer, and 8.0 is a whole trip spent 30 or more over. Without the bands, 65 km/h and 95 km/h in a 50 zone cost a driver exactly the same per kilometre, which is not something a safety score should say.

**The buffer is 10% of the limit, with a floor of 5 km/h.** A flat 10 km/h was 20% of a 50 zone and 9% of a 110 one, so the same allowance meant "well over" in town and "barely moving" on a motorway. The 5 km/h floor is the margin Israeli traffic cameras subtract from every measured speed; below it we would be charging for what the enforcement system itself treats as noise.

| Limit | Speeding starts above |
|---|---|
| 50 | 55 |
| 80 | 88 |
| 110 | 121 |

**The limit is the road's posted speed limit.** It comes from an OpenStreetMap extract loaded into `road_segments`, resolved in three steps:

| Step | Source | Covers |
|---|---|---|
| 1 | The road's explicit `maxspeed` tag | 38,718 roads |
| 2 | 50 km/h where more than half an untagged `secondary`, `tertiary` or `unclassified` road's length lies inside a built-up area | 34,747 roads |
| 3 | Israel's statutory default for the road's class | the rest |

Step 2 is not a refinement, it is the difference between the component working in a city and not. Israeli law sets the limit by built-up area rather than by road class, so the same untagged `tertiary` is 50 inside a town and 80 outside it. Taking 80 everywhere read Dizengoff in Tel Aviv as an 80 zone, which scores 90 km/h down it as clean driving - the exact blindness this component exists to remove. Motorway, trunk and primary are deliberately never demoted: those keep a high limit through a city, and demoting them would invent offences on the roads where speed is legitimately highest.

**Every remaining ambiguity resolves in the driver's favour.** The nearest road wins; where others run within 8 m of it - a service road beside a motorway, the far carriageway of a divided road - the highest limit among them wins. Where a segment spans two limits, the higher one judges it. Under-charging a real offence is recoverable; charging a driver for an offence they did not commit is not.

**Where the map cannot answer**, a flat 120 km/h national maximum applies, so egregious motorway speeding is still charged off the map. But a trip with a mapped limit for **less than half** its judged distance does not get scored on speeding at all - see "Blending the five". Scoring a whole urban drive against a 130 km/h threshold does not measure speeding; it hands out a free component.

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

Every event carries its **peak acceleration**. This produces a severity weight, force alone:

```
g_norm   = clamp((peak_g − g_min) / (g_max − g_min), 0, 1)
severity = g_norm^1.5 × 2.0 + 1.0
```

Duration is not a severity input. No comparable product weights harsh-event severity by duration: DriveQuant's event payload carries no duration field, Digital Matter uses duration only as a detection-level noise filter (a force spike must persist to count as an event, but does not scale the score), and CMT's published patents decompose severity into force components with no duration term. Event duration remains available in the SDK payload for that kind of noise-filtering at the detection layer — it is simply not a term in the severity curve.

**Severity ranges by event type:**

| Event | Axis measured | g_min | g_max |
|---|---|---|---|
| Braking | Longitudinal (deceleration) | 0.30 g | 0.60 g |
| Acceleration | Longitudinal | 0.27 g | 0.55 g |
| Cornering | Lateral | 0.35 g | 0.65 g |

Severity runs from **1.0** at the detection threshold to **3.0** for an extreme event. The engine sums severities instead of counting events.

**One axis, whoever detected the event.** The stored `events.severity` column is always on this 1.0-3.0 scale, and a phone-detected event is weighed by the curve above exactly as a server-detected one is. The floor matters: severity is a multiplicative weight, so an event landing exactly on the detection threshold must still be worth one event, never zero.

**Speed is not a severity input.** Speed is already scored as its own component at weight 0.25. Multiplying event severity by speed as well would charge the same behaviour twice.

> **Required input format — `peak_g` must be a single axis in the vehicle's frame of reference.**
>
> The ranges above are calibrated for isolated longitudinal deceleration (braking, acceleration) and isolated lateral acceleration (cornering), measured relative to the vehicle, not the phone.
>
> Passing raw accelerometer magnitude, or any horizontal magnitude taken in the phone's own frame, breaks this curve. Two failures follow:
>
> - **The value carries gravity, road vibration and phone movement**, none of which are vehicle dynamics. It is not the quantity the curve maps.
> - **Detection accepts events from 0.10 g while the curve starts at 0.30 g.** Every event below the range clamps to `g_norm = 0`, so the entire population collapses onto the minimum severity of 1.0 and the curve does nothing.
>
> A phone at an unknown orientation cannot supply this value without a phone-to-vehicle rotation step. Until that step exists, the correct behaviour is to send no severity at all and let the engine count events — not to send an uncorrected magnitude.

### 3.5 Rates and subscores

**Exposure normalisation:**

| Measure | Divided by | Floor |
|---|---|---|
| Braking, acceleration, cornering | 100 km | 4 km |
| Distraction | Driving hour | 5 minutes |
| Speeding | Its own judged distance | - |

The floors prevent very short trips from exploding. Without them, one brake in a 500 m trip reads as 200 brakes per 100 km.

**Rate to subscore.** Each of the five components produces its own 0–100 subscore:

```
subscore = 100 × exp(−k × rate)
```

| Component | k |
|---|---|
| Braking | 0.018 ⚠️ |
| Acceleration | 0.022 ⚠️ |
| Cornering | 0.012 ⚠️ |
| Speeding | 0.05 ⚠️ |
| Distraction | 0.0035 |

Distraction carries no warning. It was never an event count — it has always been seconds per driving hour — and its constant is fitted against CMT's published US average rather than against our own detector. Two anchors nobody can re-derive from the curve: a driver at the US average of 82 seconds per driving hour scores 75, and the subscore reaches 50 at roughly 198.

> ⚠️ **The marked constants are legacy placeholders. They must be re-fitted before release.**
>
> They were fitted against **event counts**, where every event contributes exactly 1.0. The engine now sums **severities**, where every event contributes between 1.0 and 3.0.
>
> The harsh-event rates therefore rise by a factor of roughly 1.5–2× for identical driving. Applied to `exp(−k × rate)`, the existing constants push every score down across the whole population, with no change in behaviour behind it.
>
> The same applies to any change in detection sensitivity. Because the curve is fixed rather than population-relative, the constants are tied to the detector that produced the fit — a new threshold, a new SDK version, or a shift in the handset mix all invalidate them.
>
> **Re-fit conditions:** a minimum of 200 trips, recorded with severity-capable detection, on the detector configuration intended for release.

The exponential curve never reaches zero and never flattens. There is always something to gain by improving, including for a driver scoring badly. A straight-line penalty stops mattering once a driver is bad enough, which removes the incentive exactly where it is needed most.

**The weakest factor.** The trip-completion response names the one behaviour the driver should fix, as `weakestFactor` — one of `braking`, `acceleration`, `cornering`, `speeding`, `distraction`, or `null`. It is not the lowest subscore: it is the subscore whose **weighted loss**, `weight × (100 − subscore)`, is largest — on a full-length trip, the exact amount the trip score would rise if that one behaviour were perfect. On a short trip (§3.7's 50/50 blend with the driver's rolling standing), the ranking is unaffected but that exact-amount reading no longer holds. A heavily-weighted behaviour scoring a little low can cost more than a lightly-weighted one scoring a lot low, and the composite already prices that trade-off, so the named factor prices it the same way. Speeding is never named on a trip that fell back to the four-component blend (§3.6) — its subscore carries no weight there, so naming it would blame a behaviour the trip was never scored on. Nothing is named when every candidate's subscore is above 90: at that point the driver has no weak behaviours, and naming one would read as a complaint about nothing. The five subscores themselves stay server-side; only the name of the winner crosses the wire, so the ranking cannot drift between app versions. The sentence shown to the driver is client copy, not server text.

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

This is decided **per trip**, and a trip has to pass two separate tests to keep speeding.

**The trace has to be measurable**: at least **20 waypoints**, covering at least **half the trip's duration**, at a **median gap of 10 seconds or less**. A phone whose location updates are throttled fails this and is scored on four components. GPS cadence is therefore a scoring concern, not only a battery one.

**And the map has to know the road**: a posted limit for at least **half** the trip's judged distance. A drive through country the extract does not cover is scored on four components rather than against a 120 km/h fallback it was never going to reach.

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
- **No single trip can dominate.** A trip contributes at most **30 km** of exposure, however long it actually was, to both the average and the confidence blend. This is CMT's rule — their worked example takes a 200-mile trip and scores it on a 100-mile threshold, so that no one trip has a major impact. Without it a single motorway run outvoted a month of commuting and declared the driver fully proven on one stretch of road. 30 km is a tenth of the 300 km window, which puts ten capped trips between a new driver and a proven one.

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
       × level bonus        (the level entering the trip — ×1.00 to ×2.00)
                            ↓
                     then clipped by the limits below
```

The level bonus sits **inside** the formula, before clipping. The level changes how fast a driver reaches the ceiling; it never raises the ceiling itself. This matches tiered loyalty practice — per-tier earn rates under one flat ceiling.

**The streak is not in this formula, deliberately.** See §4.5.

**The risk multiplier is earned by the score, not granted by the hour.**

Paid flat, it would pay for being on the road at 02:00 rather than for driving well there — the same context the industry uses to raise measured risk. So it tapers in:

| Trip score | Share of the multiplier earned |
|---|---|
| 70 or below | None — the multiplier is ×1.00 at any hour |
| 85 | Half of the excess above ×1.00 |
| 100 | The full time-of-day figure |

```
earned = clamp((trip_score − 70) / 30, 0, 1)
effective risk multiplier = 1.0 + (base − 1.0) × earned
```

- **It tapers to the hour's own base**, not to a fixed ×2.0. An ordinary weeknight still tops out at ×1.50.
- **A taper, not a cut.** Two trips a tenth of a point apart must not differ twofold in what they pay.
- The multiplier scales quality, never exposure. Distance is priced by the distance factor alone, at the same rate at every hour.

The floor of 70 is uncalibrated. Where the fleet's trip scores actually sit decides whether this gate ever binds.

### 4.4 Economic limits

| Limit | Value | Purpose |
|---|---|---|
| **Monthly cap** | 3,000 points per rolling 30 days | The economic ceiling — what the catalogue will pay one driver. At roughly ₪0.10 a point, that is ₪300 a month. Rolling rather than calendar, because a reset date is a farming date. |
| **Daily cap** | 500 points per day | A rate limiter, not a second economic ceiling. It sits above every honest driving pattern (an ordinary commute at level 10 is ~240 points, a Friday night out ~285, an 80 km day ~310) and exists only so a bug or an exploit cannot drain a month in an afternoon. |
| **Daily distance cap** | 150 km counted toward points | A delivery driver cannot farm the system. |
| **Fraud exclusion** | Zero points | Fraudulent trips earn nothing and are excluded from the driver score entirely: transport-mode mismatch, impossible physics, GPS jumps. |

---

### 4.5 Streaks

A streak is how many **driving days in a row** the driver drove well. It is worth **no points**.

The points formula already starts at the trip score, so driving well is paid on every trip. A streak multiplier would charge a second time for the same behaviour. This also matches practice outside telematics — Duolingo, Snapchat and Nike Run Club all leave the count itself as the reward.

**The rules:**

| Rule | The wrong version it replaces |
|---|---|
| A day counts on its **distance-weighted average** score, against a bar of **80** | "Any trip that day" lets one short good drive whitewash a bad day; "every trip" lets one short bad drive destroy a good one |
| Days with **no trip are skipped**, not broken | Breaking on a quiet day pays drivers to take the car out, and the safest kilometre is the one nobody drives |
| One bad day **ends the run**. No forgiveness | A streak freeze suits a 1,000-day identity object. This one is rebuilt in a week, and what it would forgive is the only thing being measured |
| Counted up to **yesterday** | A day still in progress can be banked on a good morning and spoiled by evening |
| Reaches back **30 days** at most | Doubles as the expiry: a streak that survives an indefinite absence is not a streak |

The bar of **80** is the same 80 the level cap uses, so "a good day" means one thing across the product. It is a first calibration, not a fitted number.

**The record** (`users.best_streak`) is the only part stored, because the live count is derived from a 30-day window and a record set before that cannot be recomputed. It is a personal best rather than a leaderboard: any accumulating measure ranks driving *volume*, so a public streak board would reward mileage.

---

## 5. Known Limitations & Edge Cases

### Driver and passenger are not distinguished

- **There is no driver-versus-passenger classifier.** Any trip taken as a passenger is scored as if the user drove it.
- **It contaminates all five components, not only distraction.** A passenger's phone handling reads as distraction, and the driver's braking and cornering are attributed to the passenger.
- **The contamination is biased, not random.** A passenger uses their phone far more freely than a driver, so passenger trips push the distraction component — our heaviest, at 0.30 — in one direction.
- **Manual trip deletion is not a substitute.** It relies on the user, it is unverifiable, and it only ever removes trips the user dislikes.
- Commercial platforms treat this as a dedicated machine-learning model rather than a heuristic, and report classification accuracy in the high nineties. Until an equivalent exists, the driver score describes a phone, not a driver.

### Measurement limits

- **Phone touches cannot be seen directly.** No app can observe touches delivered to another app, on either platform, and iOS exposes no screen state to a backgrounded app. Both counters therefore read the motion a touch produces rather than the touch itself — which is why the signature is a cadence of gyroscope peaks and not any single reading.
- **A phone typed on in a fixed mount is invisible.** Detection looks for the phone moving; a phone clamped to a mount moves with the car. This matters more in Israel than in the US, because regulation 28(b) bans texting whether the phone is mounted or not. The alternative signal — screen state — is exposed only by Android, which would create a blind spot for half the user base instead of a shared one.
- **A phone loose on a seat can read as a phone in a hand until the cut-off is fitted.** Rotational variance is what separates the two, but which side of the cut-off a hand sits on is unresolved. The placement study behind the signal compares a hand against a population of mostly fixed mounts, never against a phone loose on a seat, and it normalises its features before clustering — so it hands us the right signal, no threshold, and no direction for this pair. Until ours is fitted against labelled drives with the phone on the seat, the separation is assumed rather than measured.
- **No GPS speed means no harsh events, and there is no fallback.** Both detectors trigger on GPS, so a tunnel, a parking garage or a street of tall buildings blinds both at once. Distance and distraction keep working; braking, acceleration and cornering do not. The accelerometer cannot take over, because an uncalibrated phone at an unknown orientation cannot distinguish braking from a bump. The reference approach in the field is the opposite architecture: treat the accelerometer as the instrument, use sparse GPS to estimate the phone-to-vehicle rotation, and fall back to rest-period recalibration and post-trip map matching when GPS degrades. That approach loses accuracy gracefully. Ours loses the measurement entirely. The gap is not evenly distributed — dense urban driving has both the worst GPS and the most harsh events.

### Calibration limits

- **The decay constants are provisional.** They are fitted to a small trip sample — enough to produce a working curve, not enough to call settled. A proper fit needs roughly 200 trips with severity data.
- **Subscores use a fixed curve, not the driver population.** Scoring each component as a percentile against the fleet is the stronger method and requires a fleet distribution large enough to be stable.
- **The level thresholds are a first calibration**, not fitted to real fleet behaviour.
- **The component weights are not derived from crash data.** They reflect the published direction of risk — distraction highest — but not a measured ratio. CMT does not publish its own weights.

### Scoring edge cases

- **A throttled phone is scored on four components, not five.** Some Android handsets defer location updates hard enough that the trace cannot support speed measurement. That trip loses speeding and has its upside capped. Nobody is penalised, but two drivers can be scored by different formulas on the same drive.
- **Most limits are derived, not read.** Explicit `maxspeed` tags cover 62% of Israel's trunk roads in OpenStreetMap but only 34% of primary, 25% of secondary, 16% of tertiary and 9% of residential - 38,718 of 322,862 loaded roads in total. Everything else is inferred from road class and built-up area. A road whose derived limit is wrong is wrong in the driver's favour by construction, but it is still wrong: a 70 km/h stretch mapped as `primary` is judged at 90.
- **Built-up area is a polygon, not a sign.** The 50 km/h rule needs more than half a road's length inside an OSM place polygon. A majority rather than any overlap, because a bypass that clips the corner of a town would otherwise be demoted to 50 and charge a driver doing 75 on it. A town whose polygon is missing or drawn tight still keeps the open-road default on its streets.
- **Off the extract, only sustained speed above 130 km/h is charged**, and a trip more than half off the extract loses the component entirely.
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

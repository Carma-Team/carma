# How the CARMA score works

**Status: live.** This is the only scoring engine.

Every trip is stamped with the version of the formula that scored it — currently `2.1.0`, in `trips.scoring_version`. Old trips keep their original score and stamp, so a score from June is still readable today. That stamp is the only thing the version number is for.

Where this document and the code disagree, **the code is right**: [`server/app/services/scoring.py`](../server/app/services/scoring.py).

---

## The short version

- **Every trip gets a score from 0 to 100**, built from five things: phone distraction, speeding, braking, acceleration, cornering. These are the same five Cambridge Mobile Telematics scores in DriveWell.
- **Distraction counts most.** Phone use is the single biggest behavioural crash factor in the industry data.
- **We count rates, not totals.** Three hard brakes over 200 km is good driving; three over 2 km is not. Everything is per 100 km or per driving hour, so a long trip is never punished for being long.
- **The driver's score is separate** and moves slowly. One bad trip fades in about two weeks.
- **The server decides.** The phone collects sensor data. It never calculates a score anyone can see.

---

## How a trip becomes a score

```
   Phone                            Server
┌───────────────┐        ┌──────────────────────────────┐
│ accelerometer │        │ 1. Re-detect events from GPS │
│ gyroscope     │  ───►  │ 2. Discard anything <5 km/h  │
│ GPS trace     │        │ 3. Convert to rates          │
│ phone handling│        │ 4. Rate → subscore           │
└───────────────┘        │ 5. Blend the five            │
                         │ 6. Cap by trace confidence   │
                         │ 7. Update driver score       │
                         │ 8. Award points              │
                         └──────────────────────────────┘
```

The phone can show live feedback during a drive, but that is a preview. Only the server's number is real.

---

## Why this follows CMT

Every significant choice below — which five things to measure, what units to measure them in, what counts as distraction — follows Cambridge Mobile Telematics rather than something we invented. That is deliberate, and it is the strongest thing about the algorithm.

**Why their method carries weight that ours could not:**

| | |
|---|---|
| **It is validated against crashes** | The only real proof a driving metric works is that it predicts crashes. CMT matched their measurements against actual insurance claims across tens of millions of drivers. No amount of internal tuning substitutes for that. |
| **It survives regulatory review** | Insurers use CMT scores in rating plans filed with state regulators. The method has been examined by people whose job is to reject unfair pricing. A self-invented score has passed no such test. |
| **They publish the population numbers** | Their annual figures let us check our own sensors against a known baseline immediately, instead of waiting years for our own claims data. |
| **It is in the public record** | Patent 11,485,369 covers the distraction measurement, and their crash-risk findings are published jointly with road-safety bodies. It can be read and challenged. |

**What copying them does and does not buy us.** It makes our numbers *comparable* to the industry standard and auditable by anyone who knows the field. It does not make them *validated* — their figures are validated because they had claims to check against, and we have none.

The honest sentence, which is stronger than overclaiming: *"We measure the way the industry leader measures, so our numbers can be checked against theirs. Validating against claims requires claims — that comes after the pilot."*

**Where we knowingly differ**, in both cases because of data we do not have yet:

- **Distraction is one number, not two.** CMT keep screen interaction and phone handling separate; we currently blend them. See below.
- **Subscores are scored against a fixed curve, not against the driver population.** CMT compare each driver to everyone else. That is the better method and needs a fleet distribution we do not have.

---

## The five things we measure

### 1. Phone distraction — weight 0.30

Measured as **time handling the phone while the car is moving**, reported as seconds per driving hour. This is CMT's unit, chosen so our numbers sit next to theirs.

CMT publish two separate figures, and both are useful as a sanity check on our own sensors:

| CMT metric | What it is | US average, 2024 |
|---|---|---|
| Screen interaction | Typing, tapping, using apps | 1 min 56 s per driving hour |
| Phone motion | Physically handling the device | 1 min 22 s per driving hour |

If our number is wildly off theirs, our sensors are broken — and we find that out now, not after years of collecting claims.

**Where we fall short of them today.** Our live formula is `touch_epochs + screen_seconds / 60`. It collapses CMT's two metrics into one number, at a ratio nobody chose — thirty seconds of typing scores like twenty minutes of handling. We use CMT's *unit*, not yet CMT's *method*. Splitting the two is CAR-54.

**Decided along the way:**

| Decision | Why |
|---|---|
| Time, not taps | "What is one tap?" is unanswerable. Typing a message is dozens. Counting seconds makes the question disappear. |
| Holding without touching still counts | The hand and the eyes are the danger, not the tap. |
| Below 15 km/h is free | A red light costs nothing, and no special rule had to be written for it. |
| Screen-lock state ignored | Android exposes it, iOS does not. Using it would score the same behaviour differently on two phones. |

### 2. Speeding — weight 0.25

Measured as **time spent over the limit**, weighted by how far over — not as a count of incidents.

| How far over | Weight |
|---|---|
| under 10 km/h | ignored — GPS noise and traffic flow |
| 10–19 km/h | ×1 |
| 20–29 km/h | ×3 |
| 30 km/h and above | ×8 |

**Today this runs against a flat 120 km/h national maximum**, not the road's posted limit. With the 10 km/h buffer, that means **only sustained speed above 130 km/h costs anything** — egregious motorway speeding, nothing else. Real posted limits need map data we do not have. Until then, speeding's weight is shared out across the other four.

### 3, 4, 5. Braking, acceleration, cornering

Detected two ways, independently: by the phone's accelerometer, and by the server from the GPS trace.

| Event | Phone detects at | Server detects at (from GPS) |
|---|---|---|
| Hard brake | 0.459 g | 3.0 m/s² sustained deceleration |
| Aggressive acceleration | 0.408 g | 2.5 m/s² |
| Sharp turn | 0.357 g lateral | 18°/s bearing change above 25 km/h |

**Anything under 5 km/h is discarded** — parking, speed bumps, a dropped phone. Standard practice, and it removes the largest source of false alarms in phone-based telematics.

**Where the two disagree, the higher count wins.** GPS sampling every 3–6 seconds misses short events an accelerometer catches, so the server's count is a floor, never a ceiling. Counts only ever go up — anti-fraud is one-way.

**Severity is built but not switched on.** The intent is that a 0.75 g emergency stop costs more than a 0.31 g one, on a smooth curve rather than in steps, so there is no "brake at 0.29 g and it's free" gap to game. `event_severity()` is written and tested, but the phone does not send each event's peak force yet, so **today every event counts as one** (CAR-6).

> **Worth knowing before severity ships:** the severity curve starts at 0.30 g for braking, but the phone only reports brakes above 0.459 g. Every phone-reported brake will land mid-curve on day one, and the lowest severity band will be unreachable. The bands need re-anchoring to the SDK's real thresholds when CAR-6 lands.

---

## Turning measurements into a score

### Rates, not totals

| Measure | Divided by | Floor |
|---|---|---|
| Braking, acceleration, cornering, speeding | 100 km | 4 km |
| Distraction | driving hour | 5 minutes |

The floors stop a short trip from exploding: without them, one brake in a 500 m trip reads as 200 brakes per 100 km.

### Rate to subscore

Each of the five gets its own 0–100 subscore:

```
subscore = 100 × exp(−k × rate)
```

The curve never hits zero and never flattens, so there is always something to gain by improving — even for a driver scoring badly. A straight-line penalty stops mattering once you are bad enough, which removes the incentive exactly where it is needed most.

| Component | k |
|---|---|
| Braking | 0.018 |
| Acceleration | 0.022 |
| Cornering | 0.012 |
| Speeding | 0.012 |
| Distraction | 0.020 |

**These are provisional.** They were fitted in July 2026 to 57 real trips — enough to fix a curve that was visibly broken (every trip scored exactly 100, or fell off a cliff to 50 on a single event), not enough to call settled. A proper fit needs three things we do not have: around 200 real trips, trustworthy phone-side detection (CAR-6), and per-event severity. Until then, treat the constants as "better than a guess, not yet earned". The before-and-after numbers are in the changelog.

### Blending the five

```
trip score = 0.30 × distraction
           + 0.25 × speeding
           + 0.20 × braking
           + 0.15 × acceleration
           + 0.10 × cornering
```

**While posted speed limits are unavailable**, speeding's share is redistributed: distraction 0.40, braking 0.27, acceleration 0.20, cornering 0.13.

### Three adjustments

| Adjustment | What it does |
|---|---|
| **Short trips are not judged harshly** | Under 2 km or under 5 minutes, the score is blended half-and-half with the driver's standing score. Too little happened to draw a conclusion. |
| **Bad GPS caps the upside, never the downside** | When the trace is sparse or full of gaps, a trip cannot score far above the driver's rolling average. Reported events still count in full — a weak signal should not let a bad trip look good, but it must not invent a good one either. |
| **Claimed distance is checked against the trace** | The server integrates the GPS trace itself and rejects a distance claim more than 35% above what the trace witnesses. Distance multiplies points directly, so it was the one scoring input with no independent check. |

---

## The driver's own score

The trip score is about one drive. The **driver score** is the persistent number a leaderboard, a level ladder or an insurance partner should be built on.

- **Recent trips matter more.** Trips are averaged with a 14-day half-life, weighted by distance. A bad trip fades in about two weeks instead of haunting a lifetime average.
- **New drivers start at 75.** With a few trips there is not enough evidence for a real score, so it is blended toward a starting assumption of 75 — "good, unproven". Full confidence at 300 km. Standard actuarial practice, and better than both a meaningless 100 and a wildly swinging real number.

**What it currently drives:** it caps the level a driver is shown. `total_points` only ever climbs, so without a cap a driver who earned level 8 and then drove badly would display 8 forever.

| Driver score | Level shown, at most |
|---|---|
| 80+ | 10 (no effective cap) |
| 70–79 | 8 |
| 60–69 | 6 |
| 50–59 | 4 |
| under 50 | 2 |

Nothing is destroyed by the cap — the moment the driver score recovers, the earned level comes straight back with no points to re-accumulate. These thresholds are a first calibration, not fitted to the fleet.

**No API returns the driver score and the app has never displayed it.** Exposing it is CAR-85.

---

## Points

Points are the game currency. They are deliberately **not** the score.

```
points = trip score
       × distance factor    (log scale — 1.0 at 10 km)
       × risk multiplier    (Israeli weekend nights ×2.0, weeknights ×1.5)
       × streak bonus       (+5% per consecutive day scoring 80+, up to ×1.25)
```

**Limits that protect the rewards economy:**

- **300 points a day**, maximum.
- **150 km a day** counted toward points — a delivery driver cannot farm the system.
- **Fraudulent trips earn nothing** and are excluded from the driver score entirely: transport-mode mismatch, impossible physics, GPS jumps.

---

## What is live and what is not

**Working today:** the full pipeline — server-side GPS detection, rates, subscores, blending, confidence cap, distance witness, driver score, level cap, points, anti-grind caps. Unit tests on every stage.

**Designed, waiting on something else:**

| What | Waiting on |
|---|---|
| Distraction split into CMT's two metrics | CAR-54 |
| Per-event severity | CAR-6 — the SDK sending peak g-force |
| Speeding against real posted limits | Map data |
| Population-relative subscores | Fleet distribution — see the calibration doc |
| Driver score visible to the driver | CAR-85 |

---

## What we chose not to do

| Not doing | Why |
|---|---|
| Machine-learning crash models | Need claims data we do not have, and cannot be explained to a driver. Revisit if an insurance partnership happens. |
| Bayesian driver profiles | Heavy machinery for a small gain at our size. A recency-weighted average with a prior gets most of the benefit in ten lines. |
| Weather and road-type adjustments | Real signal, but each adds an outside data dependency. Deferred until map data is in place for speeding anyway. |

---

## Known limits, stated plainly

- **We cannot see phone touches.** No app can see touches delivered to another app, on either platform — including CMT's. Handling is inferred from how the device moves.
- **A phone typed on in a mount is invisible to us.** CMT's method looks for the phone *moving* first, and a phone clamped to a mount moves with the car. We inherit the blind spot by copying them. It matters more here than in the US, because Israeli regulation 28(b) bans texting whether the phone is mounted or not. The alternative — screen state, which only Android exposes — would create a blind spot for half our users instead of all of them.
- **A phone loose on a seat still reads as a phone in a hand.** The largest known source of false distraction today, and the one that most needs fixing.
- **No claims validation.** Repeated because it is the limitation most likely to get lost in a pitch.

---

## Sources

**Cambridge Mobile Telematics** — the primary reference for the distraction metric:

- [How the DriveWell platform works](https://www.cmtelematics.com/safe-driving-technology/how-it-works/)
- [Distracted driving fell 8.6% in 2024](https://www.cmtelematics.com/news/distracted-driving-fell-8-6-in-2024-preventing-an-estimated-105000-crashes-and-480-fatalities/) — the screen-interaction and phone-motion figures above
- [Rising phone distraction calls for new methods of measurement](https://www.cmtelematics.com/blog/rising-phone-distraction-calls-for-new-methods-of-measurement/)
- [Patent 11,485,369 — determining, scoring and reporting phone distraction](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11485369)
- [GHSA + CMT — distraction raises crash risk by 240%](https://www.ghsa.org/news/distracted-driving-raises-crash-risk-240-percent)

**Event detection thresholds and low-speed filtering:**

- [Geotab — what g-force means for harsh driving](https://www.geotab.com/blog/what-is-g-force/)
- [Samsara — harsh event detection](https://kb.samsara.com/hc/en-us/articles/5321169919501-Harsh-Event-Detection)
- [Motive — harsh driving detection](https://helpcenter.gomotive.com/hc/en-us/articles/31054170471837-Harsh-Driving)
- [Damoov — safety score documentation](https://docs.damoov.com/docs/safety-score)

**Method and regulation:**

- [Journal of Big Data — driving behaviour analysis in usage-based insurance](https://journalofbigdata.springeropen.com/articles/10.1186/s40537-019-0249-5)
- [American Academy of Actuaries — regulatory adequacy of usage-based insurance](https://actuary.org/article/toward-the-regulatory-adequacy-of-usage-based-insurance/)

---

## Where the old section numbers went

This document used to be numbered, and about fifty code comments still point at those numbers (`# see §6.1`). Search this table for the number in the comment.

| Old | Now |
|---|---|
| §1 | *(gone — it argued against the v1 formula, which no longer exists)* |
| §3.1 | Braking, acceleration, cornering — the detection table |
| §3.2 | Braking, acceleration, cornering — "Severity is built but not switched on" |
| §3.3 | Speeding |
| §3.4 | Phone distraction |
| §4 | Braking, acceleration, cornering — the under-5 km/h rule |
| §4.3 | Three adjustments — "Bad GPS caps the upside" |
| §5, §5.2 | Rates, not totals |
| §6, §6.1 | Rate to subscore |
| §6.2 | Blending the five |
| §6.3 | Three adjustments — "Short trips are not judged harshly" |
| §7 | The driver's own score |
| §8 | Points |

When you next touch one of those comments, replace the `§` reference with the section name. The numbering is not coming back.

---

## Related documents

- [How CARMA measures phone distraction](https://linear.app/carma-app/document/how-carma-measures-phone-distraction-the-design-and-why-6f8361ad1dcc) — the full reasoning behind the distraction design
- CAR-102 — the July 2026 recalibration record, and what unblocks a proper fit

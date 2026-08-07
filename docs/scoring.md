# How the CARMA score works

**Status: live.** This is the only scoring engine.

Every trip is stamped with the version of the formula that scored it — currently `2.1.0`, in `trips.scoring_version`. Old trips keep their original score and stamp, so a score from June is still readable today. That stamp is the only thing the version number is for.

Where this document and the code disagree, **the code is right**: [`server/app/services/scoring.py`](../server/app/services/scoring.py).

---

## The short version

- **Every trip scores 0 to 100**, from five things: phone distraction, speeding, braking, acceleration, cornering. The same five Cambridge Mobile Telematics measure in DriveWell.
- **Distraction counts most.** CMT measured a 240% rise in crash risk from phone distraction, against 103% for hard braking and 71% for speeding.
- **We count rates, not totals.** Three hard brakes over 200 km is good driving; three over 2 km is not. Everything is per 100 km or per driving hour, so a long trip is never punished for being long.
- **The driver's score is separate** and moves slowly. One bad trip fades in about two weeks.
- **The server decides.** The phone collects sensor data. It never calculates a score anyone can see.

---

## Why this follows CMT

Almost every choice below — what to measure, in what units, what counts as distraction — follows Cambridge Mobile Telematics rather than something we invented. That is deliberate, and it is the strongest thing about the algorithm.

**Why their method carries weight ours could not:**

| | |
|---|---|
| **Validated against crashes** | The only real proof a driving metric works is that it predicts crashes. CMT matched their measurements against actual insurance claims across tens of millions of drivers. Internal tuning is no substitute. |
| **Survives regulatory review** | Insurers use CMT scores in rating plans filed with state regulators — examined by people whose job is to reject unfair pricing. A self-invented score has passed no such test. |
| **Population numbers are published** | Their annual figures let us check our sensors against a known baseline now, instead of waiting years for claims of our own. |
| **It is in the public record** | Patent 11,485,369 covers the distraction measurement; the crash-risk findings are published with road-safety bodies. It can be read and challenged. |

**What copying them buys, and what it does not.** It makes our numbers *comparable* to the industry standard and auditable by anyone who knows the field. It does not make them *validated* — their figures are validated because they had claims to check against, and we have none.

The honest sentence, which is stronger than overclaiming:

> *"We measure the way the industry leader measures, so our numbers can be checked against theirs. Validating against claims requires claims — that comes after the pilot."*

---

## How a trip becomes a score

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

The phone can show live feedback during a drive, but that is a preview. Only the server's number is real.

---

## The five things we measure

Where we stand against CMT, component by component:

| Component (weight) | CMT's method | Ours | Gap |
|---|---|---|---|
| Phone distraction (0.30) | Two metrics, seconds per driving hour, counted only while the vehicle moves | One blended metric, same unit, counted above 15 km/h | We collapse their two into one |
| Speeding (0.25) | Time over the road's actual limit | Time over a flat 120 km/h national maximum | No map data for posted limits |
| Braking (0.20), acceleration (0.15), cornering (0.10) | Harsh-event detection from phone sensors, normalised by exposure | GPS dynamics on the phone, confirmed by the accelerometer, plus a second GPS pass on the server | Severity is measured but not yet scored |

**The weights themselves are the largest gap, and it is not a row above.** CMT's crash data puts distraction about 3.4x above speeding; our weights put them nearly level at 0.30 and 0.25. Normalising their figures would give distraction roughly 0.58. Re-weighting is CAR-53 — deliberately not before the distraction signal is trustworthy, because raising the weight of a noisy measurement amplifies the noise along with it.

### Phone distraction

CMT publish two separate figures. Both are useful as a sanity check on our own sensors:

| CMT metric | What it is | US average, 2024 |
|---|---|---|
| Screen interaction | Typing, tapping, using apps | 1 min 56 s per driving hour |
| Phone motion | Physically handling the device | 1 min 22 s per driving hour |

If our number is far off theirs, our sensors are broken — and we find that out now, not after years of collecting claims.

**Where we fall short.** Our live formula is `touch_epochs + screen_seconds / 60`. It merges CMT's two metrics at a ratio nobody chose: thirty seconds of typing scores like twenty minutes of handling. We use CMT's *unit*, not yet CMT's *method*. Splitting them is CAR-54.

**Decisions made along the way:**

| Decision | Why |
|---|---|
| Time, not taps | "What is one tap?" is unanswerable — typing a message is dozens. Counting seconds makes the question disappear. |
| Holding without touching counts | The hand and the eyes are the danger, not the tap. |
| Below 15 km/h is free | A red light costs nothing, and no special rule had to be written for it. Matches CMT counting distraction only while the vehicle moves. |
| Screen-lock state ignored | Android exposes it, iOS does not. Using it would score the same behaviour differently on two phones. |

### Speeding

Time over the limit, weighted by how far over — not a count of incidents.

| How far over | Weight |
|---|---|
| under 10 km/h | ignored — GPS noise and traffic flow |
| 10–19 km/h | ×1 |
| 20–29 km/h | ×3 |
| 30 km/h and above | ×8 |

**Today this runs against a flat 120 km/h national maximum**, not the road's posted limit. With the 10 km/h buffer, **only sustained speed above 130 km/h costs anything** — egregious motorway speeding, nothing else. Until map data arrives, speeding's weight is shared across the other four.

### Braking, acceleration, cornering

Detected twice, on both sides of the wire — and both detectors now start from GPS.

| Event | Phone triggers at | Server triggers at (from the waypoint trace) |
|---|---|---|
| Hard brake | GPS deceleration 2.7 m/s² (~0.28 g) | 3.0 m/s² sustained deceleration |
| Aggressive acceleration | GPS acceleration 3.0 m/s² (~0.31 g) | 2.5 m/s² |
| Sharp turn | speed × turn rate ≥ 3.5 m/s² (~0.36 g), above 10 km/h | 18°/s bearing change above 25 km/h |

The phone averages over a window of at least 1.5 seconds, and fires only if the accelerometer also felt a real horizontal force. The accelerometer is a witness now, not the trigger.

**Why the phone stopped reading the accelerometer directly.** It used to detect braking on the sensor's Y axis and turns on X. That only works if the phone lies flat with its top pointing forward — in a vent clip, a cup holder or a pocket the axes point somewhere else entirely, so real events went undetected no matter where the threshold sat. Speed change and heading change do not care how the phone is held.

This is the one place a phone cannot copy a fleet telematics box. Geotab's published g-force thresholds work because a GO device is bolted into the vehicle in a known orientation. Ours never is. Phone-based telematics therefore reads its trigger from GPS dynamics or from rotation-invariant sensor magnitudes — which is what we now do on both counts.

**The new thresholds are more sensitive than the old ones, and are not yet validated.** 2.7 m/s² is about 0.28 g, against the 0.459 g the phone used before and the 0.45 g commonly cited as harsh braking. The comparison is not like for like — ours is an average held for a second and a half, the published figures are instantaneous peaks, and a sustained 0.28 g is the larger event of the two. Nobody has yet checked the resulting event rate against real trips.

- **Low-speed events are dropped** — parking, speed bumps, a dropped phone. Standard practice across the industry, and it removes the largest source of false alarms in phone-based telematics. The floor differs by event and by which side detected it:

  | Event | Phone drops below | Server drops below |
  |---|---|---|
  | Hard brake | 15 km/h | 15 km/h |
  | Aggressive acceleration | 5 km/h | 15 km/h |
  | Sharp turn | 10 km/h | 25 km/h |

  The two sides disagree on acceleration and cornering, and because counts merge as `max(phone, server)` the looser floor wins — a 6 km/h pull-out counts as an aggressive acceleration. Tracked in CAR-103.
- **Where the two disagree, the higher count wins.** The phone sees every GPS fix, roughly every 2 seconds; the server only sees the trace it was sent, thinned to one point every 5 seconds, so it misses short events. The server's count is a floor, never a ceiling. Counts only ever go up — anti-fraud is one-way.
- **Severity now arrives, and still is not scored.** A 0.75 g emergency stop should cost more than a 0.31 g one, on a smooth curve rather than in steps, so there is no "brake at 0.29 g and it's free" gap to game. Every event now carries its peak g-force and how long it lasted, and the server stores both. The score does not read them: event counts come from the **signed** telemetry digest, and the event list is unsigned — feeding it into the score would let a client dictate its own severity. `event_severity()` is written and tested; switching it on means getting the counts and the severities under one signature. **Today every event still counts as one** (CAR-6).

> **Before severity ships:** the curve expects a braking peak between 0.30 g and 0.60 g. What the phone reports is the accelerometer's peak horizontal force, and an event is accepted on as little as 0.10 g of it. Where real trips actually land in that band is unknown. Measure the distribution first, or the bottom of the curve swallows everything.

---

## Turning measurements into a score

### Rates, not totals

| Measure | Divided by | Floor |
|---|---|---|
| Braking, acceleration, cornering, speeding | 100 km | 4 km |
| Distraction | driving hour | 5 minutes |

The floors stop short trips from exploding: without them, one brake in a 500 m trip reads as 200 brakes per 100 km.

### Rate to subscore

Each of the five gets its own 0–100 subscore:

```
subscore = 100 × exp(−k × rate)
```

The curve never hits zero and never flattens, so there is always something to gain by improving — even for a driver scoring badly. A straight-line penalty stops mattering once you are bad enough, which kills the incentive exactly where it matters most.

| Component | k |
|---|---|
| Braking | 0.018 |
| Acceleration | 0.022 |
| Cornering | 0.012 |
| Speeding | 0.012 |
| Distraction | 0.020 |

**This is the one place we knowingly depart from CMT.** They score each component against the driver population; we use a fixed curve with a fixed constant. Population-relative scoring is the better method and needs a fleet distribution we do not have yet.

**The constants are provisional.** Fitted July 2026 to 57 real trips — enough to repair a visibly broken curve (every trip scored exactly 100, or fell off a cliff to 50 on a single event), not enough to call settled. A proper fit needs roughly 200 trips and per-event severity feeding the score (CAR-6). Treat them as better than a guess, not yet earned. Record and trigger: CAR-102.

**And the fit predates working phone-side detection.** Those 57 trips were recorded while the phone detected events off fixed accelerometer axes, which in a real mount caught almost nothing — so nearly every event in that data came from the server's GPS pass alone. Now the phone contributes real counts, counts merge upward, and trip scores should fall across the board. Re-fit on trips recorded after PR #48, not before it, and expect the constants to move.

### Blending the five

```
trip score = 0.30 × distraction
           + 0.25 × speeding
           + 0.20 × braking
           + 0.15 × acceleration
           + 0.10 × cornering
```

**While posted limits are unavailable**, speeding's share is redistributed: distraction 0.40, braking 0.27, acceleration 0.20, cornering 0.13.

### Three adjustments

| Adjustment | What it does |
|---|---|
| **Short trips are judged gently** | Under 2 km or 5 minutes, the score is blended half-and-half with the driver's standing score. Too little happened to draw a conclusion. |
| **Bad GPS caps the upside, never the downside** | A sparse or gappy trace stops a trip scoring far above the driver's rolling average. Reported events still count in full — a weak signal must not let a bad trip look good, and must not invent a good one. |
| **Claimed distance is checked against the trace** | The server integrates the GPS trace itself and rejects a distance claim more than 35% above what the trace witnesses. Distance multiplies points directly, so it was the one scoring input with no independent check. |

---

## The driver's own score

The trip score is about one drive. The **driver score** is the persistent number a leaderboard, a level ladder or an insurance partner should be built on.

- **Recent trips matter more.** Trips are averaged with a 14-day half-life, weighted by distance — an effective window of about 28 days, matching the rolling window CMT use for portable driver scores. A bad trip fades in roughly two weeks instead of haunting a lifetime average.
- **New drivers start at 75.** Too few trips is too little evidence, so the number is blended toward a starting assumption of 75 — "good, unproven" — reaching full confidence at 300 km. Standard actuarial practice, and better than either a meaningless 100 or a wildly swinging real number.

**What it drives today:** the level a driver is shown. `total_points` only climbs, so without a cap a driver who earned level 8 and then drove badly would display 8 forever.

| Driver score | Level shown, at most |
|---|---|
| 80+ | 10 (no effective cap) |
| 70–79 | 8 |
| 60–69 | 6 |
| 50–59 | 4 |
| under 50 | 2 |

Nothing is destroyed — when the driver score recovers, the earned level returns with no points to re-accumulate. These thresholds are a first calibration, not fitted to the fleet.

**No API returns the driver score and the app has never displayed it.** Exposing it is CAR-85.

---

## Points

Points are the game currency, and deliberately **not** the score. This part is ours — CMT score risk, they do not run a rewards economy.

```
points = trip score
       × distance factor    (log scale — 1.0 at 10 km)
       × risk multiplier    (Israeli weekend nights ×2.0, weeknights ×1.5)
       × streak bonus       (+5% per consecutive day with a trip, up to ×1.25)
       × level bonus        (the level entering the trip — ×1.00 to ×2.00)
                            ↓
                     then clipped by the limits below
```

**The streak rewards showing up, not driving well.** It counts consecutive days with any trip, at any score — a driver averaging 40 builds the same ×1.25 as one averaging 95. Tying it to the score is CAR-104.

**The level bonus is inside the formula, not applied after it.** It used to be a multiplier laid on top of the already-clipped figure, which made the real ceiling 300 × the level bonus — 600 a day at level 10, the account worth grinding for. The level now changes how fast a driver reaches a ceiling, never where the ceiling sits. That is what tiered loyalty practice does, and what Discovery's Vitality Drive does: per-tier earn rates under one flat monthly ceiling.

**Limits that protect the rewards economy:**

- **3,000 points per rolling 30 days** — the economic ceiling: what the catalogue will pay one driver. At roughly ₪0.10 a point that is ₪300 a month, level with Vitality Drive's 3,000 and well above LETSTOP's free tier (~₪75). Before this there was no monthly limit at all and the daily one implied ~₪900. Rolling rather than calendar, because a reset date is a farming date.
- **500 points a day** — a rate limiter, not a second economic ceiling. It sits deliberately *above* every honest driving pattern (an ordinary commute at level 10 is ~240, a Friday night out ~285, an 80 km day ~310) and exists only so that a bug or an exploit cannot drain a whole month in an afternoon. A daily cap a real driver can feel has been priced as an economic ceiling by mistake; that job belongs to the month.
- **150 km a day** counted toward points — a delivery driver cannot farm the system.
- **Fraudulent trips earn nothing** and are excluded from the driver score entirely: transport-mode mismatch, impossible physics, GPS jumps.

---

## What is live, and what is waiting

**Working today:** the whole pipeline — orientation-free detection on the phone, server-side GPS detection, rates, subscores, blending, confidence cap, distance witness, driver score, level cap, points, anti-grind caps. Unit tests at every stage.

| Designed, not yet live | Waiting on |
|---|---|
| Distraction split into CMT's two metrics | CAR-54 |
| Per-event severity in the score | CAR-6 — the SDK sends peak g-force now; the score needs it signed |
| Speeding against real posted limits | Map data |
| Population-relative subscores | A real fleet distribution — CAR-102 |
| Driver score visible to the driver | CAR-85 |

---

## Known limits, stated plainly

- **We cannot see phone touches.** No app can see touches delivered to another app, on either platform — including CMT's. Handling is inferred from how the device moves.
- **A phone typed on in a mount is invisible.** CMT's method looks for the phone *moving* first, and a phone clamped to a mount moves with the car. We inherit the blind spot by copying them. It matters more here than in the US, because Israeli regulation 28(b) bans texting whether the phone is mounted or not. The alternative — screen state, which only Android exposes — would blind us for half our users instead of all of them.
- **A phone loose on a seat reads as a phone in a hand.** The largest known source of false distraction today, and the one that most needs fixing.

---

## Sources

**Cambridge Mobile Telematics** — the primary reference:

- [How the DriveWell platform works](https://www.cmtelematics.com/safe-driving-technology/how-it-works/) — the five components, and scoring each against the driver population
- [Distracted driving fell 8.6% in 2024](https://www.cmtelematics.com/news/distracted-driving-fell-8-6-in-2024-preventing-an-estimated-105000-crashes-and-480-fatalities/) — the screen-interaction and phone-motion figures
- [Rising phone distraction calls for new methods of measurement](https://www.cmtelematics.com/blog/rising-phone-distraction-calls-for-new-methods-of-measurement/)
- [Portable driving scores with TransUnion](https://beinsure.com/news/cambridge-mobile-telematics-portable-driving-scores/) — the 28-day rolling window
- [Patent 11,485,369 — determining, scoring and reporting phone distraction](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11485369)
- [GHSA + CMT — distraction raises crash risk by 240%](https://www.ghsa.org/news/distracted-driving-raises-crash-risk-240-percent)

**Harsh-event thresholds and low-speed filtering** — industry-wide, not CMT-specific:

- [Geotab — what g-force means for harsh driving](https://www.geotab.com/blog/what-is-g-force/)
- [Damoov — safety score documentation](https://docs.damoov.com/docs/safety-score)
- [American Academy of Actuaries — regulatory adequacy of usage-based insurance](https://actuary.org/article/toward-the-regulatory-adequacy-of-usage-based-insurance/)

---

## Related

- [How CARMA measures phone distraction](https://linear.app/carma-app/document/how-carma-measures-phone-distraction-the-design-and-why-6f8361ad1dcc) — the full reasoning behind the distraction design
- CAR-102 — the July 2026 recalibration record, and what unblocks a proper fit

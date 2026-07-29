# How the CARMA score works

**Status: live.** This is the only scoring engine. Version 2.1.

This document explains what a driver's score means, how it is calculated, and why each choice was made. It is written to be read once, start to finish, by anyone on the team.

Where this document and the code disagree, **the code is right** — `server/app/services/scoring_v2.py`.

---

## The short version

- **Every trip gets a score from 0 to 100.** Five things go into it: phone distraction, speeding, braking, acceleration, cornering.
- **Distraction counts most**, because phone use is the single biggest cause of crashes in the industry data.
- **We count rates, not totals.** Three hard brakes over 200 km is good driving. Three over 2 km is not. Everything is measured per 100 km, so a long trip is never punished for being long.
- **The driver's own score is separate** and moves slowly. One bad trip fades in about two weeks. It is what the leaderboard, the levels and any future insurer see.
- **The server decides.** The phone collects sensor data and nothing else. It never calculates a score anyone can see.

---

## How a trip becomes a score

```
   Phone                          Server
┌──────────────┐        ┌────────────────────────┐
│ accelerometer│        │ 1. Throw out anything  │
│ gyroscope    │  ───►  │    under 5 km/h        │
│ GPS          │        │ 2. Convert to rates    │
│ phone handling│       │    per 100 km          │
└──────────────┘        │ 3. Rate → subscore     │
                        │ 4. Blend the five      │
                        │ 5. Update driver score │
                        │ 6. Award points        │
                        └────────────────────────┘
```

The phone can show live feedback during a drive, but that number is a preview. Only the server's number is real.

---

## The five things we measure

### 1. Phone distraction — weight 0.30

**The rule: how many seconds the driver was handling the phone while the car was moving faster than 15 km/h.** Reported as seconds per driving hour.

This is Cambridge Mobile Telematics' definition, copied deliberately and without changes. CMT carry 30 million drivers and over 100 billion miles, and their models are validated against real insurance claims.

**Why copy instead of invent:**

- A method built by the industry leader is far harder to argue with than one of our own.
- CMT publish population averages. If our number is wildly different from theirs, our sensors are broken — and we find out immediately, without waiting years for claims data.
- An insurer already reads these units.

**Be careful how this is described.** Using their definition makes our numbers *comparable* to theirs. It does not make them *validated*. Their figures are validated because they matched their measurements against claims on their own book. We have no claims. Never say the CARMA score predicts crash risk.

The honest sentence: *"We measure using CMT's definition, so our numbers are comparable to the industry standard. Validating against claims requires claims — that comes after the pilot."*

**Decided along the way:**

- **Time, not taps.** Counting taps is unanswerable — what is one tap? Typing a message is dozens. Counting seconds makes the question disappear.
- **Holding without touching still counts.** The hand and the eyes are the danger, not the tap.
- **Below 15 km/h is free.** A red light costs nothing, and no special rule had to be written for it.
- **Nothing about screen lock.** Android can tell whether the screen is unlocked; iOS cannot. Using it would score the same behaviour differently on two phones, and we could not explain that to either driver.

### 2. Speeding — weight 0.25

Measured as **time spent over the limit**, not as a count of incidents, and weighted by how far over:

| How far over the limit | Weight |
|---|---|
| under 10 km/h | ignored — GPS noise and traffic flow |
| 10–19 km/h | 1 |
| 20–29 km/h | 3 |
| 30 km/h and above | 8 |

**Today this runs against a flat 120 km/h national maximum**, not the actual posted limit of the road. Real posted limits need map data we do not have yet. Until then, speeding's weight is shared out across the other four (see below).

### 3, 4, 5. Braking, acceleration, cornering

Detected from the accelerometer, in g-force:

| Event | Moderate | Severe | Extreme |
|---|---|---|---|
| Hard brake | 0.30–0.44 g | 0.45–0.59 g | 0.60 g+ |
| Aggressive acceleration | 0.27–0.39 g | 0.40–0.54 g | 0.55 g+ |
| Sharp turn | 0.35–0.49 g | 0.50–0.64 g | 0.65 g+ |

**Anything under 5 km/h is discarded** — parking, speed bumps, a dropped phone. This is standard practice and removes the largest source of false alarms in phone-based telematics.

**Severity is designed but not switched on.** The intent is that a 0.75 g emergency stop should cost more than a 0.31 g one, on a smooth curve rather than in steps — so there is no "brake at 0.29 g and it's free" gap to game. The code for this exists and is tested (`event_severity()`), but the phone does not yet send the peak force of each event, so today **every event counts as one**. The day the SDK sends it, nothing downstream changes.

---

## Turning measurements into a score

### Rates, not totals

Every count is divided by how much driving it happened across:

- **Kinematic events:** per 100 km, with a floor of 4 km. Without the floor, one brake in a 500 m trip would read as 200 brakes per 100 km.
- **Distraction:** per driving hour, with a floor of 5 minutes.

### Rate to subscore

Each of the five gets its own 0–100 subscore:

```
subscore = 100 × exp(−k × rate)
```

The curve never hits zero and never flattens out, so there is always something to gain by improving — even for a driver who is currently scoring badly. A straight-line penalty stops mattering once you are bad enough, which removes the incentive exactly where it is needed most.

The constants were re-fitted in July 2026 against real CARMA driving data, so that a typical trip lands near 80 and one of the worst 10% lands near 50:

| Component | k |
|---|---|
| Braking | 0.018 |
| Acceleration | 0.022 |
| Cornering | 0.012 |
| Speeding | 0.012 |
| Distraction | 0.020 |

### Blending the five

```
trip score = 0.30 × distraction
           + 0.25 × speeding
           + 0.20 × braking
           + 0.15 × acceleration
           + 0.10 × cornering
```

**While posted speed limits are unavailable**, speeding's share is redistributed: distraction 0.40, braking 0.27, acceleration 0.20, cornering 0.13.

### Two adjustments

- **Short trips are not judged harshly.** Under 2 km or under 5 minutes, the trip score is blended half-and-half with the driver's standing score. Too little happened to draw a conclusion.
- **Bad GPS caps the upside, never the downside.** When the location trace is sparse or full of gaps, a trip cannot score far above the driver's rolling average. Reported events still count in full — a weak signal should not let a bad trip look good, but it also should not invent a good one.

---

## The driver's own score

The trip score is about one drive. The **driver score** is the persistent number: what a leaderboard, a level ladder or an insurance partner should be built on.

> **It is not used by anything yet.** The server calculates it after every trip and stores it on the user, and there it stops — no API returns it and the app has never heard of it. The leaderboard ranks by total points, and levels come from lifetime points. Connecting it is CAR-85.

**Recent trips matter more.** Trips are averaged with a 14-day half-life, weighted by distance. A bad trip fades in about two weeks instead of haunting a lifetime average; a good run shows up quickly. Sustained behaviour moves the number, not single drives.

**New drivers start at 75.** With only a few trips there is not enough evidence for a real score, so the number is blended with a starting assumption of 75 — "good, unproven". Full confidence arrives at 300 km of driving. This is standard actuarial practice, and it beats both a meaningless 100 and a wildly swinging real number.

---

## Points

Points are the game currency. They are deliberately **not** the score.

```
points = trip score
       × distance factor       (log scale — 1.0 at 10 km)
       × risk multiplier       (Israeli weekend nights ×2.0, weeknights ×1.5)
       × streak bonus          (+5% per consecutive day scoring 80+, up to ×1.25)
```

**Limits that protect the rewards economy:**

- **300 points a day**, maximum.
- **150 km a day** counted toward points — a delivery driver cannot farm the system.
- **Fraudulent trips earn nothing** and are excluded from the driver score entirely: transport-mode mismatch, impossible physics, GPS jumps.

---

## What is live and what is not

**Working today:**

- The full pipeline — rates, subscores, blending, driver score, points, anti-grind caps. The driver score is calculated and stored but not yet exposed to anyone (CAR-85).
- Server-side GPS analysis as an independent second opinion on braking, acceleration and cornering. Where the phone and the GPS disagree, the higher count wins.
- Speeding against a flat national limit.
- The telemetry-confidence cap.
- Unit tests on every stage.

**Designed, waiting on the phone:**

| What | Waiting on |
|---|---|
| Distraction as CMT define it | CAR-54, which needs the signal work first |
| Per-event severity | The SDK sending peak g-force |
| Speeding against real posted limits | Map data |

**Distraction is the honest weak point right now.** The current formula is `touch_epochs + screen_seconds / 60` — two different signals added together at a ratio nobody chose. Thirty seconds of typing scores like twenty minutes of phone handling. It is being replaced; see the section above for what replaces it.

---

## What we chose not to do

- **Machine-learning crash models.** They need claims data we do not have, and they cannot be explained to a driver. Revisit if an insurance partnership happens.
- **Bayesian driver profiles.** Heavy machinery for a small gain at our size. A recency-weighted average with a starting prior gets most of the benefit in ten lines.
- **Weather and road-type adjustments.** Real signal, but each one adds an outside data dependency. Deferred until map data is in place for speeding anyway.

---

## Known limits, stated plainly

**We cannot see phone touches.** No app can see touches delivered to another app, on either platform — including CMT's. Handling is inferred from how the device moves.

**A phone being typed on in a mount is invisible to us.** CMT's method looks for the phone *moving* before anything else, and a phone clamped to a mount moves with the car. We inherit the blind spot by copying them. It matters more here than in the US, because Israeli regulation 28(b) bans texting whether the phone is mounted or not. We accept it because the alternative — using screen state, which only Android exposes — would create a blind spot for half our users instead of all of them.

**A phone loose on a seat still reads as a phone in a hand.** This is the largest known source of false distraction today, and the one that most needs fixing.

**No claims validation.** Repeated here because it is the limitation most likely to get lost in a pitch.

---

## Sources

**Cambridge Mobile Telematics** — the primary reference for the distraction metric:

- [How the DriveWell platform works](https://www.cmtelematics.com/safe-driving-technology/how-it-works/)
- [Rising phone distraction calls for new methods of measurement](https://www.cmtelematics.com/blog/rising-phone-distraction-calls-for-new-methods-of-measurement/)
- [State of Distracted Driving 2023](https://www.cmtelematics.com/distracted-driving-report-2023/)
- [Patent 11,485,369 — determining, scoring and reporting phone distraction](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11485369)
- [Motivating safer driving with telematics (study, PDF)](https://m.cmtelematics.com/hubfs/CMT%20Study%20-%20UBI%20Engagement%20Impact.pdf)
- [Portable driving scores with TransUnion — the 28-day rolling window](https://beinsure.com/news/cambridge-mobile-telematics-portable-driving-scores/)
- [GHSA + CMT — distraction raises crash risk by 240%](https://www.ghsa.org/news/distracted-driving-raises-crash-risk-240-percent)

**Event detection thresholds and low-speed filtering:**

- [Geotab — what g-force means for harsh driving](https://www.geotab.com/blog/what-is-g-force/)
- [Samsara — harsh event detection](https://kb.samsara.com/hc/en-us/articles/5321169919501-Harsh-Event-Detection)
- [Motive — harsh driving detection](https://helpcenter.gomotive.com/hc/en-us/articles/31054170471837-Harsh-Driving)
- [Damoov — safety score documentation](https://docs.damoov.com/docs/safety-score)

**Method and regulation:**

- [Journal of Big Data — survey of driving behaviour analysis in usage-based insurance](https://journalofbigdata.springeropen.com/articles/10.1186/s40537-019-0249-5)
- [American Academy of Actuaries — regulatory adequacy of usage-based insurance](https://actuary.org/article/toward-the-regulatory-adequacy-of-usage-based-insurance/)
- [arXiv — can telematics improve driving style?](https://arxiv.org/pdf/2309.02814)

---

## Where the old section numbers went

This document used to be numbered, and about fifty comments in the code still point at those numbers (`# see §6.1`). Rather than keep the numbering and lose the readability, here is the map. Search this table for the number in the comment.

| Old | Now |
|---|---|
| §1 | *(gone — it argued against the v1 formula, which no longer exists)* |
| §3.1 | Braking, acceleration, cornering — the g-force table |
| §3.2 | Braking, acceleration, cornering — "Severity is designed but not switched on" |
| §3.3 | Speeding |
| §3.4 | Phone distraction |
| §4 | Braking, acceleration, cornering — the under-5 km/h rule |
| §4.3 | Turning measurements into a score — "Bad GPS caps the upside" |
| §5, §5.2 | Turning measurements into a score — "Rates, not totals" |
| §6, §6.1 | Turning measurements into a score — "Rate to subscore" |
| §6.2 | Turning measurements into a score — "Blending the five" |
| §6.3 | Turning measurements into a score — "Short trips are not judged harshly" |
| §7 | The driver's own score |
| §8 | Points |

When you next touch one of those comments, replace the `§` reference with the section name. The numbering is not coming back.

---

## Related documents

- [How CARMA measures phone distraction](https://linear.app/carma-app/document/how-carma-measures-phone-distraction-the-design-and-why-6f8361ad1dcc) — the full reasoning behind the distraction design
- [scoring-calibration.md](scoring-calibration.md) — where the decay constants came from
- [archive/scoring-algorithm.md](archive/scoring-algorithm.md) — the retired v1

The work the score is still waiting on lives in Linear, not in a document: CAR-6 (per-event severity from the SDK), CAR-54 (distraction as CMT define it), CAR-85 (exposing the driver score).

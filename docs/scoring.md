# How the CARMA score works

**Status: live.** This is the only scoring engine.

Every trip is stamped with the version of the formula that scored it — currently `2.1.0`, in `trips.scoring_version`. Old trips keep their original score and stamp, so a score from June is still readable today. That stamp is the only thing the version number is for.

Where this document and the code disagree, **the code is right**: [`server/app/services/scoring.py`](../server/app/services/scoring.py).

---

## The short version

- **Every trip scores 0 to 100**, from five things: phone distraction, speeding, braking, acceleration, cornering. The same five Cambridge Mobile Telematics measure in DriveWell.
- **Distraction counts most.** CMT found the most distracted drivers 240% more likely to crash. Braking and speeding are published on a different measure — expected losses, 103% and 71% — so the three do not sit on one scale.
- **We count rates, not totals.** Three hard brakes over 200 km is good driving; three over 2 km is not. Everything is per 100 km or per driving hour, so a long trip is never punished for being long.
- **The driver's score is separate** and moves slowly. One bad trip fades in about two weeks.
- **The server decides.** The phone collects sensor data. It never calculates a score anyone can see.

---

## What this score is for, and what it is not for

**Built for:** feedback to the driver, the leaderboard, the level ladder, and the rewards economy. Everything in this document is designed for a number a driver sees and competes on.

**Not validated for any decision made about a person.** Insurance pricing or underwriting, employment or fleet-hiring decisions, anything with a legal or financial consequence — the score has not earned that use, and nobody should build one on it without redoing the work below.

That is not modesty. Concretely, as of today:

- **It has never been checked against a crash or a claim.** We copy the method of a company that validated theirs; that makes our numbers comparable to theirs, not validated. See "Why this follows CMT".
- **The decay constants come from 57 trips**, recorded before the phone could reliably detect events at all. They will move.
- **Distraction — our heaviest component at 0.30 — is charged while the car is standing still.** Every trip carries up to three stationary minutes.
- **Speeding is scored against a flat 120 km/h**, so on any ordinary road it is a constant 100.
- **Severity is not in the score.** A tap on the brakes and an emergency stop cost the same.

**The inputs it is valid over:** private cars, Israeli roads, a phone carried or mounted in the vehicle, trips long enough to clear the 4 km / 5 minute floors and with a GPS trace dense enough to measure. Outside that — motorcycles, commercial fleets, a phone left at home, a trip through a tunnel — the score is not wrong so much as uninformed, and it does not say so on its face.

This section exists because a scoring model that reaches a person is expected to declare its purpose and its limits (ASOP 56 for actuarial models is the nearest standard). When any of the five points above stops being true, edit it here first.

---

## Why this follows CMT

Almost every choice below — what to measure, in what units, what counts as distraction — follows Cambridge Mobile Telematics rather than something we invented. That is deliberate, and it is the strongest thing about the algorithm.

Two places knowingly depart from them, and both are named where they occur: **how harsh events are detected** ("Braking, acceleration, cornering") and **scoring against a fixed curve instead of the driver population** ("Rate to subscore"). Everywhere else, if this document and CMT disagree, treat it as our bug.

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
| Phone distraction (0.30) | Two metrics, seconds per driving hour, counted only while the vehicle moves | One blended metric, same unit, counted at every speed including standing still | We collapse their two into one, and we do not gate on speed |
| Speeding (0.25) | Time over the road's actual limit | Time over a flat 120 km/h national maximum | No map data for posted limits |
| Braking (0.20), acceleration (0.15), cornering (0.10) | Harsh-event detection from phone sensors, normalised by exposure | GPS dynamics on the phone, confirmed by the accelerometer, plus a second GPS pass on the server | Severity is measured but not yet scored |

**The weights themselves are the largest gap, and it is not a row above.** Ours put distraction and speeding nearly level, at 0.30 and 0.25. CMT's published risk figures say distraction should sit far higher.

They do not, however, say how much higher — and this document used to claim they did. It read "3.4x above speeding" and a target weight of 0.58, both obtained by dividing and normalising the 240%, 103% and 71%. Those three numbers do not share a unit: the 240% is a crash-likelihood figure for the *most distracted* drivers, while the other two are expected-loss figures. Arithmetic on them returns a number that looks derived and is not. CMT do not publish their own weights.

So the direction is well founded and the destination is not. Re-weighting is CAR-53 and it needs a real method rather than a ratio. Whatever the method, it should not move before the distraction signal is trustworthy: raising the weight of a noisy measurement amplifies the noise with it.

### Phone distraction

CMT publish two separate figures. Both are useful as a sanity check on our own sensors:

| CMT metric | What it is | US average, 2024 |
|---|---|---|
| Screen interaction | Typing, tapping, using apps | 1 min 56 s per driving hour |
| Phone motion | Physically handling the device | 1 min 22 s per driving hour |

If our number is far off theirs, our sensors are broken — and we find that out now, not after years of collecting claims.

**Where we fall short.** Our live formula is `touch_epochs + screen_seconds / 60`. It merges CMT's two metrics at a ratio nobody chose: one tap counts the same as a full minute of handling, and since a tap can register every 1.5 seconds, thirty seconds of typing scores like twenty minutes of handling. We use CMT's *unit*, not yet CMT's *method*. Splitting them is CAR-54.

**And neither input is quite what its name says.**

- `touch_epochs` is not touches. It counts jolts — a spike above 1.8 g on the accelerometer, at most one per 1.5 seconds. A tap on glass produces one. So does a pothole, a slammed door, or the phone landing on the passenger seat. **This signal is being deleted, not repaired** (CAR-61, closed for that reason): it has no counterpart in CMT's method, and a magnitude threshold was never a touch detector.
- `screen_interaction_seconds` is not screen time. It counts seconds where the phone looks hand-held (accelerometer variance above 0.025 g²) **while the CARMA app is in the background**. A driver staring at CARMA itself in the foreground accrues nothing — a silent undercount, since the variance check had already correctly spotted a phone in a hand. CAR-45, in review.

Both thresholds are marked in the SDK as needing drive-test calibration, and neither has had it. Once `touch_epochs` goes, distinguishing a hand from a bounce (CAR-46) is the only false-positive source left, which puts it on the critical path.

**Decisions made along the way:**

| Decision | Why |
|---|---|
| Time, not taps | "What is one tap?" is unanswerable — typing a message is dozens. Counting seconds makes the question disappear. |
| Holding without touching counts | The hand and the eyes are the danger, not the tap. |
| Below 15 km/h is free | **Decided, never built.** The intent was that a red light costs nothing, matching CMT. Nothing in the pipeline implements it — see the note below. |
| Screen-lock state ignored | Android exposes it, iOS does not. Using it would score the same behaviour differently on two phones. |

> **The speed gate does not exist.** The distraction counters never see speed — not in the SDK that produces them, not in the app that forwards them, not on the server that scores them. Distraction is counted for the whole trip, so a red light, a traffic jam and the queue at the exit barrier all cost the same as motorway texting.
>
> It also lands hardest at the end. A trip closes only after 3 minutes continuously under 10 km/h, so **every** trip carries a stationary tail of up to three minutes — precisely when a driver picks up the phone to check where they parked. That is charged as distraction on the component we weight most.
>
> This is the one place we claim to follow CMT and do not. Their patent conditions distraction on "the vehicle moving at a speed above a threshold speed".
>
> The fix is split in two, on purpose. **CAR-62** gives the SDK the speed and has it report it without interpreting it — what a speed *means* is scoring logic and must not live in a generic sensor package. **CAR-54** then decides the rule. CAR-62 is in review; until it lands, CAR-54 cannot start.

### Speeding

Time over the limit, weighted by how far over — not a count of incidents.

| How far over | Weight |
|---|---|
| under 10 km/h | ignored — GPS noise and traffic flow |
| 10–19 km/h | ×1 |
| 20–29 km/h | ×3 |
| 30 km/h and above | ×8 |

**Today this runs against a flat 120 km/h national maximum**, not the road's posted limit. With the 10 km/h buffer, **only sustained speed above 130 km/h costs anything** — egregious motorway speeding, nothing else. Below that the component scores a clean 100 no matter how the driver behaves, so 50 in a 30 zone is invisible to us.

### Braking, acceleration, cornering

Detected twice, on both sides of the wire — and both detectors now start from GPS.

| Event | Phone triggers at | Server triggers at (from the waypoint trace) |
|---|---|---|
| Hard brake | GPS deceleration 2.7 m/s² (~0.28 g) | 3.0 m/s² sustained deceleration |
| Aggressive acceleration | GPS acceleration 3.0 m/s² (~0.31 g) | 2.5 m/s² |
| Sharp turn | speed × turn rate ≥ 3.5 m/s² (~0.36 g), above 10 km/h | 18°/s bearing change above 25 km/h |

The phone averages over a window of at least 1.5 seconds, and fires only if the accelerometer also felt a real horizontal force. The accelerometer is a witness now, not the trigger.

**Why the phone stopped reading the accelerometer directly.** It used to detect braking on the sensor's Y axis and turns on X. That only works if the phone lies flat with its top pointing forward — in a vent clip, a cup holder or a pocket the axes point somewhere else entirely, so real events went undetected no matter where the threshold sat. Speed change and heading change do not care how the phone is held.

A phone also cannot borrow a fleet box's numbers. Geotab's published g-force thresholds work because a GO device is bolted into the vehicle in a known orientation. A phone never is.

**Here we do not follow CMT.** They hit the same wall and solved it the other way round. Their patent estimates *where the phone is pointing* — gravity from the vehicle's rest periods, the forward axis from the shape of the acceleration distribution — then rotates the accelerometer into the vehicle's frame and reads true longitudinal deceleration from it. They keep the accelerometer as the instrument and add a calibration step to make it valid. We dropped the accelerometer as the instrument instead, and take the trigger from GPS.

Ours is much the simpler engineering: nothing to calibrate, nothing to get wrong, works on the first trip. It also gives up real resolution. GPS hands us an average over a second and a half; a calibrated accelerometer gives the peak at 10 Hz or better. A short sharp stab on the brakes is exactly the event our average smooths away, and a true peak is exactly the number the severity curve wants.

Worth knowing how far short that leaves us. A published large-scale study of smartphone hard-braking detection scored a fused model at 0.83 PR-AUC — **3.8× better than a GPS-speed heuristic, and 166.6× better than an accelerometer-only heuristic.** Read against our own history: the detector PR #48 removed was the accelerometer-only kind, and the gap between those two multiples is the size of the bullet we dodged. The one we now run is the better heuristic, and still the weaker half of that comparison.

**The new thresholds are also more sensitive, and not yet validated.** 2.7 m/s² is about 0.28 g, against the 0.459 g the phone used before and the 0.45 g commonly cited as harsh braking. Not like for like — ours is an average held over a second and a half, the published figures are instantaneous peaks, and a sustained 0.28 g is the larger event of the two. Nobody has yet checked the resulting event rate against real trips.

- **Low-speed events are dropped** — parking, speed bumps, a dropped phone. Standard practice across the industry, and it removes the largest source of false alarms in phone-based telematics. The floor differs by event and by which side detected it:

  | Event | Phone drops below | Server drops below |
  |---|---|---|
  | Hard brake | 15 km/h | 15 km/h |
  | Aggressive acceleration | 5 km/h | 15 km/h |
  | Sharp turn | 10 km/h | 25 km/h |

  The two sides disagree on acceleration and cornering, and because counts merge as `max(phone, server)` the looser floor wins — a 6 km/h pull-out counts as an aggressive acceleration. Tracked in CAR-103.
- **Where the two disagree, the higher count wins.** The phone sees every GPS fix; the server only sees the trace it was sent, thinned to one point every 5 seconds, so it misses short events. The server's count is a floor, never a ceiling. Counts only ever go up — anti-fraud is one-way. How much of an edge the phone really has depends on the handset: we ask for a fix every 2 seconds, but cloud data shows some devices delivering a median of 6 with gaps over 15. On those, the phone's advantage largely disappears.
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

**The second place we knowingly depart from CMT** (the first is detection, above). They score each component against the driver population; we use a fixed curve with a fixed constant. Population-relative scoring is the better method and needs a fleet distribution we do not have yet.

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

**When the trace is too thin to measure speed**, speeding drops out and its 0.25 is shared across the other four: distraction 0.40, braking 0.27, acceleration 0.20, cornering 0.13.

This is decided per trip, not once and for all. A trip qualifies for speeding only with at least 20 waypoints, covering at least half its duration, at a median gap of 10 seconds or less. A phone whose location updates are being throttled fails that test and is scored on four components instead of five — which is why GPS cadence is a scoring problem, not only a battery one.

### Three adjustments

| Adjustment | What it does |
|---|---|
| **Short trips are judged gently** | Under 2 km or 5 minutes, the score is blended half-and-half with the driver's standing score. Too little happened to draw a conclusion. |
| **Bad GPS caps the upside, never the downside** | A sparse or gappy trace stops a trip scoring far above the driver's rolling average. Reported events still count in full — a weak signal must not let a bad trip look good, and must not invent a good one. |
| **Claimed distance is checked against the trace** | The server integrates the GPS trace itself and rejects a distance claim more than 35% above what the trace witnesses. Distance multiplies points directly, so it was the one scoring input with no independent check. |

---

## The driver's own score

The trip score is about one drive. The **driver score** is the persistent number the leaderboard and the level ladder are built on — and the one an insurance partner would eventually ask for, which is exactly why "What this score is for" above rules that use out for now.

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
- **A phone loose on a seat reads as a phone in a hand.** A sliding phone produces both the variance that reads as handling and the jolts that read as taps.
- **Distraction is charged while the car is stationary.** No part of the pipeline gates it on speed, and every trip ends with up to three stationary minutes still inside it. See the note under "Phone distraction" — this is the largest known source of false distraction today, and the one that most needs fixing.
- **No GPS speed, no braking or cornering.** Both detectors now trigger on GPS, so a tunnel, a parking garage or a street of tall buildings is a blind spot on both sides at once — the accelerometer is only asked to confirm, never to raise. The old accelerometer-first design had no such hole in principle, though in practice it was catching almost nothing anyway. Distance and distraction keep working; harsh events do not.
- **A throttled phone is scored on four components, not five.** Some Android handsets defer location updates hard enough that the trace no longer supports measuring speed. That trip loses speeding entirely and has its upside capped. Nobody is penalised for it, but two drivers can be scored by different formulas on the same drive.

---

## Sources

**Cambridge Mobile Telematics** — the primary reference:

- [How the DriveWell platform works](https://www.cmtelematics.com/safe-driving-technology/how-it-works/) — the platform overview. Note it does *not* enumerate the components or the scoring method; for those use the customer documentation below.
- [DriveWell programme FAQ (MoDOT)](https://www.modot.org/sites/default/files/documents/MO%20Drivewell%20FAQs.pdf) — the load-bearing citation for two claims here: the five components are braking, acceleration, cornering, speeding and phone use; and each subscore is a percentile against the driver population, combined as total risk per mile over a two-week window
- [Distracted driving fell 8.6% in 2024](https://www.cmtelematics.com/news/distracted-driving-fell-8-6-in-2024-preventing-an-estimated-105000-crashes-and-480-fatalities/) — the screen-interaction and phone-motion figures
- [Rising phone distraction calls for new methods of measurement](https://www.cmtelematics.com/blog/rising-phone-distraction-calls-for-new-methods-of-measurement/)
- [Portable driving scores with TransUnion](https://beinsure.com/news/cambridge-mobile-telematics-portable-driving-scores/) — the 28-day rolling window
- [Patent 11,485,369 — determining, scoring and reporting phone distraction](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11485369)
- [Patent 9,228,836 — inferring vehicle trajectory from an arbitrarily-oriented phone](https://patents.google.com/patent/US9228836B2/en) — CMT's answer to the orientation problem, and where we diverge from it
- [GHSA + CMT — distraction raises crash risk by 240%](https://www.ghsa.org/news/distracted-driving-raises-crash-risk-240-percent) — read the units before quoting it: 240% is crash likelihood for the most distracted drivers, while the 103% braking and 71% speeding figures are expected losses

**Harsh-event thresholds and low-speed filtering** — industry-wide, not CMT-specific:

- [Geotab — what g-force means for harsh driving](https://www.geotab.com/blog/what-is-g-force/) — thresholds for a fixed-orientation device, which is why they are not ours to copy directly
- [Smartphone-based hard-braking event detection at scale](https://arxiv.org/abs/2202.01934) — the 3.8× / 166.6× comparison of GPS-speed and accelerometer heuristics against a fused model
- [Damoov — safety score documentation](https://docs.damoov.com/docs/safety-score)
- [American Academy of Actuaries — regulatory adequacy of usage-based insurance](https://actuary.org/article/toward-the-regulatory-adequacy-of-usage-based-insurance/)

---

## Related

- [How CARMA measures phone distraction](https://linear.app/carma-app/document/how-carma-measures-phone-distraction-the-design-and-why-6f8361ad1dcc) — the full reasoning behind the distraction design
- CAR-102 — the July 2026 recalibration record, and what unblocks a proper fit

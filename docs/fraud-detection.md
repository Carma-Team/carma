# CARMA — Anti-Fraud Architecture

> **Status: target specification.** This describes the architecture we build toward, not
> a snapshot of what ships today. Where the code differs, the code is wrong and the gap
> is a Linear issue — never a note in this file.
>
> **This document is the authority for every fraud constant.** Code comments citing
> "Appendix E" refer here.

---

## Why this exists

A driver can earn CARMA points without driving. There are two ways, and they need
different defenses:

- **Be a passenger.** Ride a train with the app running and let it score the journey.
  Nothing in the payload is false — the phone really did move 60 km. The claim that
  fails is *who was driving*.
- **Send data that never came from a drive.** Replay an old trip, inflate a distance,
  spoof a location. Here the payload itself is the lie.

The first is a **classification** problem and can only be attacked where the sensors are:
on the device. The second is an **integrity** problem and must be settled on the server,
because a client that lies about telemetry will also lie about having checked itself.

Everything below follows from that split.

---

## 1. Threat model

| Actor | Capability | What they attack |
|---|---|---|
| **Opportunist** | No technical skill. Leaves the app running on transit. | Transport-mode classification |
| **Grinder** | Repeats or resubmits legitimate trips to farm points. | Idempotency, anti-grind caps |
| **Tamperer** | Edits the payload before it is sent. Has the app bundle, so has any key inside it. | Telemetry digest, signature |
| **Spoofer** | Mock-location app or a rooted device feeding fabricated GPS. | GPS trace, sensor stream |

### What we accept losing

A specification that claims to stop everything gets ignored the first time it is wrong.

- **A passenger in a car.** Same vehicle, same kinematics as the driver. Sensor signal
  alone cannot separate them; the industry solves it with a trained classifier
  (Section 9), which is a maturity-path item, not a gate.
- **A determined attacker on a rooted device**, for as long as the signing key ships inside
  the app bundle. A valid signature then proves the payload came from *a* copy of the
  client, not from a trusted device. Attestation is what changes this (Section 8, Stage 2).
- **Small-scale grinding inside the caps.** The anti-grind ceilings bound the damage; they
  do not detect intent.

Naming these is the point. Everything else in this document is a control we commit to.

---

## 2. Design principles

The six rules every control below answers to.

### P1 — A fraud gate fails toward accepting the trip

When a control cannot reach a confident verdict, it lets the trip through.

The costs are not symmetric. A false rejection silently destroys a real driver's earned
points with no notification and no appeal — the strongest possible signal to a legitimate
user that the product is broken. A false acceptance leaks points that the distance witness
and the GPS cross-check (Section 4.3) partly recover anyway.

**Consequence:** no gate may reject on absent, stale, or unreadable input. This holds for
missing evidence only — see the inversion in P2.

### P2 — No evidence is not negative evidence

A signal that could not be measured is `UNKNOWN`. It is never `false`, and never `true`.

This is the principle the current implementation violates: a boolean cannot express
"no reading," so an absent gyroscope's stream of zeros reads as *perfectly steady heading*
— which is the train fingerprint. Absence of a sensor became proof of fraud.

**Consequence:** every signal is tri-state, end to end, including on the wire.

#### The exception — affirmative evidence of compromise

P1 and P2 govern *missing* evidence. They do not govern evidence that actively says the
device has been tampered with. Three states are not one:

| Observation | Reading | Outcome |
|---|---|---|
| No sample, no subscription, sensor absent | `UNKNOWN` — we do not know | Accept the trip |
| A measurement inside normal bounds | `TRUE` / `FALSE` | Feed the verdict |
| Attestation failure, signature mismatch, mock-location detected | **Compromise** — we know, and the answer is bad | Hard reject |

**The asymmetry inverts the moment an active adversary is detected.** P1's reasoning is
that a false rejection punishes an innocent driver, so ambiguity should favour them. That
reasoning does not survive positive proof of tampering: there is no innocent reading of a
failed attestation, and the cost of rejecting is borne by an attacker rather than a driver.

Collapsing compromise into `UNKNOWN` would make every control in Stage 2 unenforceable by
construction — the device would fail its own integrity check and the pipeline would wave it
through under P1. So compromise is its own state, never coerced to unknown, and it is the
only input in this document that produces a rejection without a confidence requirement.

### P3 — The server is the sole scoring oracle

The client reports. The server decides. Where both have an opinion about a number that
affects points, the server's wins.

**Consequence:** the signed telemetry digest is the only source of scoring inputs. The
events array is forensic display data and never reaches the score.

### P4 — Detection is not enforcement

Classifying a session is one decision. Withholding points is another. They have different
confidence requirements, different owners, and different reversal paths.

**Consequence:** a detector never mutates a balance. It emits a verdict; the enforcement
ladder (Section 5) decides what that verdict costs.

### P5 — Every threshold is server-delivered configuration

A constant compiled into the app can only be changed by shipping a release and waiting for
adoption. Recalibrating from field evidence is then impossible in practice, which makes
collecting the evidence pointless.

**Consequence:** thresholds are fetched, versioned, and reported back with every verdict,
so a stored report says which calibration produced it.

### P6 — Evidence is bounded and purposeful

Fraud reports are behavioural data about a person. They are retained because they are
anti-fraud evidence, for a stated period, and then deleted.

**Consequence:** window aggregates only — no raw sample traces leave the device. Retention
is 12 months from receipt, enforced by a job, not by intention.

---

## 3. Layer 1 — on-device transport classification

Runs on the device because it needs the sensor stream. Its verdict is advisory: it can
prevent a trip from starting, and it can raise a report. It cannot adjust a score.

### 3.1 Sensor preconditions

Evaluated before any signal is computed. This is the fail-safe that P1 and P2 exist for.

A sensor is **available** when the OS reports the hardware present, a subscription is
active, and at least one sample has arrived within the last 5 seconds. Anything else is
**unavailable**.

| Sensor | Feeds | When unavailable |
|---|---|---|
| GPS speed | Signal 1 | Classification is suspended entirely — no verdict of any kind |
| Accelerometer | Signal 2 | Signal 2 is `UNKNOWN` |
| Gyroscope | Signal 3 | Signal 3 is `UNKNOWN` |

**A subscription that was never established is unavailable, not zero.** Initialising a
sensor value to `0` and leaving it there is the defect this section exists to prevent.

**Why we do not impute.** The industry's current direction is foundation models that
predict missing or incomplete sensor data and normalise across every source, so a gap in
one stream is filled rather than declared. That works at tens of millions of drivers, where
the imputation is itself learned and validated against ground truth. At our data scale an
imputed signal is a guess wearing the costume of a measurement, and it re-introduces
exactly the failure P2 exists to stop — a value that looks measured, reads as evidence, and
is not. We take the measurement or we record `UNKNOWN`. Revisit this only alongside a
dataset large enough to validate the imputation itself.

### 3.2 Reference frame

Signals 2 and 3 describe forces on *the vehicle*. A phone reports forces on *itself*, in
whatever orientation it happens to be sitting.

Both must therefore be resolved into the vehicle frame before comparison against any
threshold:

1. Isolate gravity with a low-pass filter; the residual is dynamic acceleration.
2. Project out the component along gravity. What remains is the horizontal force, and its
   magnitude is independent of the phone's yaw.
3. Resolve horizontal force into **longitudinal** and **lateral** using GPS heading as the
   forward reference.
4. Resolve angular rate about the gravity vector, not about the device's Z axis. That, and
   only that, is yaw.

Steps 1–2 already exist in the SDK for scoring events. The fraud path must use the same
treatment rather than reading raw device axes — a phone flat on a passenger seat at an
arbitrary rotation otherwise reports a car's cornering force as longitudinal and its
braking as lateral.

**Where the frame cannot be resolved** — no GPS heading, or gravity not yet converged —
the dependent signal is `UNKNOWN`.

### 3.3 The three signals

Each is `TRUE`, `FALSE`, or `UNKNOWN`, computed over a 60-sample sliding window at 1 Hz.

| Signal | Name on the wire | Physical claim | Condition for `TRUE` | Weight |
|---|---|---|---|---|
| 1 | `constantHighSpeed` | Rail holds a cruise speed; road traffic does not | speed variance < 8 km/h² **and** mean speed > 60 km/h | 0.40 |
| 2 | `noLateralForce` | Rails prevent sway; a road vehicle always corners | peak vehicle-frame lateral force < 0.12 g | 0.35 |
| 3 | `noHeadingChange` | Track geometry is fixed; a driver micro-corrects continuously | variance of yaw rate about gravity < 0.02 rad²/s² | 0.25 |

Signals are named for what the sensor observed, not by letter. These values are read out of
a database row months later, where "Signal B" means nothing.

**All three are kinematic, and that is a shared failure mode.** Speed, force, and rotation
are three descriptions of the same motion, not three independent views of the vehicle. The
dependency is concrete: every signal needs GPS, and signals 2 and 3 additionally share the
reference-frame resolution of Section 3.2 — so a phone at an unusual orientation, or a
heading that never converges, takes out both at once. The set has one common cause, and
weighting it 0.40 / 0.35 / 0.25 does not make it three votes.

This has a consequence for Stage 4 that is easy to miss: **a classifier trained on three
correlated features does not beat thresholds on three correlated features.** The model
inherits the correlation. Feature diversity has to come first, and it has to come from
observations that are not kinematic:

- **Route geometry against the map.** A rail alignment is not a road alignment. Matching the
  trace against the road and rail networks is independent of every force the phone feels.
- **Stop cadence and dwell periodicity.** Where a vehicle stops, for how long, and how
  regularly — timing structure rather than force magnitude. This is what separates bus from
  car, which Section 9 names as the genuinely hard case.
- **GPS fix quality and dropout.** Sustained loss of fix with motion continuing is the
  subway signature, and it is a property of the receiver rather than of the ride.

None of these needs new hardware. All of them need SDK data the fraud path does not receive
today, which makes them Stage 3 work: the features must be captured before Stage 4 has
anything to learn from.

### 3.4 Verdict and confidence

A verdict carries how much of the evidence was actually available.

```
score      = Σ weight(s) for each signal s that is TRUE          → 0.00 – 1.00
confidence = Σ weight(s) for each signal s that is not UNKNOWN   → 0.00 – 1.00

mode = TRAIN  when  score ≥ 0.70  and  signal2 = TRUE  and  signal3 = TRUE
       UNKNOWN otherwise
```

Requiring signals 2 **and** 3 explicitly, rather than trusting the weighted score, rejects
the one false positive the score alone cannot: a car on a straight motorway under cruise
control satisfies signals 1 and 2 and scores 0.75, while still producing the yaw of
micro-steering. Signal 3 is what separates them.

Because `UNKNOWN` never satisfies a `TRUE` requirement, an unavailable sensor makes a
`TRAIN` verdict unreachable. P1 and P2 are enforced by the shape of the rule, not by a
check that a future edit could drop.

**A verdict is only emitted once the window holds 30 samples.** Below that there is no
verdict — not a negative one.

### 3.5 What the device may decide

| Confidence | Device may |
|---|---|
| `= 1.00` and `mode = TRAIN` | Decline to start the trip, and report |
| `< 1.00` and `mode = TRAIN` | Report only. The trip proceeds. |
| any, `mode = UNKNOWN` | Nothing |

Declining to start is the only unilateral action the device takes, and it requires complete
evidence. Everything else is the server's call.

### 3.6 Report-once semantics

**One report per detected session, whether the verdict lands before or during a trip.**

A rejection returns the state machine to idle while the vehicle is still moving, so the
next window immediately begins re-accumulating and re-fires. Left unbounded, a single
train journey files one report every 30 seconds for its full duration — each with a distinct
key, so idempotency does not collapse them. The result is a fraud table that measures
journey length rather than fraud incidence, and a recalibration dataset weighted by how
long people sit on trains.

**After a `TRAIN` verdict, classification is suppressed until movement genuinely stops** —
speed below the trip-end threshold for the trip-end duration. One journey, one report.

### 3.7 The driver must be told

A trip that is silently declined is indistinguishable from a bug, and it is the failure a
false positive produces. Every decline surfaces a message naming the reason and offering a
path to dispute it (Section 5).

---

## 4. Layer 2 — server integrity pipeline

Settles whether a payload is authentic and physically possible. Runs on every
`POST /api/trips` regardless of what the client believes it already checked.

### 4.1 Gate order

```
  ①  Idempotency fast path   → return the stored trip, unchanged
  ②  Timestamp drift         → 401
  ③  Signature               → 403
  ④  Plausibility            → 422
  ⑤  Oracle + witnesses      → digest is authoritative; witnesses may only raise
  ⑥  Score
  ⑦  Persist
  ⑧  Idempotency race catch  → return the stored trip, or 409
```

Two properties of this order are load-bearing:

- **Idempotency is first and last.** First, because a retry must return the identical result
  without re-validating — a client retrying after a timeout has done nothing wrong. Last,
  because two concurrent submissions can both pass the fast path.
- **Authenticity precedes semantics.** A payload is proven to come from the client before
  the server comments on its contents. The reverse order answers "which field was
  implausible?" for a caller that has not established who they are — that is a tuning
  oracle for a forger.

### 4.2 What each gate settles

| Gate | Settles | On failure |
|---|---|---|
| **Drift** | The digest's timestamp is within ±5 minutes of server time, so this is not a replayed recording. | 401 |
| **Signature** | HMAC-SHA256 over the canonical JSON of the digest matches, compared in constant time. | 403 |
| **Plausibility** | Every scoring input is inside physical and economic bounds — score, points, distance, duration, implied average speed, every event count non-negative, risk multiplier in range. Checked on the DTO *and* on the digest, since the digest is what scores. | 422 |

**The signature gate is mandatory.** An absent signature, a placeholder prefix, and an unset
server secret are all rejections, not exemptions. Until Stage 2 of the maturity path lands,
a valid signature bounds this gate's meaning to "came from a copy of the client" — a real
control against payload editing in transit, not against a rooted device.

A signature mismatch is affirmative evidence of compromise, not missing evidence, so the
P2 exception applies: it rejects outright and is never softened into an unknown.

Every rejection is audit-logged with the reason. Every audit line is a row in the dataset
that decides whether a threshold is right.

### 4.3 Oracle and witnesses

The digest is the sole source of scoring inputs (P3). Two independent witnesses constrain
what it may claim:

- **The GPS trace witnesses event counts, upward only.** Server-detected events are merged
  as `max(client, server)`. A client cannot lower its penalty by suppressing detection, and
  a sparse trace never invents one.
- **The GPS trace witnesses distance, downward only.** Distance multiplies points directly
  and was otherwise unconstrained. A claim is capped at what the trace supports plus a
  deliberately generous tolerance, because a sampled trace cuts corners and structurally
  under-reports. A trip with no usable trace is not capped, but is audited — so the rate is
  measurable before anyone tightens it.

Asymmetry is the design: each witness may only move a value in the direction that costs the
submitter. A witness that could move a number either way is a second oracle, and P3 permits
only one.

---

## 5. Enforcement ladder

Detection produces a verdict. This table is what a verdict costs. Nothing else in the
system may withhold or reverse a driver's points.

| Rung | Trigger | Effect | Reversible by |
|---|---|---|---|
| **0 — Observe** | Any verdict, any confidence | Recorded as evidence. No effect on the trip. | n/a |
| **1 — Flag** | `TRAIN` at partial confidence, **or any probabilistic verdict at any likelihood** | Trip scores and pays. Marked for review. | Review |
| **2 — Withhold** | `TRAIN`, full confidence, deterministic, mid-trip | Trip scores; points held pending review. | Review |
| **3 — Decline** | `TRAIN`, full confidence, deterministic, before trip start | No trip is created. Driver is notified. | Driver dispute |
| **4 — Account review** | A pattern across trips, never one trip | Manual. Human decision. | Human decision |

Four rules govern the ladder:

- **A single trip never reaches rung 4.** Account-level action requires a pattern, because
  the cost of being wrong scales with the blast radius.
- **Every rung above 0 has a reversal path**, and the driver is told which one applies.
  Enforcement without appeal converts every false positive into a lost user.
- **Rungs 2 and above are owned by the CPO** (anti-fraud mechanics). Detection can be tuned
  by whoever owns the sensor; deciding what detection *costs* cannot.
- **A probabilistic verdict never rises above rung 1.** Any model that emits a likelihood
  rather than a decision — the Stage 4 transport-mode and driver/passenger classifiers —
  maps to rung 1 and no higher, no matter how confident it is on a given trip. Rungs 2 and
  3 stay reserved for deterministic, fully-evidenced verdicts. A well-calibrated 0.95 is
  still a probability, and at fleet volume its tail is not an abstraction: it is a steady
  stream of real drivers punished for a drive they made legitimately. Soft signals inform
  review; they do not take points.

---

## 6. Evidence contract

A report carries the verdict **and the evidence behind it**. The score alone says a session
was flagged; the signals say which rule fired and the telemetry says by how much — which is
what a recalibration or a false-positive investigation actually needs.

```jsonc
{
  "idempotencyKey": "fraud_<userId>_<sessionStart>",
  "tripDurationSeconds": 240,
  "distanceKm": null,               // null at rung 3 — no trip existed to measure
  "anomalyFlags": [
    "TRANSPORT_MODE_TRAIN",
    "SIGNAL_CONSTANT_HIGH_SPEED",   // one flag per signal that evaluated TRUE
    "SIGNAL_NO_LATERAL_FORCE",
    "SIGNAL_NO_HEADING_CHANGE"
  ],
  "detection": {
    "fraudScore": 1.0,
    "confidence": 1.0,
    "detectedMode": "TRAIN",
    "calibrationVersion": "2026-08-01",   // which thresholds produced this (P5)
    "signals": {                          // true | false | null — null is UNKNOWN
      "constantHighSpeed": true,
      "noLateralForce": true,
      "noHeadingChange": true
    },
    "telemetry": {                        // window aggregates only, never raw traces
      "avgSpeedKmh": 82.4,
      "maxLateralAccelG": 0.03,
      "yawVariance": 0.001
    },
    "sensorAvailability": {               // why a signal was UNKNOWN
      "gps": true, "accelerometer": true, "gyroscope": true
    },
    "maxSpeedKmh": 96.2,
    "detectedAt": "2026-08-01T09:00:00.000Z"
  }
}
```

Four properties are deliberate:

- **One name per value, end to end.** `fraudScore` is `fraudScore` in the detector, on the
  wire, and in the column. A value renamed at a layer boundary can no longer be traced back
  to the rule that produced it.
- **`null` means UNKNOWN, and is never coerced to `false`.** P2 holds on the wire or it
  holds nowhere.
- **`sensorAvailability` explains every `null`.** Without it, an unknown signal and a
  crashed subscription are indistinguishable in the stored evidence.
- **Signals are duplicated into `anomalyFlags`.** "Which rule caught this?" becomes a query
  on one indexed array rather than a scan through nested evidence.

---

## 7. Constants

Every value the system compares against, with where it came from. Values marked *unfitted*
are first calibrations chosen from physics and expectation, not from CARMA field data;
they are the ones Stages 3 and 4 of the maturity path exist to replace.

### Classification

| Constant | Value | Derivation |
|---|---|---|
| `WINDOW_SIZE` | 60 samples | 60 s at 1 Hz — long enough to span a motorway curve |
| `MIN_SAMPLES_TO_EVALUATE` | 30 | Aligns the first verdict with the trip-start rule |
| `SPEED_VARIANCE_THRESHOLD` | 8 km/h² | *Unfitted* |
| `MIN_AVG_SPEED_KMH` | 60 km/h | Rules out urban driving, where stop-go dominates |
| `LATERAL_ACCEL_MAX_G` | 0.12 g | *Unfitted* |
| `YAW_VARIANCE_THRESHOLD` | 0.02 rad²/s² | *Unfitted* |
| `FRAUD_SCORE_THRESHOLD` | 0.70 | Lowest score reachable without both signals 2 and 3 |
| `SENSOR_STALE_MS` | 5,000 ms | Availability cutoff (Section 3.1) |

### Trip lifecycle

| Constant | Value | Derivation |
|---|---|---|
| `SPEED_THRESHOLD_KMH` | 10 km/h | Above walking pace, below any road speed |
| `START_THRESHOLD_MS` | 30,000 ms | Sustained movement before a trip is real |
| `END_THRESHOLD_MS` | 180,000 ms | Long enough to survive a traffic light |

### Server bounds

| Constant | Value | Derivation |
|---|---|---|
| `_MAX_POINTS_PER_TRIP` | 10,000 | Economic ceiling |
| `_MAX_DISTANCE_KM` | 2,000 km | Longer than any single drive in-country |
| `_MAX_AVG_SPEED_KMH` | 250 km/h | Above any road vehicle |
| `_MAX_HARD_BRAKES` | 500 | Bounds a malformed payload |
| `_MAX_EVENTS_PER_TRIP` | 1,000 | Bounds the INSERT a hostile client can trigger |
| `_DRIFT_WINDOW_MS` | 300,000 ms | Replay window, ±5 min |
| `_DISTANCE_TOLERANCE` | +35% | Slack for a sampled trace that cuts corners |
| `_DISTANCE_GRACE_KM` | 1.0 km | Absolute floor for short trips |
| `EVIDENCE_RETENTION_MONTHS` | 12 | P6 |

### Detection quality

| Constant | Value | Derivation |
|---|---|---|
| `MAX_FALSE_POSITIVE_RATE` | 1.0% | Ceiling on legitimate car trips wrongly classified, measured against a labelled holdout |

---

## 8. Maturity path

Ordered by dependency, not by appeal. Each stage is blocked by the one above it.

### Stage 1 — Make the current design correct

Tri-state signals; sensor preconditions; vehicle-frame resolution; report-once; thresholds
delivered as versioned configuration; mandatory signature verification.

Nothing here needs new sensor data or a model. It is the difference between a design that
can be evaluated and one that cannot.

### Stage 2 — Establish device trust, and corroborate it independently

Two controls, shipped together.

**Device attestation.** Play Integrity and App Attest, then per-device signing keys derived
from attestation. This is the prerequisite that changes what every other control means.
Today a signature proves the payload came from a copy of the client; after attestation it
proves the payload came from a genuine, unmodified app on a genuine device. Mock-location
detection also becomes meaningful here — on a rooted device the mock-location flag can
simply be stripped, so checking it before attestation measures only the honest.

**Independent location corroboration.** The claimed GPS trace is cross-checked against
position derived from cell-tower and Wi-Fi observations. Where they disagree beyond a
tolerance, the trace is not trusted.

The second is not a refinement of the first — it is the reason Stage 2 is not a single
point of failure. Attestation and mock-location detection both execute *inside* the device
they are judging, so one sufficiently compromised device defeats both at once. Corroboration
is evidence gathered outside that trust boundary: a fabricated route still has to agree with
which towers the handset actually talked to. Neither control is sufficient alone, and a
plan that ships only attestation has bought one layer while describing two.

Both produce affirmative evidence of compromise under the P2 exception, not `UNKNOWN`.

### Stage 3 — Capture a trainable dataset

Windowed features recorded for **every** trip, not only flagged ones, plus a label source
(driver self-report, a small ground-truth panel, or transit-network cross-reference).

This is the stage everyone skips. Storing evidence only when a verdict fires produces a
dataset that is 100% positives, which cannot train or validate anything. There is no
shortcut from thresholds to a classifier that does not pass through here.

**Every label carries its provenance.** Self-report, panel, and cross-reference are not
interchangeable: the strongest published validation in this field is capped by self-reported
ground truth, where a participant can only report the misclassifications they happened to
notice. A dataset that mixes provenances without recording them silently inherits the
weakest one, and no later analysis can separate them again.

### Stage 4 — Replace thresholds with a classifier

Supervised model over windowed features, emitting a mode with a calibrated probability.

Unlocks what a hand-tuned conjunction of three thresholds structurally cannot: bus, metro,
and bicycle modes; a tunable false-positive/false-negative trade-off; and driver-versus-
passenger classification, which is the highest-value control in the system and is not
reachable by any rule we could write by hand.

Its output is probabilistic, so by the rule in Section 5 it feeds rung 1 and never
hard-declines a trip.

### Stage 5 — Cross-trip and fleet baselines

Per-user statistical baselines and fleet percentiles — score jumps, points per kilometre,
suspiciously perfect event rates. Flags feed rungs 1 and 4 of the ladder, never rung 3:
a statistical outlier is evidence about a pattern, not proof about a trip.

Also here: GPS teleportation checks between consecutive waypoints, and IMU-versus-GPS speed
consistency, both of which need per-sample data the digest does not currently carry.

---

## 9. Benchmarks

What the target is measured against. These are published figures from the telematics
industry, not CARMA results.

| Capability | Published figure | Source |
|---|---|---|
| Driver vs. passenger | 96.5% accuracy (SD 5.1) · 97.5% sensitivity (SD 4.6) · **91.2% specificity (SD 14.8)** | Independent validation of a production UBI classifier; 57 participants, ~8,372 trips over 4 weeks |
| Driver vs. passenger | 97% accuracy | CMT, company-stated for its refined algorithms |
| Transport mode, 6 classes | 91% overall; >95% for vehicle and bicycle | Sentiance, held-out users |
| Transport mode, academic | ~86–89% macro F1 on SHL/HTC | Temporal convolutional networks |

Four findings shape the design above.

- **Driver versus passenger is solved from phone sensors alone.** The validated classifier
  used no OBD-II dongle and no Bluetooth beacon. What it requires is a trained model — which
  is why it sits at Stage 4 and not permanently in the accepted losses of Section 1.
- **Specificity is our metric, not accuracy.** Layer 1 exists to catch the non-driver, and
  that is what specificity measures: 91.2%, against a headline accuracy of 96.5%. The gap is
  class balance — the study's participants averaged 120.9 driver trips against 26.5
  non-driver, so roughly four in five trips were the easy class. Even at the industry's best,
  about one passenger trip in eleven is scored as driving. Any CARMA target quoted as
  "accuracy" is measuring the wrong thing.
- **The 14.8 standard deviation is a design constraint, not noise.** A control that varies
  that widely across users works well for most and badly for a minority — and that minority
  is not random. It is the users whose phone placement, vehicle, or habits sit outside the
  common case, which is precisely the population Section 3.2's reference-frame requirement
  exists to protect. Fleet-average performance will hide them; per-user measurement will not.
- **Car versus bus is the genuinely hard case.** Sentiance merges the two classes because
  sensor signal alone cannot separate them, and recovers the distinction from driving
  behaviour rather than kinematics. Any bus detector built on stop-frequency and door
  vibration should expect to be beaten by a car in city traffic.

One caveat bounds all of it: the driver/passenger validation used participant self-report
rather than instrumented ground truth, so its figures are an optimistic ceiling. This is the
same limit Stage 3's provenance requirement is written to expose in our own data.

---

## 10. Conformance

Invariants, written so they can be asserted by a test rather than tracked in a table.

1. No verdict of `TRAIN` is reachable while any contributing sensor is unavailable.
2. A signal derived from an unavailable sensor serialises as `null`, never `false`.
3. A sensor value that has never received a sample is unavailable, not zero.
4. A single detected session produces at most one fraud report.
5. Every threshold in Section 7 is readable from server-delivered configuration, and the
   calibration version appears in every report.
6. `POST /api/trips` rejects an unsigned, placeholder-signed, or unverifiable payload.
7. No gate returns a semantic error (422) for a payload that has not passed 401 and 403.
8. A witness never moves a scoring input in the direction that benefits the submitter.
9. No detector writes to a points balance.
10. Every enforcement above rung 0 produces a driver-visible notification naming its
    reversal path.
11. Fraud evidence older than `EVIDENCE_RETENTION_MONTHS` is deleted by a scheduled job.
12. No raw sensor sample trace is transmitted off the device.
13. The false-positive rate on legitimate car trips, measured against a labelled holdout,
    does not exceed `MAX_FALSE_POSITIVE_RATE`. Reported as specificity, never as accuracy,
    and broken down per user rather than as a fleet mean.
14. Every labelled sample records its label provenance, and no training or validation set
    reports a quality stronger than its weakest provenance.
15. A probabilistic verdict never triggers an enforcement rung above 1.
16. Affirmative evidence of compromise is never coerced to `UNKNOWN`, and never accepted
    under P1.

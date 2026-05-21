# CARMA Scoring Engine — Algorithm Reference

> **Audience:** Students, professors, and external developers evaluating the CARMA platform.  
> **Source of truth:** [`scoring.py`](scoring.py) — the FastAPI server is the sole scoring oracle.  
> All values produced here are authoritative; the mobile client never computes or stores a final score.

---

## 1. Core Philosophy

CARMA evaluates every completed trip against a **baseline of 100 points**. Points are
deducted for unsafe driving events detected in real time by the hardware sensor suite.
The output is a **Safety Score** (0–100) plus a **CARMA Points** reward that reflects
both how safely *and* how far the driver traveled.

The two outputs serve different purposes:

| Output | Range | Purpose |
|---|---|---|
| `score` | 0 – 100 | Safety grade — shown to the driver as feedback |
| `points` | 0 – ∞ | Gamification reward — accumulated in the driver's account |

---

## 2. Input Metrics

The server receives the following raw sensor metrics inside each `TelemetryDigest`:

| Field | Unit | Captured by |
|---|---|---|
| `hard_brakes` | count | Accelerometer — sudden deceleration above threshold |
| `aggressive_accels` | count | Accelerometer — abrupt forward acceleration |
| `sharp_turns` | count | Gyroscope — excessive lateral G-force |
| `touch_epochs` | count | Active interaction epochs: foreground touch events + IMU vibration proxy when backgrounded |
| `screen_interaction_seconds` | seconds | IMU accelerometer-variance analysis — hand-held phone detection, independent of foreground app |
| `duration_seconds` | seconds | Trip timer |
| `distance_km` | km | GPS odometer |
| `start_time` | UTC datetime | GPS timestamp at trip start |

> **What is not an input:** The client-submitted `avgScore` and `points` fields are
> intentionally ignored. The server recomputes everything from the raw sensor metrics above.
>
> **v1.7 — Waze false positive resolved:** The previous `phone_seconds` field counted all
> time CARMA spent in the background as distraction time, penalising drivers who used
> navigation apps (Waze, Google Maps) while CARMA ran in the background — even when the
> phone was mounted. The new `touch_epochs` + `screen_interaction_seconds` pair measures
> active physical interaction instead of passive screen state.

---

## 3. The Scoring Formula

The formula runs in two sequential stages: **Safety Score** and **Points Reward**.

### Stage 1 — Safety Score (0–100)

#### Step 1.1 — Penalty Calculation

Each unsafe event type carries a fixed deduction weight:

```
penalties = (hard_brakes                                     × 5)
          + (aggressive_accels                               × 3)
          + (sharp_turns                                     × 2)
          + (touch_epochs                                    × 4)
          + (screen_interaction_seconds / max(duration_seconds, 1)) × 40
```

| Event | Weight | Rationale |
|---|---|---|
| Hard brake | **−5 pts** | High crash-risk manoeuvre |
| Aggressive acceleration | **−3 pts** | Aggressive but recoverable |
| Sharp turn | **−2 pts** | Lateral instability |
| Touch interaction | **−4 pts each** | Per discrete active-interaction epoch detected |
| Hand-held screen time | **−0 to −40 pts** | Proportional to fraction of trip with phone confirmed hand-held by IMU |

The hand-held penalty is **time-proportional**: a driver with the phone in hand for the
entire trip (`screen_interaction_seconds == duration_seconds`) loses the full 40 points.
The touch penalty is **event-counted**: each distinct active interaction epoch (foreground
touch or IMU vibration proxy when backgrounded) deducts 4 points regardless of duration.

**Why two separate distraction metrics?**
`touch_epochs` captures discrete intentional interactions (picking up the phone, typing
a message). `screen_interaction_seconds` captures sustained hand-held usage even when no
explicit touch event is detected — for example, reading a message. Together they produce
a more accurate distraction model than raw screen-on time.

#### Step 1.2 — Score (clamped)

```
score = clamp(100 − penalties, 0, 100)
```

The score can never go negative — 100 penalty points or more results in a floor of `0`.

---

### Stage 2 — Points Reward

A safe score alone does not determine reward magnitude. Two additional factors
scale the raw score into a **CARMA Points** value:

#### Step 2.1 — Distance Factor

```
distance_factor = ln(distance_km + 1) / ln(11)
```

This is a **logarithmic scaling** of trip distance. It rewards drivers who maintain
safe behavior over longer journeys, while preventing short urban trips from earning
disproportionately large rewards.

| Trip distance | Distance factor |
|---|---|
| 0 km | 0.000 — no reward (trip too short) |
| 5 km | 0.747 |
| 10 km | 1.000 — reference point |
| 50 km | 1.640 |
| 100 km | 1.956 |

**Key property:** The curve flattens above ~10 km. A driver cannot earn unlimited points
simply by driving farther — safe behavior is always the dominant variable.

> **Important distinction:** Distance does not affect the Safety Score (0–100).
> Three hard brakes produce the same −15 score deduction on a 2 km trip and a 50 km
> highway run. Distance only scales the *Points* reward for a given score.

#### Step 2.2 — Risk Multiplier

```
risk_multiplier = get_risk_multiplier(start_time)
```

Driving during statistically high-risk periods earns a **bonus multiplier** on Points,
reflecting the greater road hazard exposure:

| Time window | Multiplier | Condition |
|---|---|---|
| 04:00 – 22:59 (any day) | **1.0×** | Standard daytime |
| 23:00 – 03:59 (Sun – Wed) | **1.5×** | Weeknight |
| 23:00 – 03:59 (Thu – Sat) | **2.0×** | Israeli weekend night |

The Israeli weekend boundary (Thursday night through Saturday night) reflects local
traffic patterns where road fatality rates are significantly elevated.

The multiplier rewards the driver for *choosing to drive safely* in conditions where
most accidents occur — it does not penalise them. A driver with a perfect score at
2 AM on a Friday earns twice the points they would earn for the same trip at noon.

#### Step 2.3 — Final Points

```
points = score × distance_factor × risk_multiplier
```

Both `score` and `points` are **rounded to one decimal place** before storage.

---

## 4. Complete Formula Summary

```
safe_duration   = max(duration_seconds, 1)

penalties       = hard_brakes                                × 5
                + aggressive_accels                          × 3
                + sharp_turns                                × 2
                + touch_epochs                               × 4
                + (screen_interaction_seconds / safe_duration) × 40

score           = clamp(100 − penalties,  0.0, 100.0)

distance_factor = ln(distance_km + 1) / ln(11)

risk_multiplier = 1.0  if daytime
                  1.5  if weeknight (Sun–Wed, 23:00–03:59)
                  2.0  if weekend night (Thu–Sat, 23:00–03:59)

points          = score × distance_factor × risk_multiplier
```

---

## 5. Worked Example

**Trip:** 12 km highway drive, Thursday 23:30, 2 hard brakes, 5 active touch interactions,
phone confirmed hand-held for 60 of 900 seconds.

```
penalties       = (2 × 5) + (0 × 3) + (0 × 2) + (5 × 4) + (60 / 900) × 40
                = 10 + 0 + 0 + 20 + 2.67
                = 32.67

score           = clamp(100 − 32.67,  0, 100)  =  67.3

distance_factor = ln(13) / ln(11)              =  1.070

risk_multiplier = 2.0   (Thu night)

points          = 67.3 × 1.070 × 2.0          =  144.0
```

The driver receives a **Safety Score of 67.3** and earns **144.0 CARMA Points**.
The 5 touch interactions (−20 pts) combined with 60 seconds of confirmed hand-held usage
(−2.7 pts) account for the bulk of the deduction alongside the 2 hard brakes (−10 pts).

**Contrast — navigation-app driver (same trip, phone mounted):**

A driver using Waze for the full 900-second trip with the phone on a mount produces
`touch_epochs = 0` and `screen_interaction_seconds = 0` (IMU variance stays low,
indicating a stationary mounted device). The distraction penalty is **0 pts**, yielding
`score = 90.0` and `points = 192.6` — no false positive.

---

## 6. Security & Anti-Fraud Architecture

The scoring engine is intentionally server-side only. The mobile client transmits raw
sensor counts inside a signed `TelemetryDigest`; it never sends or stores a computed
score. This design prevents:

- **Score spoofing** — a modified client cannot inflate its own score.
- **Replay attacks** — the digest includes a millisecond-precision timestamp; the server
  rejects requests older than ±5 minutes with HTTP 401.
- **Payload tampering** — the digest is HMAC-SHA256 signed; mismatched signatures return
  HTTP 403.

See [`../../../docs/RFC-001-Hybrid-Validation.md`](../../../docs/RFC-001-Hybrid-Validation.md)
for the full cryptographic specification.

---

*CARMA Platform — Scoring Engine v1.7 | Authored by Dan Ofri (CTO)*

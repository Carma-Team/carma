"""CARMA scoring engine — the only one (stages 3–7).

Spec: docs/scoring.md. This module owns the trip score, the driver score and
points. The `version` on ScoringConfig is stamped onto every trip row
(`trips.scoring_version`) so an old score stays interpretable after the formula
moves; it is not a name for the engine.

July 2026 recalibration: the decay constants were re-fit from the live fleet's
recency-weighted rate distributions — the initial estimates produced a bimodal
score distribution (exact 100, or a cliff to ~50 from a single event). They are
provisional: a proper fit needs ~200 trips, trustworthy client detection and
per-event severity. See CAR-102, which owns those dependencies. The same round added
`apply_confidence`, which caps how far a trip can score above the driver's
rolling score when the GPS trace is too sparse to prove clean driving.

Everything here is pure: no I/O, no DB, no side effects. The trips service feeds
it values sourced from the signed telemetry digest (the oracle) and persists the
results into the shadow columns.

What is NOT yet available, and how this module copes until it is:
  * Per-event severity (peak_g, duration_ms, speed_at_event) — the client has
    sent peak_g and duration_ms since #48, but peak_g arrives as an unsigned
    horizontal magnitude, not the per-axis vehicle-frame value the curve maps
    (CAR-156). Until a phone-to-vehicle rotation exists, weighted counts collapse
    to raw counts (each event weight 1.0). `event_severity()` is implemented and
    tested now so the downstream math is unchanged the day that value arrives.
  * Speeding against posted limits arrived in 2.3.0 (CAR-222). It is measured as
    a share of distance rather than as weighted minutes, so `k_speed` is a new
    constant on a new scale and not a re-tuning of the old one. The weight is
    still redistributed ("Blending the five") on any trip the map cannot cover.
"""

from __future__ import annotations

import math
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date
from typing import Literal

WeakestFactor = Literal["braking", "acceleration", "cornering", "speeding", "distraction"]


@dataclass(frozen=True)
class ScoringConfig:
    """Scoring parameters. `version` is stamped onto each scored trip. Decay
    constants re-fit 2026-07 from the live fleet's recency-weighted rate
    percentiles (CAR-102 — provisional until the fleet is bigger):
    anchored so a single event on a median trip costs ~5–10 composite points and
    the weighted p90-worst trip lands near 50, per "Rate to subscore"."""

    version: str = "2.3.0"

    # Exponential-decay rate constants k_c (subscore = 100 * exp(-k * rate)).
    k_brake: float = 0.018
    k_accel: float = 0.022
    k_corner: float = 0.012
    # Speeding's rate is not an event rate. It is the percentage of judged
    # distance driven above the posted limit plus the 10 km/h buffer, so this
    # constant has nothing to do with the 0.012 that preceded it - that one
    # priced severity-weighted minutes per 100 km against a flat 130 km/h.
    #
    # Anchored, not fitted (CAR-102 owns the fit): 1% of distance just over the
    # buffer scores 95, 10% scores 61. The reference behind those is the UBI
    # literature's average driver, who spends 2.4% of distance above the posted
    # limit (Guillen et al., percentile charts for speeding), so an ordinary
    # driver should land in the 90s and the spread should come from the tail.
    # `scripts/calibrate_speeding.py` replaces this with a real number, and it
    # matters more than when this constant was first written: severity bands
    # multiply the rate by up to 8, so k is doing a far wider job than the two
    # anchors alone describe.
    k_speed: float = 0.05
    # Not from the 2026-07 fleet fit: anchored on CMT's published US average of
    # 82 handling-seconds per driving hour, which must land near 75/100 (CAR-54).
    k_distraction: float = 0.0035

    # Composite weights when speeding data IS available ("Blending the five").
    w_distraction: float = 0.30
    w_speed: float = 0.25
    w_brake: float = 0.20
    w_accel: float = 0.15
    w_corner: float = 0.10

    # Composite weights when speeding data is NOT available — speeding's 0.25
    # redistributed proportionally across the remaining four.
    w_distraction_nospeed: float = 0.40
    w_brake_nospeed: float = 0.27
    w_accel_nospeed: float = 0.20
    w_corner_nospeed: float = 0.13

    # Exposure normalization ("Rates, not totals").
    exposure_floor_km: float = 4.0
    distraction_time_floor_min: float = 5.0

    # Short-trip dampening ("Short trips are judged gently").
    short_trip_km: float = 2.0
    short_trip_min: float = 5.0

    # Driver score ("The driver's own score").
    ewma_halflife_days: float = 14.0
    credibility_full_km: float = 300.0
    prior_score: float = 75.0
    # Most exposure one trip can contribute, so that "no single trip may have a
    # major impact on the overall score" (CMT, US12071140B2 — their worked example
    # caps a 200-mile trip's behaviours at a 100-mile threshold). 30 km is a tenth
    # of the credibility window above, which puts ten capped trips between a new
    # driver and a fully proven one — the same window CMT state as their other
    # option, "the last 10 trips".
    trip_exposure_cap_km: float = 30.0

    # Streak ("Streaks"). A day clears the bar when its distance-weighted average
    # trip score reaches this. 80 is the top band of the level cap — the score at
    # which a driver's level stops being held back — so "a good day" means the
    # same thing in both places.
    #
    # A first calibration, not a fitted number: there is no fleet score
    # distribution yet (CAR-102). Watch two failure modes before moving it — if
    # almost every day clears, the streak is decoration; if almost none do, it is
    # dead. One known trap: `apply_confidence` caps a trip at the driver's rolling
    # score when the GPS trace is sparse, so a driver below 80 on a chronically
    # under-reporting device can never clear this bar. That is #17 to fix, not a
    # reason to lower the bar.
    streak_qualifying_score: float = 80.0

    # Points engine ("Points").
    #
    # The night risk multiplier pays for driving well when it is hardest, not for
    # being on the road when it is hardest. Below this score it is worth nothing;
    # it tapers to its full time-of-day value at 100. Uncalibrated — check where
    # the fleet's trip scores actually sit before treating 70 as settled.
    risk_multiplier_floor_score: float = 70.0
    # Two ceilings, two jobs — and only one of them is about money.
    #
    # The month is the economic ceiling: what the catalogue will pay one driver.
    # At roughly ₪0.10 a point, 3,000 is ~₪300 a month, level with Discovery's
    # Vitality Drive. Both it and LETSTOP publish a monthly figure and no daily
    # one. Recalibrate against real redemption volume, not taste.
    #
    # The day is a rate limiter against exploitation, so it belongs *above* the
    # honest maximum, not below it: at 500 the only thing it clips is 150 km at
    # night at the top of the ladder, while still forcing six days to drain a
    # month. It was briefly set to 150, which clipped an ordinary weekday
    # commute at level 10 — a daily cap that a real driver can feel is priced as
    # an economic ceiling, and that job is the month's.
    daily_points_cap: float = 500.0
    rolling_month_points_cap: float = 3_000.0
    daily_distance_cap_km: float = 150.0


# Ceiling on the severity-weighted speeding ratio, mirroring telemetry's own so
# this module stays a complete description of the formula on its own.
MAX_SPEEDING_RATIO = 8.0

CONFIG = ScoringConfig()

# Per-type g-force ranges for the continuous severity weight ("Severity is
# built but switched off").
_SEVERITY_RANGES = {
    "brake": (0.30, 0.60),
    "accel": (0.27, 0.55),
    "corner": (0.35, 0.65),
}


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


# ─── Stage 1 — continuous severity weight (ready for the SDK) ──────────────────


def event_severity(event_type: str, peak_g: float, duration_ms: float) -> float:
    """Continuous severity weight for one kinematic event.

    Ranges from 1.0 at the detection threshold to 3.0 for an extreme, sustained
    event. Replaces tier counting so there is no threshold to game.

    Speed is deliberately not an input. It is already scored as its own component
    at weight 0.25, so scaling event severity by it charged a hard brake at
    motorway speed twice.

    `peak_g` must be a single axis in the vehicle's frame — longitudinal for
    brake and accel, lateral for corner. A raw horizontal magnitude from a phone
    at an unknown orientation is a different quantity, and the ranges below do
    not describe it.

    Not called yet: the client does send peak_g, but as an unsigned horizontal
    magnitude — a different quantity from the one above, so feeding it here
    would collapse every event onto the minimum weight. Kept tested so the day a
    vehicle-frame value arrives, the only change upstream is summing severity
    instead of counting events.
    """
    g_min, g_max = _SEVERITY_RANGES[event_type]
    g_norm = _clamp((peak_g - g_min) / (g_max - g_min), 0.0, 1.0)
    g_factor = g_norm**1.5 + 1.0
    duration_factor = 1.0 + min(duration_ms / 2000.0, 0.5)
    return float(g_factor * duration_factor)


# ─── Stages 3–5 — trip score ───────────────────────────────────────────────────


@dataclass(frozen=True)
class TripScoreV2:
    score: float
    sub_braking: float
    sub_acceleration: float
    sub_cornering: float
    sub_speeding: float
    sub_distraction: float
    weakest_factor: WeakestFactor | None
    version: str


def _subscore(rate: float, k: float) -> float:
    """Exponential-decay map from a per-exposure rate to a 0–100 subscore."""
    return 100.0 * math.exp(-k * max(0.0, rate))


def compute_trip_score(
    *,
    w_brake: float,
    w_accel: float,
    w_corner: float,
    w_distraction: float,
    speeding_ratio: float = 0.0,
    distance_km: float,
    duration_min: float,
    driving_min_above_threshold: float | None = None,
    has_speed_data: bool = False,
    rolling_score: float | None = None,
    config: ScoringConfig = CONFIG,
) -> TripScoreV2:
    """Composite 0–100 trip score from severity-weighted event counts
    (scoring.md "Rates, not totals" and "Rate to subscore").

    `w_*` are severity-weighted counts (Σ severity per type). In shadow mode each
    event contributes weight 1.0, so these equal raw counts. Distance and time
    are the exposure denominators. `driving_min_above_threshold` is distraction's
    own denominator — minutes spent actually driving — and falls back to wall-clock
    duration when the GPS trace cannot supply it. `speeding_ratio` is the
    severity-weighted share of judged distance driven above the posted limit, in
    [0, MAX_SPEEDING_RATIO]: 1.0 is a whole trip spent just over the buffer, and
    anything above that is distance spent far over it.
    `has_speed_data` selects the weight set; `rolling_score` is the driver's
    current score, used only to dampen tiny trips.
    """
    exposure_km = max(distance_km, config.exposure_floor_km)
    # Distraction is charged per *driving* hour, not per hour of trip: a parked
    # tail dilutes the rate, and picking the phone up on arrival is not driving.
    distraction_exposure_min = max(
        duration_min if driving_min_above_threshold is None else driving_min_above_threshold,
        config.distraction_time_floor_min,
    )

    r_brake = w_brake * 100.0 / exposure_km
    r_accel = w_accel * 100.0 / exposure_km
    r_corner = w_corner * 100.0 / exposure_km
    r_distraction = w_distraction * 60.0 / distraction_exposure_min  # per driving-hour
    # Speeding carries its own exposure. It is already a share of the trip's own
    # distance, so dividing by kilometres again would charge the same behaviour
    # twice - and, because a car covers less ground per minute of speeding in a
    # 50 zone than on a motorway, the old per-100 km rate priced identical
    # urban and motorway offences differently.
    r_speed = 100.0 * _clamp(speeding_ratio, 0.0, MAX_SPEEDING_RATIO)

    sub_brake = _subscore(r_brake, config.k_brake)
    sub_accel = _subscore(r_accel, config.k_accel)
    sub_corner = _subscore(r_corner, config.k_corner)
    sub_speed = _subscore(r_speed, config.k_speed)
    sub_distraction = _subscore(r_distraction, config.k_distraction)

    weighted_candidates: list[tuple[WeakestFactor, float, float]]
    if has_speed_data:
        score = (
            config.w_distraction * sub_distraction
            + config.w_speed * sub_speed
            + config.w_brake * sub_brake
            + config.w_accel * sub_accel
            + config.w_corner * sub_corner
        )
        weighted_candidates = [
            ("distraction", sub_distraction, config.w_distraction),
            ("speeding", sub_speed, config.w_speed),
            ("braking", sub_brake, config.w_brake),
            ("acceleration", sub_accel, config.w_accel),
            ("cornering", sub_corner, config.w_corner),
        ]
    else:
        score = (
            config.w_distraction_nospeed * sub_distraction
            + config.w_brake_nospeed * sub_brake
            + config.w_accel_nospeed * sub_accel
            + config.w_corner_nospeed * sub_corner
        )
        # Speeding is excluded, not just zero-weighted: sub_speed is still
        # computed above but carries no weight here, so naming it would blame
        # a behaviour that cost nothing.
        weighted_candidates = [
            ("distraction", sub_distraction, config.w_distraction_nospeed),
            ("braking", sub_brake, config.w_brake_nospeed),
            ("acceleration", sub_accel, config.w_accel_nospeed),
            ("cornering", sub_corner, config.w_corner_nospeed),
        ]

    # Named factor is the largest *weighted* loss, weight * (100 - subscore) —
    # the exact counterfactual the composite implies on a full-length trip,
    # since perfecting one behaviour raises the score by precisely that
    # amount (the short-trip blend below makes it inexact there). Candidate
    # order above must stay descending by weight so a tie resolves to the
    # higher-weighted behaviour; asserted here so a retuned weight fails loudly
    # instead of silently reordering the tie-break. A trip where every
    # candidate's subscore is above 90 (or every loss is zero) means there is
    # nothing worth naming.
    assert all(
        a[2] >= b[2] for a, b in zip(weighted_candidates, weighted_candidates[1:], strict=False)
    ), "weighted_candidates must stay sorted by descending weight for the tie-break to hold"
    weakest_factor: WeakestFactor | None = None
    best_loss = 0.0
    min_subscore = 100.0
    for name, subscore, weight in weighted_candidates:
        min_subscore = min(min_subscore, subscore)
        loss = weight * (100.0 - subscore)
        if loss > best_loss:
            weakest_factor, best_loss = name, loss
    if weakest_factor is not None and min_subscore > 90.0:
        weakest_factor = None

    # Too little exposure to judge — blend 50/50 with the driver's standing.
    if rolling_score is not None and (distance_km < config.short_trip_km or duration_min < config.short_trip_min):
        score = 0.5 * score + 0.5 * rolling_score

    return TripScoreV2(
        score=round(_clamp(score, 0.0, 100.0) * 10) / 10,
        sub_braking=round(sub_brake * 10) / 10,
        sub_acceleration=round(sub_accel * 10) / 10,
        sub_cornering=round(sub_corner * 10) / 10,
        sub_speeding=round(sub_speed * 10) / 10,
        sub_distraction=round(sub_distraction * 10) / 10,
        weakest_factor=weakest_factor,
        version=config.version,
    )


def apply_confidence(raw_score: float, rolling_score: float, confidence: float) -> float:
    """Cap a trip score's *upside* by telemetry confidence (v2.1).

    A sparse or gappy GPS trace makes "zero events" weak evidence — a device
    that under-detects (or under-reports) would otherwise bank a perfect 100
    every trip. The asymmetry is deliberate: low confidence limits how far a
    trip can score above the driver's rolling standing, but reported events are
    positive evidence and are never diluted, so scores at or below the rolling
    standing pass through untouched. `confidence` comes from telemetry.analyze.
    """
    if raw_score <= rolling_score:
        return raw_score
    c = _clamp(confidence, 0.0, 1.0)
    return round((rolling_score + c * (raw_score - rolling_score)) * 10) / 10


# ─── Stage 6 — driver score (EWMA over exposure + credibility) ──────────────────


@dataclass(frozen=True)
class TripHistoryPoint:
    trip_score: float
    distance_km: float
    age_days: float


def compute_driver_score(history: list[TripHistoryPoint], config: ScoringConfig = CONFIG) -> float:
    """Persistent driver-level score: recency- and exposure-weighted average
    of recent trip scores, blended with a fleet-median prior for cold start.

    A new driver with no history returns the prior (75) rather than a meaningless
    100 — "good, unproven".

    Each trip contributes at most `trip_exposure_cap_km`, to both the average and
    the credibility blend. Uncapped, one 300 km drive both outvoted a month of
    commuting and declared the driver fully proven on a single stretch of
    motorway; the cap is what makes the number an average of drives rather than
    an average of kilometres.
    """
    if not history:
        return config.prior_score

    weighted_score = 0.0
    weighted_km = 0.0
    total_km = 0.0
    for h in history:
        decay = 0.5 ** (max(0.0, h.age_days) / config.ewma_halflife_days)
        exposure = min(max(0.0, h.distance_km), config.trip_exposure_cap_km)
        w = exposure * decay
        weighted_score += h.trip_score * w
        weighted_km += w
        total_km += exposure

    driver_raw = weighted_score / weighted_km if weighted_km > 0 else config.prior_score
    credibility = min(total_km / config.credibility_full_km, 1.0)
    score = credibility * driver_raw + (1.0 - credibility) * config.prior_score
    return round(_clamp(score, 0.0, 100.0) * 10) / 10


# ─── Stage 7 — points engine ────────────────────────────────────────────────────


def risk_multiplier_earned(base: float, trip_score: float, config: ScoringConfig = CONFIG) -> float:
    """How much of the time-of-day risk multiplier a trip actually earns.

    The full multiplier is for driving well at the hardest hours. Paid flat, it
    pays for *being out* at those hours instead — the same context the industry
    uses to raise measured risk, we would be using to raise the payout.

    A taper rather than a cut at the floor: two trips a tenth of a point apart
    must not differ twofold in what they pay.
    """
    span = 100.0 - config.risk_multiplier_floor_score
    earned = _clamp((trip_score - config.risk_multiplier_floor_score) / span, 0.0, 1.0)
    return 1.0 + (max(1.0, base) - 1.0) * earned


def compute_points(
    *,
    trip_score: float,
    distance_km: float,
    risk_multiplier: float,
    level_multiplier: float = 1.0,
    points_today: float = 0.0,
    points_month: float = 0.0,
    distance_today_km: float = 0.0,
    fraud_flagged: bool = False,
    config: ScoringConfig = CONFIG,
) -> float:
    """Gamification points for a trip (scoring.md "Points"), with anti-grind caps.

    Fraud-flagged trips earn nothing and are excluded from the driver window by
    the caller. Distance counted toward points is capped per day, and the daily
    points total is capped, so commercial drivers can't farm the economy.

    The level bonus is one of the multipliers here rather than something the
    caller applies afterwards, so the daily cap lands on the final figure. A cap
    a level-10 account could double would be exactly the account worth grinding.
    """
    if fraud_flagged:
        return 0.0

    # Per-day distance counted toward points is capped.
    remaining_km = max(0.0, config.daily_distance_cap_km - max(0.0, distance_today_km))
    counted_km = min(max(0.0, distance_km), remaining_km)

    distance_factor = math.log(counted_km + 1.0) / math.log(11.0)
    earned_risk = risk_multiplier_earned(risk_multiplier, trip_score, config)
    points = trip_score * distance_factor * earned_risk * max(0.0, level_multiplier)

    # Whichever ceiling is nearer. Applied last, so the level bonus changes how
    # fast a driver reaches a ceiling, never where it sits.
    #
    # The month is rolling rather than calendar: a reset date is a farming date,
    # and the trip history the caller already loaded spans 30 days either way.
    remaining = min(
        config.daily_points_cap - max(0.0, points_today),
        config.rolling_month_points_cap - max(0.0, points_month),
    )
    return round(min(points, max(0.0, remaining)) * 10) / 10


# ─── Streaks ────────────────────────────────────────────────────────────────────


def compute_streak(
    trips: Iterable[tuple[date, float, float]],
    last_day: date,
    config: ScoringConfig = CONFIG,
) -> int:
    """Driving days in a row the driver drove well, counted back from `last_day`.

    Each item is one trip as `(day, trip_score, distance_km)`. The caller owns the
    timezone the day is read in and how far back the history reaches.

    Deliberately worth nothing (scoring.md "Streaks"). The points formula already
    pays more for a higher score on every trip, so a streak multiplier would have
    charged twice for the same behaviour; every large streak mechanic in the wild
    — Duolingo, Snapchat, Nike Run Club — leaves the count itself as the reward.

    Three rules, each rejecting a simpler one that is wrong:

    * A day counts on its **distance-weighted average**, not on "any trip that
      day" (which one short good drive would whitewash) and not on "every trip"
      (which one would destroy).
    * Days without a trip are **skipped**, not broken. The only thing that ends a
      run is driving badly — breaking on a quiet day pays drivers to take the car
      out, and the safest kilometre is the one nobody drives.
    * Trips after `last_day` are ignored, because callers pass *yesterday*: a day
      still in progress can be banked on a good morning and spoiled by evening,
      and points paid at the higher count cannot be taken back.

    A run therefore reaches no further than the history it is handed, so a gap
    longer than the caller's window ends it — the intended expiry, not an
    artefact. A streak that survives an indefinite absence is not a streak.
    """
    by_day: dict[date, list[tuple[float, float]]] = {}
    for day, score, distance_km in trips:
        if day <= last_day:
            by_day.setdefault(day, []).append((score, max(0.0, distance_km)))

    streak = 0
    for day in sorted(by_day, reverse=True):
        scored = by_day[day]
        total_km = sum(km for _score, km in scored)
        # The distance witness can cut a trip to nothing, leaving a day with no
        # weight to average by. Plain mean rather than dropping the day, so a
        # zero-distance day still has to be earned.
        average = (
            sum(score * km for score, km in scored) / total_km
            if total_km > 0
            else sum(score for score, _km in scored) / len(scored)
        )
        if average < config.streak_qualifying_score:
            break
        streak += 1
    return streak

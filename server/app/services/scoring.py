"""CARMA scoring engine — the only one (stages 3–7).

Spec: docs/scoring.md. This module owns the trip score, the driver score and
points. The `version` on ScoringConfig is stamped onto every trip row
(`trips.scoring_version`) so an old score stays interpretable after the formula
moves; it is not a name for the engine.

July 2026 recalibration: the decay constants were re-fit from the live fleet's
recency-weighted rate distributions — the initial estimates produced a bimodal
score distribution (exact 100, or a cliff to ~50 from a single event). They are
provisional: a proper fit needs ~200 trips, trustworthy client detection
(CAR-6) and per-event severity. See CAR-102. The same round added
`apply_confidence`, which caps how far a trip can score above the driver's
rolling score when the GPS trace is too sparse to prove clean driving.

Everything here is pure: no I/O, no DB, no side effects. The trips service feeds
it values sourced from the signed telemetry digest (the oracle) and persists the
results into the shadow columns.

What is NOT yet available, and how this module copes until it is:
  * Per-event severity (peak_g, duration_ms, speed_at_event) — needs the SDK
    change (CAR-6). Until then weighted counts collapse to raw counts (each
    event weight 1.0). `event_severity()` is implemented and tested now so the
    downstream math is unchanged the day the SDK lands.
  * Speeding (map-matched posted limits) — needs map-matching. Until then the
    speeding weight is redistributed across the other components ("Blending the five").
"""

from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class ScoringConfig:
    """Scoring parameters. `version` is stamped onto each scored trip. Decay
    constants re-fit 2026-07 from the live fleet's recency-weighted rate
    percentiles (CAR-102 — provisional until the fleet is bigger):
    anchored so a single event on a median trip costs ~5–10 composite points and
    the weighted p90-worst trip lands near 50, per "Rate to subscore"."""

    version: str = "2.1.0"

    # Exponential-decay rate constants k_c (subscore = 100 * exp(-k * rate)).
    k_brake: float = 0.018
    k_accel: float = 0.022
    k_corner: float = 0.012
    k_speed: float = 0.012
    k_distraction: float = 0.020

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

    # Points engine ("Points").
    streak_bonus_per_day: float = 0.05
    streak_bonus_max_days: int = 5
    daily_points_cap: float = 300.0
    daily_distance_cap_km: float = 150.0


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


def event_severity(event_type: str, peak_g: float, duration_ms: float, speed_kmh: float) -> float:
    """Continuous severity weight for one kinematic event.

    Ranges from 1.0 at the detection threshold to ~3.0 for an extreme, sustained,
    high-speed event. Replaces tier counting so there is no threshold to game.

    Not called in shadow mode (the SDK does not emit peak_g yet) — kept here,
    tested, so the moment per-event data arrives the only change upstream is
    summing severity instead of counting events.
    """
    g_min, g_max = _SEVERITY_RANGES[event_type]
    g_norm = _clamp((peak_g - g_min) / (g_max - g_min), 0.0, 1.0)
    g_factor = g_norm**1.5 + 1.0
    duration_factor = 1.0 + min(duration_ms / 2000.0, 0.5)
    speed_factor = 1.0 + min(speed_kmh / 120.0, 1.0) * 0.5
    return float(g_factor * duration_factor * speed_factor)


# ─── Stages 3–5 — trip score ───────────────────────────────────────────────────


@dataclass(frozen=True)
class TripScoreV2:
    score: float
    sub_braking: float
    sub_acceleration: float
    sub_cornering: float
    sub_speeding: float
    sub_distraction: float
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
    w_speed: float = 0.0,
    distance_km: float,
    duration_min: float,
    has_speed_data: bool = False,
    rolling_score: float | None = None,
    config: ScoringConfig = CONFIG,
) -> TripScoreV2:
    """Composite 0–100 trip score from severity-weighted event counts
    (scoring.md "Rates, not totals" and "Rate to subscore").

    `w_*` are severity-weighted counts (Σ severity per type). In shadow mode each
    event contributes weight 1.0, so these equal raw counts. Distance and time
    are the exposure denominators. `has_speed_data` selects the weight set;
    `rolling_score` is the driver's current score, used only to dampen tiny trips.
    """
    exposure_km = max(distance_km, config.exposure_floor_km)
    exposure_min = max(duration_min, config.distraction_time_floor_min)

    r_brake = w_brake * 100.0 / exposure_km
    r_accel = w_accel * 100.0 / exposure_km
    r_corner = w_corner * 100.0 / exposure_km
    r_speed = w_speed * 100.0 / exposure_km
    r_distraction = w_distraction * 60.0 / exposure_min  # per driving-hour

    sub_brake = _subscore(r_brake, config.k_brake)
    sub_accel = _subscore(r_accel, config.k_accel)
    sub_corner = _subscore(r_corner, config.k_corner)
    sub_speed = _subscore(r_speed, config.k_speed)
    sub_distraction = _subscore(r_distraction, config.k_distraction)

    if has_speed_data:
        score = (
            config.w_distraction * sub_distraction
            + config.w_speed * sub_speed
            + config.w_brake * sub_brake
            + config.w_accel * sub_accel
            + config.w_corner * sub_corner
        )
    else:
        score = (
            config.w_distraction_nospeed * sub_distraction
            + config.w_brake_nospeed * sub_brake
            + config.w_accel_nospeed * sub_accel
            + config.w_corner_nospeed * sub_corner
        )

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
    """
    if not history:
        return config.prior_score

    weighted_score = 0.0
    weighted_km = 0.0
    total_km = 0.0
    for h in history:
        decay = 0.5 ** (max(0.0, h.age_days) / config.ewma_halflife_days)
        w = max(0.0, h.distance_km) * decay
        weighted_score += h.trip_score * w
        weighted_km += w
        total_km += max(0.0, h.distance_km)

    driver_raw = weighted_score / weighted_km if weighted_km > 0 else config.prior_score
    credibility = min(total_km / config.credibility_full_km, 1.0)
    score = credibility * driver_raw + (1.0 - credibility) * config.prior_score
    return round(_clamp(score, 0.0, 100.0) * 10) / 10


# ─── Stage 7 — points engine ────────────────────────────────────────────────────


def compute_points(
    *,
    trip_score: float,
    distance_km: float,
    risk_multiplier: float,
    streak_days: int = 0,
    level_multiplier: float = 1.0,
    points_today: float = 0.0,
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
    streak_bonus = 1.0 + config.streak_bonus_per_day * min(max(0, streak_days), config.streak_bonus_max_days)
    points = trip_score * distance_factor * risk_multiplier * streak_bonus * max(0.0, level_multiplier)

    # Daily points cap — applied last, so the level bonus changes how fast a
    # driver reaches the ceiling, never where the ceiling sits.
    remaining_points = max(0.0, config.daily_points_cap - max(0.0, points_today))
    return round(min(points, remaining_points) * 10) / 10

"""Unit tests for CARMA Scoring Algorithm v2 (server/app/services/scoring.py).

Covers the pure-formula stages: continuous severity, exposure-normalized
exponential-decay subscores, composite trip score with short-trip dampening,
driver score via EWMA + credibility, the points engine with anti-grind caps, and
the streak.
"""

from __future__ import annotations

import math
from datetime import date, timedelta

from app.services.scoring import (
    CONFIG,
    TripHistoryPoint,
    compute_driver_score,
    compute_points,
    compute_streak,
    compute_trip_score,
    event_severity,
)

# ─── continuous severity weight ─────────────────────────────────────────────────


class TestEventSeverity:
    def test_at_threshold_is_one_times_factors(self) -> None:
        # peak_g at g_min → g_factor=1.0; low speed/short duration → factors→1.0
        s = event_severity("brake", peak_g=0.30, duration_ms=0, speed_kmh=0)
        assert s == 1.0

    def test_extreme_sustained_highspeed_caps_near_three(self) -> None:
        # g_norm=1 → g_factor=2; duration≥2000ms → ×1.5; speed≥120 → ×1.5 ⇒ 4.5 cap
        s = event_severity("brake", peak_g=0.80, duration_ms=5000, speed_kmh=200)
        assert math.isclose(s, 2.0 * 1.5 * 1.5)

    def test_superlinear_in_g(self) -> None:
        mid = event_severity("brake", peak_g=0.45, duration_ms=0, speed_kmh=0)
        # halfway in g (0.45 of 0.30–0.60): g_norm=0.5 → 0.5^1.5+1 ≈ 1.3536
        assert math.isclose(mid, 0.5**1.5 + 1.0)

    def test_speed_factor_scales_maneuver(self) -> None:
        slow = event_severity("accel", peak_g=0.40, duration_ms=0, speed_kmh=0)
        fast = event_severity("accel", peak_g=0.40, duration_ms=0, speed_kmh=120)
        assert math.isclose(fast, slow * 1.5)


# ─── trip score ─────────────────────────────────────────────────────────────────


class TestComputeTripScore:
    def test_perfect_trip_scores_100(self) -> None:
        r = compute_trip_score(w_brake=0, w_accel=0, w_corner=0, w_distraction=0, distance_km=20.0, duration_min=30.0)
        assert r.score == 100.0
        assert r.version == CONFIG.version

    def test_exposure_normalization_rewards_longer_trips(self) -> None:
        # Same 3 hard brakes: a long highway trip must score better than a short one.
        short = compute_trip_score(
            w_brake=3, w_accel=0, w_corner=0, w_distraction=0, distance_km=5.0, duration_min=10.0
        )
        long = compute_trip_score(
            w_brake=3, w_accel=0, w_corner=0, w_distraction=0, distance_km=200.0, duration_min=120.0
        )
        assert long.score > short.score

    def test_exposure_floor_prevents_tiny_trip_blowup(self) -> None:
        # 1 brake in 0.5 km must use the 4 km floor, not 200 brakes/100 km.
        r = compute_trip_score(w_brake=1, w_accel=0, w_corner=0, w_distraction=0, distance_km=0.5, duration_min=8.0)
        expected_sub = 100.0 * math.exp(-CONFIG.k_brake * (1 * 100.0 / 4.0))
        assert math.isclose(r.sub_braking, round(expected_sub * 10) / 10)

    def test_braking_subscore_matches_exponential_decay(self) -> None:
        r = compute_trip_score(w_brake=10, w_accel=0, w_corner=0, w_distraction=0, distance_km=100.0, duration_min=60.0)
        rate = 10 * 100.0 / 100.0  # 10 per 100 km
        assert math.isclose(r.sub_braking, round(100.0 * math.exp(-CONFIG.k_brake * rate) * 10) / 10)

    def test_no_speed_data_uses_redistributed_weights(self) -> None:
        # Without speeding data the four weights must sum to 1 (no lost mass).
        total = CONFIG.w_distraction_nospeed + CONFIG.w_brake_nospeed + CONFIG.w_accel_nospeed + CONFIG.w_corner_nospeed
        assert math.isclose(total, 1.0)

    def test_speed_data_weights_sum_to_one(self) -> None:
        total = CONFIG.w_distraction + CONFIG.w_speed + CONFIG.w_brake + CONFIG.w_accel + CONFIG.w_corner
        assert math.isclose(total, 1.0)

    def test_short_trip_dampened_toward_rolling_score(self) -> None:
        # A tiny terrible trip blends 50/50 with the driver's standing score.
        rolling = 90.0
        r = compute_trip_score(
            w_brake=20,
            w_accel=0,
            w_corner=0,
            w_distraction=0,
            distance_km=1.0,
            duration_min=3.0,
            rolling_score=rolling,
        )
        undamped = compute_trip_score(
            w_brake=20,
            w_accel=0,
            w_corner=0,
            w_distraction=0,
            distance_km=1.0,
            duration_min=3.0,
        )
        assert r.score > undamped.score
        assert math.isclose(r.score, round((0.5 * undamped.score + 0.5 * rolling) * 10) / 10, abs_tol=0.1)

    def test_no_saturation_cliff_keeps_gradient(self) -> None:
        # v1 clamps both of these to 0 (penalties ≫ 100); v2 keeps them distinct
        # and positive, so there is always an incentive to improve.
        bad = compute_trip_score(
            w_brake=25,
            w_accel=21,
            w_corner=30,
            w_distraction=17,
            distance_km=100.0,
            duration_min=60.0,
        )
        worse = compute_trip_score(
            w_brake=50,
            w_accel=42,
            w_corner=60,
            w_distraction=34,
            distance_km=100.0,
            duration_min=60.0,
        )
        assert 0.0 < worse.score < bad.score


# ─── driver score ───────────────────────────────────────────────────────────────


class TestComputeDriverScore:
    def test_new_driver_returns_prior(self) -> None:
        assert compute_driver_score([]) == CONFIG.prior_score

    def test_cold_start_blends_toward_prior(self) -> None:
        # 50 km of history → credibility 50/300, mostly the 75 prior.
        score = compute_driver_score([TripHistoryPoint(trip_score=100.0, distance_km=50.0, age_days=0.0)])
        cred = 50.0 / 300.0
        assert math.isclose(score, round((cred * 100.0 + (1 - cred) * 75.0) * 10) / 10)

    def test_full_credibility_ignores_prior(self) -> None:
        # 300+ km of consistent 90s → score ≈ 90, prior no longer pulls.
        hist = [TripHistoryPoint(trip_score=90.0, distance_km=100.0, age_days=float(i)) for i in range(4)]
        assert math.isclose(compute_driver_score(hist), 90.0, abs_tol=0.1)

    def test_recent_trips_weigh_more_than_old(self) -> None:
        recent_bad = compute_driver_score(
            [
                TripHistoryPoint(trip_score=100.0, distance_km=300.0, age_days=28.0),
                TripHistoryPoint(trip_score=40.0, distance_km=300.0, age_days=0.0),
            ]
        )
        old_bad = compute_driver_score(
            [
                TripHistoryPoint(trip_score=100.0, distance_km=300.0, age_days=0.0),
                TripHistoryPoint(trip_score=40.0, distance_km=300.0, age_days=28.0),
            ]
        )
        assert recent_bad < old_bad

    def test_half_life_halves_weight_at_14_days(self) -> None:
        # One trip at age 0 (score 100) and one at age 14 (score 0), equal km.
        # 14-day trip has half the weight → raw ≈ 100*1/(1+0.5)=66.67, then credibility.
        score = compute_driver_score(
            [
                TripHistoryPoint(trip_score=100.0, distance_km=300.0, age_days=0.0),
                TripHistoryPoint(trip_score=0.0, distance_km=300.0, age_days=14.0),
            ]
        )
        # total_km 600 → full credibility; raw = (100*300 + 0*150)/(300+150) = 66.67
        assert math.isclose(score, round((100.0 * 300.0) / (300.0 + 150.0) * 10) / 10, abs_tol=0.1)


# ─── points engine ──────────────────────────────────────────────────────────────


class TestComputePoints:
    def test_basic_points_match_formula(self) -> None:
        pts = compute_points(trip_score=80.0, distance_km=10.0, risk_multiplier=1.0)
        assert math.isclose(pts, round(80.0 * (math.log(11) / math.log(11)) * 1.0 * 10) / 10)

    def test_fraud_flagged_earns_zero(self) -> None:
        assert compute_points(trip_score=100.0, distance_km=50.0, risk_multiplier=2.0, fraud_flagged=True) == 0.0

    def test_daily_points_cap_enforced(self) -> None:
        spent = CONFIG.daily_points_cap - 10.0
        pts = compute_points(trip_score=100.0, distance_km=100.0, risk_multiplier=2.0, points_today=spent)
        assert pts == 10.0  # only the day's remainder is payable

    def test_rolling_month_cap_binds_even_on_a_fresh_day(self) -> None:
        """The economic ceiling. A driver who has hit it earns nothing today.

        Separate from the daily cap on purpose: without it a driver can sit on
        the daily maximum every day of the month and the reward catalogue has no
        ceiling at all.
        """
        pts = compute_points(
            trip_score=100.0,
            distance_km=100.0,
            risk_multiplier=2.0,
            points_today=0.0,
            points_month=CONFIG.rolling_month_points_cap,
        )
        assert pts == 0.0

        # And the tighter of the two wins rather than the last one checked.
        near_month = compute_points(
            trip_score=100.0,
            distance_km=100.0,
            risk_multiplier=2.0,
            points_month=CONFIG.rolling_month_points_cap - 3.0,
        )
        assert near_month == 3.0, "3 left in the month beats a full day's allowance"

    def test_the_level_bonus_cannot_lift_a_trip_over_the_daily_cap(self) -> None:
        """The top of the ladder reaches the cap faster, never past it.

        The bonus used to be applied by the caller after this function returned,
        which made the real ceiling 300 x the multiplier — 600 a day for a
        level-10 account, and precisely the account worth grinding for.
        """
        cap = CONFIG.daily_points_cap
        top = compute_points(trip_score=100.0, distance_km=100.0, risk_multiplier=2.0, level_multiplier=2.0)
        assert top == cap, "an outsized trip at the top of the ladder lands exactly on the cap"

        # Below the cap the bonus is fully paid — otherwise this would pass by
        # the multiplier being ignored rather than by the cap holding.
        plain = compute_points(trip_score=80.0, distance_km=5.0, risk_multiplier=1.0)
        doubled = compute_points(trip_score=80.0, distance_km=5.0, risk_multiplier=1.0, level_multiplier=2.0)
        assert doubled < cap and math.isclose(doubled, plain * 2, rel_tol=0.02)

    def test_daily_distance_cap_limits_counted_km(self) -> None:
        # 140 km already farmed today → only 10 km counts toward the next trip.
        capped = compute_points(trip_score=100.0, distance_km=100.0, risk_multiplier=1.0, distance_today_km=140.0)
        equiv = compute_points(trip_score=100.0, distance_km=10.0, risk_multiplier=1.0)
        assert math.isclose(capped, equiv)


# ─── streaks ────────────────────────────────────────────────────────────────────


_ANCHOR = date(2026, 8, 1)  # stands in for "yesterday" in every case below


def _day(offset: int) -> date:
    return _ANCHOR - timedelta(days=offset)


class TestComputeStreak:
    def test_no_history_is_zero(self) -> None:
        assert compute_streak([], _ANCHOR) == 0

    def test_consecutive_good_days_count(self) -> None:
        assert compute_streak([(_day(i), 90.0, 10.0) for i in range(4)], _ANCHOR) == 4

    def test_days_without_a_trip_are_skipped_not_broken(self) -> None:
        """The rule that keeps the mechanic from paying drivers to take the car out."""
        sparse = [(_day(0), 90.0, 10.0), (_day(4), 90.0, 10.0), (_day(11), 90.0, 10.0)]
        assert compute_streak(sparse, _ANCHOR) == 3

    def test_a_bad_day_ends_the_run(self) -> None:
        mixed = [(_day(0), 90.0, 10.0), (_day(1), 55.0, 10.0), (_day(2), 90.0, 10.0)]
        assert compute_streak(mixed, _ANCHOR) == 1, "the run reaches back only as far as the bad day"

    def test_a_bad_latest_day_zeroes_a_long_run(self) -> None:
        collapsed = [(_day(0), 55.0, 10.0)] + [(_day(i), 95.0, 10.0) for i in range(1, 6)]
        assert compute_streak(collapsed, _ANCHOR) == 0

    def test_the_day_in_progress_is_not_counted(self) -> None:
        """Today can be banked on a good morning and spoiled by evening."""
        today = _ANCHOR + timedelta(days=1)
        assert compute_streak([(today, 100.0, 10.0), (_day(0), 90.0, 10.0)], _ANCHOR) == 1

    def test_a_day_exactly_on_the_bar_counts(self) -> None:
        assert compute_streak([(_day(0), CONFIG.streak_qualifying_score, 10.0)], _ANCHOR) == 1

    def test_one_short_bad_trip_does_not_sink_a_good_day(self) -> None:
        # 95 over 40 km against 30 over 1 km — weighted, still comfortably a good day.
        assert compute_streak([(_day(0), 95.0, 40.0), (_day(0), 30.0, 1.0)], _ANCHOR) == 1

    def test_one_short_good_trip_does_not_rescue_a_bad_day(self) -> None:
        # The mirror image, and the reason the day is averaged rather than sampled.
        assert compute_streak([(_day(0), 50.0, 40.0), (_day(0), 100.0, 1.0)], _ANCHOR) == 0

    def test_a_zero_distance_day_still_has_to_be_earned(self) -> None:
        """The distance witness can cut a trip to nothing, leaving no weight to average by."""
        assert compute_streak([(_day(0), 90.0, 0.0)], _ANCHOR) == 1
        assert compute_streak([(_day(0), 50.0, 0.0)], _ANCHOR) == 0

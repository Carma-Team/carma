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
        # peak_g at g_min → g_factor=1.0; short duration → duration_factor=1.0
        s = event_severity("brake", peak_g=0.30, duration_ms=0)
        assert s == 1.0

    def test_extreme_sustained_event_caps_at_three(self) -> None:
        # g_norm=1 → g_factor=2; duration≥2000ms → ×1.5 ⇒ 3.0 cap
        s = event_severity("brake", peak_g=0.80, duration_ms=5000)
        assert math.isclose(s, 3.0)

    def test_superlinear_in_g(self) -> None:
        mid = event_severity("brake", peak_g=0.45, duration_ms=0)
        # halfway in g (0.45 of 0.30–0.60): g_norm=0.5 → 0.5^1.5+1 ≈ 1.3536
        assert math.isclose(mid, 0.5**1.5 + 1.0)


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


class TestWeakestFactor:
    """CAR-185: the behaviour with the largest weighted score loss,
    weight * (100 - subscore) — the counterfactual the composite implies,
    not merely whichever subscore happens to be lowest."""

    def test_higher_weight_beats_lower_subscore(self) -> None:
        # 6 sharp turns / 20km / 30min: cornering subscore ~69.8, weighted loss ~3.0.
        # 40s handling / 30min driving: distraction subscore ~75.6, weighted loss ~7.3.
        # Cornering's subscore is lower, but distraction costs more — weight 0.30 vs 0.10.
        r = compute_trip_score(
            w_brake=0,
            w_accel=0,
            w_corner=6,
            w_distraction=40,
            distance_km=20.0,
            duration_min=30.0,
            has_speed_data=True,
        )
        assert r.sub_cornering < r.sub_distraction
        assert r.weakest_factor == "distraction"

    def test_clean_trip_names_nothing(self) -> None:
        r = compute_trip_score(w_brake=0, w_accel=0, w_corner=0, w_distraction=0, distance_km=20.0, duration_min=30.0)
        assert r.weakest_factor is None

    def test_speeding_excluded_when_no_speed_data(self) -> None:
        # A catastrophic speeding weight must never surface when the weight set
        # that dropped it (has_speed_data=False) is the one in effect — the
        # candidate list omits it entirely rather than scoring it at weight 0.
        r = compute_trip_score(
            w_brake=0,
            w_accel=0,
            w_corner=6,
            w_distraction=0,
            w_speed=1000,
            distance_km=20.0,
            duration_min=30.0,
            has_speed_data=False,
        )
        assert r.weakest_factor == "cornering"

    def test_tie_breaks_toward_the_higher_weighted_behaviour(self) -> None:
        # Constructed so braking's weighted loss (~5.0) is a hair above
        # acceleration's (~4.999999) while acceleration's *subscore* is the
        # lower of the two — a lowest-subscore rule would name acceleration.
        # Fixed candidate order (descending weight) makes braking's win
        # deterministic rather than a coin flip on near-equal float loss.
        r = compute_trip_score(
            w_brake=15.982337358432273,
            w_accel=18.430227641280425,
            w_corner=0,
            w_distraction=0,
            distance_km=100.0,
            duration_min=60.0,
            has_speed_data=True,
        )
        assert r.sub_acceleration < r.sub_braking
        assert r.weakest_factor == "braking"

    def test_winner_above_90_not_suppressed_when_loser_below_90(self) -> None:
        # 5 sharp turns / 20km / 30min: cornering subscore ~74.1 (below 90, loss ~2.59).
        # 14s phone handling / 30min: distraction subscore ~90.7 (above 90, loss ~2.79).
        # Distraction's weighted loss is larger so it is the winner, but because
        # cornering sits below 90, the trip is not clean and weakest_factor must
        # not be suppressed to None.
        r = compute_trip_score(
            w_brake=0,
            w_accel=0,
            w_corner=5,
            w_distraction=14,
            distance_km=20.0,
            duration_min=30.0,
            has_speed_data=True,
        )
        assert r.sub_distraction > 90.0
        assert r.sub_cornering < 90.0
        assert r.weakest_factor == "distraction"

    def test_all_subscores_above_90_suppresses_weakest_factor(self) -> None:
        # Minor handling: distraction subscore ~96.5 (> 90), all others 100.
        # Every candidate is > 90, so naming is suppressed.
        r = compute_trip_score(
            w_brake=0,
            w_accel=0,
            w_corner=0,
            w_distraction=5,
            distance_km=20.0,
            duration_min=30.0,
            has_speed_data=True,
        )
        assert r.sub_distraction > 90.0
        assert r.weakest_factor is None


# ─── driver score ───────────────────────────────────────────────────────────────


class TestComputeDriverScore:
    def test_new_driver_returns_prior(self) -> None:
        assert compute_driver_score([]) == CONFIG.prior_score

    def test_cold_start_blends_toward_prior(self) -> None:
        # One 50 km trip counts as 30 → credibility 30/300, mostly the 75 prior.
        score = compute_driver_score([TripHistoryPoint(trip_score=100.0, distance_km=50.0, age_days=0.0)])
        cred = CONFIG.trip_exposure_cap_km / CONFIG.credibility_full_km
        assert math.isclose(score, round((cred * 100.0 + (1 - cred) * 75.0) * 10) / 10)

    def test_full_credibility_ignores_prior(self) -> None:
        # Ten capped trips of consistent 90s → score ≈ 90, prior no longer pulls.
        hist = [TripHistoryPoint(trip_score=90.0, distance_km=100.0, age_days=float(i)) for i in range(10)]
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
        # Five trips at age 0 (score 100) and five at age 14 (score 0). All are at
        # or above the exposure cap, so credibility is full and only the decay
        # shows: raw = 100*150 / (150 + 75) = 66.67.
        hist = [TripHistoryPoint(trip_score=100.0, distance_km=60.0, age_days=0.0) for _ in range(5)]
        hist += [TripHistoryPoint(trip_score=0.0, distance_km=60.0, age_days=14.0) for _ in range(5)]
        assert math.isclose(compute_driver_score(hist), 66.7, abs_tol=0.1)

    def test_one_long_drive_cannot_outvote_a_month_of_commuting(self) -> None:
        """CMT's rule: no single trip may have a major impact on the overall score
        (US12071140B2). A 400 km drive weighs exactly what a 30 km one does."""
        commutes = [TripHistoryPoint(trip_score=90.0, distance_km=30.0, age_days=float(i)) for i in range(10)]
        outlier = TripHistoryPoint(trip_score=40.0, distance_km=400.0, age_days=0.0)
        capped = TripHistoryPoint(trip_score=40.0, distance_km=30.0, age_days=0.0)
        assert compute_driver_score([*commutes, outlier]) == compute_driver_score([*commutes, capped])

    def test_a_single_long_drive_does_not_prove_a_driver(self) -> None:
        """The cap applies to credibility too. One stretch of motorway is one drive,
        not a proven record — the score stays near the cold-start prior."""
        score = compute_driver_score([TripHistoryPoint(trip_score=100.0, distance_km=300.0, age_days=0.0)])
        assert math.isclose(score, 77.5, abs_tol=0.1)


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

    def test_the_night_multiplier_is_earned_by_the_score_not_the_hour(self) -> None:
        """Paid flat, a x2.0 weekend night pays for being on the road at 02:00.

        It is the same context the industry uses to raise measured risk, so it
        has to be earned: nothing at the floor, in full at 100, straight line
        between. A cut rather than a taper would swing the payout twofold across
        a tenth of a point.
        """
        floor = CONFIG.risk_multiplier_floor_score
        at_floor = compute_points(trip_score=floor, distance_km=10.0, risk_multiplier=2.0)
        flat = compute_points(trip_score=floor, distance_km=10.0, risk_multiplier=1.0)
        assert math.isclose(at_floor, flat), "at the floor the hour is worth nothing"

        # Half way up (85 of 70–100) earns half the multiplier's excess: x1.5.
        half = compute_points(trip_score=85.0, distance_km=10.0, risk_multiplier=2.0)
        half_plain = compute_points(trip_score=85.0, distance_km=10.0, risk_multiplier=1.0)
        assert math.isclose(half, round(half_plain * 1.5 * 10) / 10, rel_tol=0.01)

        # And a perfect trip is paid the full time-of-day figure.
        top = compute_points(trip_score=100.0, distance_km=10.0, risk_multiplier=2.0)
        top_plain = compute_points(trip_score=100.0, distance_km=10.0, risk_multiplier=1.0)
        assert math.isclose(top, round(top_plain * 2.0 * 10) / 10, rel_tol=0.01)

    def test_a_bad_night_trip_never_out_earns_the_same_trip_by_day(self) -> None:
        # Below the floor the multiplier is gone entirely, at any hour.
        night = compute_points(trip_score=40.0, distance_km=20.0, risk_multiplier=2.0)
        day = compute_points(trip_score=40.0, distance_km=20.0, risk_multiplier=1.0)
        assert night == day

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


# ─── CAR-54: distraction per driving hour ───────────────────────────────────────


class TestDistractionExposure:
    """Handling seconds per hour of *driving*, CMT's definition (scoring.md §3.1)."""

    def test_cmt_population_average_scores_about_75(self) -> None:
        """The anchor k_distraction was fitted to: CMT's US 2024 national average of
        82 handling-seconds per driving hour is an average driver, not a failing one.
        At the old k=0.020 this same trip scored 19.4."""
        r = compute_trip_score(
            w_brake=0,
            w_accel=0,
            w_corner=0,
            w_distraction=82.0,
            distance_km=60.0,
            duration_min=60.0,
            driving_min_above_threshold=60.0,
        )
        assert r.sub_distraction == 75.1

    def test_parked_tail_does_not_dilute_the_rate(self) -> None:
        """A trip closes up to three minutes after the car stops, and arrival is when
        the driver picks the phone up. Charging over wall-clock rewards that.

        Scoring only — the denominator is handed in. `_distraction_exposure_min`
        cannot yet produce 60.0 for this trip, because a parked tail sits past the
        trace's last sample instead of inside it; see its docstring.
        """
        common = dict(w_brake=0, w_accel=0, w_corner=0, w_distraction=82.0, distance_km=60.0, duration_min=75.0)
        driving = compute_trip_score(**common, driving_min_above_threshold=60.0)
        wall_clock = compute_trip_score(**common, driving_min_above_threshold=75.0)
        assert driving.sub_distraction == 75.1
        assert wall_clock.sub_distraction == 79.5

    def test_no_trace_falls_back_to_wall_clock_duration(self) -> None:
        """`None` means the GPS trace could not measure it — today's behaviour stands."""
        common = dict(w_brake=0, w_accel=0, w_corner=0, w_distraction=40.0, distance_km=20.0, duration_min=30.0)
        assert (
            compute_trip_score(**common, driving_min_above_threshold=None).sub_distraction
            == compute_trip_score(**common, driving_min_above_threshold=30.0).sub_distraction
        )

    def test_zero_driving_minutes_cannot_divide_by_zero(self) -> None:
        """A measured zero is a crawl, not a missing trace — the floor takes it."""
        r = compute_trip_score(
            w_brake=0,
            w_accel=0,
            w_corner=0,
            w_distraction=10.0,
            distance_km=1.0,
            duration_min=20.0,
            driving_min_above_threshold=0.0,
        )
        assert r.sub_distraction == 65.7  # 10 s over the 5-minute floor = 120/h

    def test_a_sub_threshold_jam_is_charged_at_the_floor(self) -> None:
        """The known soft spot, pinned rather than papered over with a second constant.

        A 40-minute crawl below 15 km/h yields no driving seconds, so the 5-minute
        floor applies a 12x multiplier to any handling. Conservative and bounded;
        it closes when CAR-184 gates the numerator in the app.
        """
        common = dict(w_brake=0, w_accel=0, w_corner=0, w_distraction=30.0, distance_km=8.0, duration_min=40.0)
        assert compute_trip_score(**common, driving_min_above_threshold=0.0).sub_distraction == 28.4
        assert compute_trip_score(**common, driving_min_above_threshold=None).sub_distraction == 85.4

    def test_short_trip_dampening_still_reads_wall_clock(self) -> None:
        """`duration_min` keeps its other job: a 40-minute crawl is not a short trip."""
        r = compute_trip_score(
            w_brake=0,
            w_accel=0,
            w_corner=0,
            w_distraction=0.0,
            distance_km=8.0,
            duration_min=40.0,
            driving_min_above_threshold=0.0,
            rolling_score=50.0,
        )
        assert r.score == 100.0


# ─── CAR-155: the ingest path may not read client severity ──────────────────────


class TestClientSeverityIsNotScored:
    """A tripwire, not a unit test — deliberately crude because it must always run.

    The integration test that proves this properly (`test_trip_events_db.py`)
    skips without Postgres, and a direct push to `develop` skips the Postgres job
    entirely. So on the machine most likely to introduce the leak, nothing else
    checks it.
    """

    def test_scoring_path_does_not_read_client_severity(self) -> None:
        import inspect

        from app.services import trips

        assert "event_severity" not in inspect.getsource(trips), (
            "trips.py now references event_severity(). Client-supplied severity is an "
            "unsigned horizontal magnitude, not the vehicle-frame value the curve maps "
            "(CAR-155), and the events array is unsigned so a client could set its own. "
            "Lift this guard in CAR-157, once severity is sourced from the signed digest."
        )

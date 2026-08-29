"""Unit tests for the server-side GPS telemetry analyzer (v2.1).

Fixtures mirror the artifacts observed in production traces: near-duplicate
timestamps, 3–6 s sampling, >15 s gaps, and motorway speeding that the client
digest reported as zero events.
"""

from __future__ import annotations

from app.services import telemetry
from app.services.scoring import apply_confidence


def _wp(ts_s: float, speed: float, lat: float = 32.0, lng: float = 34.8) -> dict:
    return {"ts": ts_s * 1000.0, "lat": lat, "lng": lng, "speedKmh": speed}


def _cruise(seconds: int, speed: float, dt: float = 3.0) -> list[dict]:
    """A steady-speed trace heading due north (increasing latitude)."""
    n = int(seconds / dt)
    return [_wp(i * dt, speed, lat=32.0 + i * dt * speed / 3.6 / 111_000) for i in range(n)]


class TestParsingAndCleaning:
    def test_empty_and_garbage_return_empty_analysis(self) -> None:
        assert telemetry.analyze(None, 600) == telemetry.EMPTY_ANALYSIS
        assert telemetry.analyze([], 600) == telemetry.EMPTY_ANALYSIS
        assert telemetry.analyze([{"nope": 1}, "junk", 42], 600) == telemetry.EMPTY_ANALYSIS  # type: ignore[list-item]

    def test_duplicate_timestamps_do_not_fabricate_events(self) -> None:
        # Two samples <0.5 s apart with different speeds naively imply a
        # multi-thousand-m/s² "brake" — the dedup must swallow it.
        trace = _cruise(60, 40.0)
        trace.insert(10, _wp(10 * 3.0 + 0.01, 5.0))
        analysis = telemetry.analyze(trace, 60)
        assert analysis.hard_brakes == 0
        assert analysis.aggressive_accels == 0

    def test_implausible_speeds_dropped(self) -> None:
        trace = _cruise(60, 40.0) + [_wp(120.0, 900.0)]
        analysis = telemetry.analyze(trace, 120)
        assert analysis.speeding_ratio == 0.0


class TestKinematicDetection:
    def test_hard_brake_detected(self) -> None:
        # 60 → 20 km/h over 3 s ≈ −3.7 m/s².
        trace = _cruise(30, 60.0)
        t0 = len(trace) * 3.0
        trace += [_wp(t0, 60.0), _wp(t0 + 3.0, 20.0), _wp(t0 + 6.0, 20.0)]
        analysis = telemetry.analyze(trace, 40)
        assert analysis.hard_brakes == 1
        assert any(e.type == "HARD_BRAKE" for e in analysis.events)

    def test_two_second_cadence_catches_a_brake_a_coarser_trace_averages_away(self) -> None:
        # One physical event, three samplers: 3.5 m/s² held for 2 s drops 60 km/h
        # to 34.8. A 2 s trace brackets it exactly and reads 3.5 m/s²; a 5 s or 6 s
        # trace averages the same drop against seconds of steady speed and reads
        # 1.4 and 1.2 m/s². This is why the cadence follows the threshold (CAR-179).
        def with_brake(dt: float) -> list[dict]:
            trace = _cruise(60, 60.0, dt=dt)
            t0 = len(trace) * dt
            return trace + [_wp(t0, 60.0), _wp(t0 + dt, 34.8), _wp(t0 + 2 * dt, 34.8)]

        assert telemetry.analyze(with_brake(2.0), 80).hard_brakes == 1
        assert telemetry.analyze(with_brake(5.0), 80).hard_brakes == 0
        assert telemetry.analyze(with_brake(6.0), 80).hard_brakes == 0

    def test_gentle_braking_not_detected(self) -> None:
        # 60 → 40 km/h over 3 s ≈ −1.9 m/s² — normal driving.
        trace = _cruise(30, 60.0)
        t0 = len(trace) * 3.0
        trace += [_wp(t0, 60.0), _wp(t0 + 3.0, 40.0)]
        assert telemetry.analyze(trace, 40).hard_brakes == 0

    def test_aggressive_accel_detected(self) -> None:
        # 10 → 45 km/h over 3 s ≈ +3.2 m/s².
        trace = [_wp(0, 10.0), _wp(3, 45.0), _wp(6, 50.0)]
        assert telemetry.analyze(trace, 10).aggressive_accels == 1

    def test_low_speed_filter_ignores_parking_maneuvers(self) -> None:
        # A hard stop from 12 km/h is a parking maneuver, not an event.
        trace = [_wp(0, 12.0), _wp(3, 0.0), _wp(6, 0.0)]
        assert telemetry.analyze(trace, 10).hard_brakes == 0

    def test_merge_window_counts_one_maneuver(self) -> None:
        # A long brake spanning several consecutive samples (−3.7 m/s² twice
        # within the 5 s merge window) is ONE event.
        trace = [_wp(0, 120.0), _wp(3, 80.0), _wp(6, 40.0), _wp(9, 30.0)]
        assert telemetry.analyze(trace, 12).hard_brakes == 1

    def test_sharp_turn_detected_from_bearing_change(self) -> None:
        # Heading north then hard east at 40 km/h: 90° over 3 s = 30°/s.
        north = [_wp(i * 3.0, 40.0, lat=32.0 + i * 0.001, lng=34.8) for i in range(5)]
        east = [_wp((5 + i) * 3.0, 40.0, lat=32.004, lng=34.8 + (i + 1) * 0.001) for i in range(4)]
        analysis = telemetry.analyze(north + east, 30)
        assert analysis.sharp_turns >= 1

    def test_no_kinematics_across_gps_gaps(self) -> None:
        # 100 → 0 km/h across a 60 s tunnel gap is not a brake.
        trace = _cruise(30, 100.0)
        t0 = len(trace) * 3.0
        trace += [_wp(t0 + 60.0, 0.0)]
        assert telemetry.analyze(trace, 100).hard_brakes == 0


class TestSpeeding:
    """Speeding is a severity-weighted share of distance above the posted limit."""

    def test_no_map_falls_back_to_the_national_maximum(self) -> None:
        # Off the map the limit is 120, and 10% of that is a 12 km/h buffer, so
        # nothing under 132 is charged.
        assert telemetry.analyze(_cruise(120, 125.0), 120).speeding_ratio == 0.0
        assert telemetry.analyze(_cruise(120, 135.0), 120).speeding_ratio == 1.0

    def test_posted_limit_charges_urban_speeding_the_flat_limit_missed(self) -> None:
        # 90 in a 50 zone: invisible to the old flat 130 threshold, all of it
        # over the limit once the map answers. This is the bug CAR-222 names.
        trace = _cruise(300, 90.0)
        limits = [50.0] * len(trace)
        assert telemetry.analyze(trace, 300).speeding_ratio == 0.0
        # 40 km/h over is the heaviest band, so the whole trip is charged at 8x.
        assert telemetry.analyze(trace, 300, speed_limits=limits).speeding_ratio == 8.0

    def test_buffer_protects_a_driver_at_the_limit(self) -> None:
        # 10% of 50 is 5, so 54 is inside the buffer and 58 is not. The old flat
        # 10 km/h buffer let a driver sit at 59 in a 50 zone for free.
        assert telemetry.analyze(_cruise(300, 54.0), 300, speed_limits=[50.0] * 100).speeding_ratio == 0.0
        assert telemetry.analyze(_cruise(300, 58.0), 300, speed_limits=[50.0] * 100).speeding_ratio > 0.0

    def test_buffer_scales_with_the_limit(self) -> None:
        # 8 km/h over is inside the buffer on a 110 road and outside it in town.
        assert telemetry.analyze(_cruise(300, 118.0), 300, speed_limits=[110.0] * 100).speeding_ratio == 0.0
        assert telemetry.analyze(_cruise(300, 58.0), 300, speed_limits=[50.0] * 100).speeding_ratio > 0.0

    def test_bands_charge_far_over_more_than_just_over(self) -> None:
        # Same distance, same road, three depths past the limit.
        def ratio(speed: float) -> float:
            return telemetry.analyze(_cruise(300, speed), 300, speed_limits=[80.0] * 100).speeding_ratio

        assert ratio(90.0) == 1.0  # 10 over
        assert ratio(105.0) == 3.0  # 25 over
        assert ratio(115.0) == 8.0  # 35 over

    def test_ratio_is_the_share_of_distance_not_of_time(self) -> None:
        # Half the trip at 100 in a 50 zone, half at 40. The fast half covers
        # more ground, so the distance share is well above the time share.
        fast, slow = _cruise(150, 100.0), _cruise(150, 40.0)
        trace = fast + [_wp(150.0 + w["ts"] / 1000.0, w["speedKmh"]) for w in slow]
        ratio = telemetry.analyze(trace, 300, speed_limits=[50.0] * len(trace)).speeding_ratio
        # The fast half is 50 over, so it is charged at 8x, and it covers about
        # 71% of the distance while being only half the time.
        assert 8 * 0.65 < ratio < 8 * 0.80

    def test_a_segment_straddling_two_limits_is_judged_by_the_higher(self) -> None:
        # 85 km/h across a 90-to-50 boundary must not be charged: the driver is
        # still on the fast road for part of it, and a wrong charge is the one
        # mistake this component may not make.
        trace = _cruise(120, 85.0)
        limits = [90.0] * (len(trace) // 2) + [50.0] * (len(trace) - len(trace) // 2)
        analysis = telemetry.analyze(trace, 120, speed_limits=limits)
        # Only the stretch that is unambiguously in the 50 zone may be charged.
        assert analysis.speeding_ratio < 8 * 0.55

    def test_unmapped_trip_loses_the_component_instead_of_banking_it(self) -> None:
        # The CAR-233 failure: a clean dense trace with no map behind it used to
        # score a perfect speeding component. It must now stand down entirely.
        analysis = telemetry.analyze(_cruise(600, 50.0), 600)
        assert analysis.limit_coverage == 0.0
        assert not analysis.has_speed_data

    def test_mapped_trip_keeps_the_component(self) -> None:
        trace = _cruise(600, 50.0)
        analysis = telemetry.analyze(trace, 600, speed_limits=[50.0] * len(trace))
        assert analysis.limit_coverage == 1.0
        assert analysis.has_speed_data

    def test_partial_coverage_below_half_stands_down(self) -> None:
        trace = _cruise(600, 50.0)
        limits: list[float | None] = [50.0] * (len(trace) // 4) + [None] * (len(trace) - len(trace) // 4)
        analysis = telemetry.analyze(trace, 600, speed_limits=limits)
        assert analysis.limit_coverage < telemetry._LIMIT_COVERAGE_MIN
        assert not analysis.has_speed_data

    def test_one_run_yields_one_speeding_event_carrying_its_limit(self) -> None:
        trace = _cruise(120, 90.0)
        analysis = telemetry.analyze(trace, 120, speed_limits=[50.0] * len(trace))
        speeding = [e for e in analysis.events if e.type == "SPEEDING"]
        assert len(speeding) == 1
        assert speeding[0].detail["limitKmh"] == 50

    def test_severity_rises_with_how_far_over_the_posted_limit(self) -> None:
        trace = _cruise(120, 90.0)
        mild = telemetry.analyze(trace, 120, speed_limits=[70.0] * len(trace)).events
        gross = telemetry.analyze(trace, 120, speed_limits=[50.0] * len(trace)).events
        assert (
            next(e for e in gross if e.type == "SPEEDING").severity
            > next(e for e in mild if e.type == "SPEEDING").severity
        )

    def test_limits_survive_sorting_and_dedup(self) -> None:
        # A near-duplicate timestamp is dropped during cleaning. If limits were
        # zipped on after cleaning rather than carried on the point, every limit
        # after the dropped index would shift onto the wrong waypoint.
        trace = _cruise(120, 90.0)
        trace.insert(10, _wp(10 * 3.0 + 0.01, 90.0))
        limits = [50.0] * len(trace)
        assert telemetry.analyze(trace, 120, speed_limits=limits).speeding_ratio == 8.0


class TestConfidence:
    def test_dense_clean_trace_is_high_confidence(self) -> None:
        trace = _cruise(600, 50.0)
        analysis = telemetry.analyze(trace, 600, speed_limits=[50.0] * len(trace))
        assert analysis.confidence > 0.85
        assert analysis.has_speed_data

    def test_sparse_gappy_trace_is_low_confidence(self) -> None:
        # 6 s sampling with a third of the trip lost to gaps (the production
        # pattern that produced flat-100 scores).
        trace = [_wp(i * 6.0, 50.0) for i in range(40)] + [_wp(400.0 + i * 30.0, 50.0) for i in range(10)]
        analysis = telemetry.analyze(trace, 700)
        assert analysis.confidence < 0.65

    def test_spec_cadence_is_not_penalised_where_a_five_second_trace_is(self) -> None:
        # 2 s sits under the 2.5 s ceiling, so the rate factor saturates and only
        # coverage moves the number. A 5 s trace loses 30 points of confidence on
        # density alone — the spread that thinning to 5 s used to hide.
        dense = telemetry.analyze(_cruise(600, 50.0, dt=2.0), 600)
        thinned = telemetry.analyze(_cruise(600, 50.0, dt=5.0), 600)
        assert dense.confidence > 0.99
        assert thinned.confidence < 0.72

    def test_no_waypoints_is_zero_confidence(self) -> None:
        assert telemetry.analyze(None, 600).confidence == 0.0


class TestApplyConfidence:
    def test_full_confidence_passes_score_through(self) -> None:
        assert apply_confidence(100.0, 80.0, 1.0) == 100.0

    def test_low_confidence_caps_upside_toward_rolling(self) -> None:
        # c=0.5: only half the gap above the rolling score is granted.
        assert apply_confidence(100.0, 80.0, 0.5) == 90.0

    def test_zero_confidence_yields_rolling(self) -> None:
        assert apply_confidence(100.0, 80.0, 0.0) == 80.0

    def test_reported_events_never_diluted(self) -> None:
        # Below the rolling score = positive evidence — passes through even at c=0.
        assert apply_confidence(40.0, 80.0, 0.0) == 40.0


class TestTraceDistance:
    """Trace-derived distance — the witness against an inflated digest (issue #56)."""

    def test_steady_cruise_matches_speed_times_time(self) -> None:
        # 60 km/h for 600 s of samples = 10 km. _cruise emits n = seconds/dt points,
        # so the trace spans (n-1)*dt = 597 s → 9.95 km.
        a = telemetry.analyze(_cruise(600, 60.0), 600)
        assert a.distance_km == round(60.0 * 597 / 3600 * 1000) / 1000

    def test_gaps_are_credited_not_dropped(self) -> None:
        """A >15 s hole still contributes, or sparse-GPS devices under-witness (#17)."""
        trace = [_wp(0, 80.0), _wp(3, 80.0), _wp(60, 80.0), _wp(63, 80.0)]
        a = telemetry.analyze(trace, 63)
        assert a.distance_km == round(80.0 * 63 / 3600 * 1000) / 1000

    def test_stationary_trace_witnesses_no_distance(self) -> None:
        a = telemetry.analyze(_cruise(300, 0.0), 300)
        assert a.distance_km == 0.0

    def test_unusable_trace_reports_zero(self) -> None:
        assert telemetry.analyze([_wp(0, 50.0)], 60).distance_km == 0.0
        assert telemetry.analyze(None, 60).distance_km == 0.0

    def test_deceleration_is_integrated_by_trapezoid(self) -> None:
        # 100 → 0 km/h over 10 s averages 50 km/h → 0.139 km.
        trace = [_wp(0, 100.0), _wp(5, 50.0), _wp(10, 0.0)]
        a = telemetry.analyze(trace, 10)
        assert a.distance_km == round(50.0 * 10 / 3600 * 1000) / 1000


class TestDrivingSecondsAboveThreshold:
    """The distraction denominator (CAR-54) — seconds spent above 15 km/h.

    The gate is CMT's 9.3 mph screen-interaction threshold, rounded. It is a
    separate constant from the kinematic floor, which happens to share its value.
    """

    def test_a_crawl_witnesses_no_driving_seconds(self) -> None:
        assert telemetry.analyze(_cruise(600, 10.0), 600).driving_seconds_above_threshold == 0.0

    def test_a_cruise_witnesses_the_whole_span(self) -> None:
        # _cruise emits n = seconds/dt points, so the trace spans (n-1)*dt = 597 s.
        assert telemetry.analyze(_cruise(600, 50.0), 600).driving_seconds_above_threshold == 597.0

    def test_a_segment_is_credited_by_its_mean_speed(self) -> None:
        # 15.0 km/h is driving. Each segment is judged on the mean of its two ends,
        # so 14.9 -> 15.0 falls short and 40 -> 5 still counts.
        trace = [_wp(0, 0.0), _wp(3, 14.9), _wp(6, 15.0), _wp(9, 40.0), _wp(12, 5.0)]
        assert telemetry.analyze(trace, 12).driving_seconds_above_threshold == 6.0

    def test_a_gap_is_not_decided_by_its_closing_sample(self) -> None:
        """The same minute of driving, once ending at a red light and once starting
        from one. The closing sample used to make it 3 s or 60 s."""
        into_a_stop = [_wp(0, 80.0), _wp(3, 80.0), _wp(63, 0.0)]
        out_of_a_stop = [_wp(0, 0.0), _wp(3, 0.0), _wp(63, 80.0)]
        assert telemetry.analyze(into_a_stop, 63).driving_seconds_above_threshold == 63.0
        assert telemetry.analyze(out_of_a_stop, 63).driving_seconds_above_threshold == 60.0

    def test_gaps_are_credited_not_dropped(self) -> None:
        """Same reason as trace distance: excluding a >15 s hole would shrink the
        denominator and inflate the rate on exactly the sparse-GPS devices (CAR-7)."""
        trace = [_wp(0, 80.0), _wp(3, 80.0), _wp(60, 80.0), _wp(63, 80.0)]
        assert telemetry.analyze(trace, 63).driving_seconds_above_threshold == 63.0

    def test_unusable_trace_reports_zero_via_empty_analysis(self) -> None:
        """An unusable trace has to witness nothing at all: the distraction denominator
        in trips.py credits whatever the trace missed, and that is what makes it fall
        back to the trip's wall-clock duration here."""
        assert telemetry.analyze(None, 60) is telemetry.EMPTY_ANALYSIS
        assert telemetry.analyze([_wp(0, 50.0)], 60) is telemetry.EMPTY_ANALYSIS
        assert telemetry.EMPTY_ANALYSIS.driving_seconds_above_threshold == 0.0


class TestWitnessedSpan:
    """How much of the trip the trace actually saw (CAR-54).

    The distraction numerator is whole-trip, so the denominator has to know what
    the trace missed — otherwise a trace that dies early charges every handling
    second against the few minutes it managed to record.
    """

    def test_span_is_first_to_last_sample(self) -> None:
        # _cruise emits n = seconds/dt points, so the trace spans (n-1)*dt = 597 s.
        assert telemetry.analyze(_cruise(600, 50.0), 600).witnessed_span_seconds == 597.0

    def test_an_unusable_trace_witnesses_nothing(self) -> None:
        assert telemetry.EMPTY_ANALYSIS.witnessed_span_seconds == 0.0

    def test_a_truncated_trace_reports_only_what_it_covered(self) -> None:
        """Five minutes of trace on a 45-minute trip: the span, not the duration."""
        a = telemetry.analyze(_cruise(300, 60.0), 2700)
        assert a.witnessed_span_seconds == 297.0
        assert a.driving_seconds_above_threshold == 297.0

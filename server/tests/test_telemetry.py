"""Unit tests for the server-side GPS telemetry analyzer (v2.1).

Fixtures mirror the artifacts observed in production traces: near-duplicate
timestamps, 3–6 s sampling, >15 s gaps, and motorway speeding that the client
digest reported as zero events.
"""

from __future__ import annotations

from app.services import telemetry
from app.services.scoring_v2 import apply_confidence


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
        assert analysis.speeding_weight == 0.0


class TestKinematicDetection:
    def test_hard_brake_detected(self) -> None:
        # 60 → 20 km/h over 3 s ≈ −3.7 m/s².
        trace = _cruise(30, 60.0)
        t0 = len(trace) * 3.0
        trace += [_wp(t0, 60.0), _wp(t0 + 3.0, 20.0), _wp(t0 + 6.0, 20.0)]
        analysis = telemetry.analyze(trace, 40)
        assert analysis.hard_brakes == 1
        assert any(e.type == "HARD_BRAKE" for e in analysis.events)

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
        # A hard stop from 12 km/h is a parking maneuver, not an event (§4).
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
    def test_below_conservative_threshold_is_free(self) -> None:
        # 125 km/h may be legal (120 roads) — inside the noise buffer, no weight.
        assert telemetry.analyze(_cruise(120, 125.0), 120).speeding_weight == 0.0

    def test_sustained_speeding_accumulates_weighted_minutes(self) -> None:
        # 2 minutes at 135 km/h → minor band (w=1) → ≈2.0 weighted minutes.
        analysis = telemetry.analyze(_cruise(120, 135.0), 120)
        assert 1.5 <= analysis.speeding_weight <= 2.1
        assert any(e.type == "SPEEDING" for e in analysis.events)

    def test_extreme_band_weighs_8x(self) -> None:
        minor = telemetry.analyze(_cruise(60, 135.0), 60).speeding_weight
        extreme = telemetry.analyze(_cruise(60, 155.0), 60).speeding_weight
        assert extreme > minor * 6

    def test_one_run_yields_one_speeding_event(self) -> None:
        analysis = telemetry.analyze(_cruise(120, 140.0), 120)
        assert sum(1 for e in analysis.events if e.type == "SPEEDING") == 1


class TestConfidence:
    def test_dense_clean_trace_is_high_confidence(self) -> None:
        analysis = telemetry.analyze(_cruise(600, 50.0), 600)
        assert analysis.confidence > 0.85
        assert analysis.has_speed_data

    def test_sparse_gappy_trace_is_low_confidence(self) -> None:
        # 6 s sampling with a third of the trip lost to gaps (the production
        # pattern that produced flat-100 scores).
        trace = [_wp(i * 6.0, 50.0) for i in range(40)] + [_wp(400.0 + i * 30.0, 50.0) for i in range(10)]
        analysis = telemetry.analyze(trace, 700)
        assert analysis.confidence < 0.65

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

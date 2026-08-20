"""Unit tests for the trip-save guards in `app.services.trips`.

Timestamp drift, digest signature verification, plausibility limits and the
distance witness (#56) — everything that decides whether a submitted trip is
accepted at all, before scoring runs.

Was `test_scoring_oracle.py`. The `calculate_score` blocks it opened with went
with the v1 engine (#53); the risk-multiplier and timezone cases that reached
the multiplier through it now live in `test_risk.py`, which tests it directly.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from datetime import UTC, datetime

import pytest

from app.schemas.trip import SaveTripIn
from app.services import telemetry, trips
from app.services.trips import (
    _check_timestamp_drift,
    _validate_plausibility,
    _verify_signature,
    _witness_distance,
)

# ─── _check_timestamp_drift ───────────────────────────────────────────────────


class TestCheckTimestampDrift:
    def _fresh_digest(self, offset_s: float = 0.0) -> dict:
        ts_ms = (datetime.now(UTC).timestamp() + offset_s) * 1000
        return {"timestamp": ts_ms, "distanceKm": 5.0}

    def test_fresh_digest_passes(self) -> None:
        _check_timestamp_drift(self._fresh_digest())  # must not raise

    def test_digest_at_299s_passes(self) -> None:
        _check_timestamp_drift(self._fresh_digest(offset_s=-299))

    def test_stale_digest_raises_401(self) -> None:
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            _check_timestamp_drift(self._fresh_digest(offset_s=-301))
        assert exc_info.value.status_code == 401

    def test_future_digest_raises_401(self) -> None:
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            _check_timestamp_drift(self._fresh_digest(offset_s=+301))
        assert exc_info.value.status_code == 401

    def test_no_digest_skips_check(self) -> None:
        _check_timestamp_drift(None)  # must not raise

    def test_digest_without_timestamp_skips_check(self) -> None:
        _check_timestamp_drift({"distanceKm": 5.0})  # must not raise

    def test_invalid_timestamp_raises_401(self) -> None:
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            _check_timestamp_drift({"timestamp": "not-a-number"})
        assert exc_info.value.status_code == 401


# ─── _verify_signature ────────────────────────────────────────────────────────


class TestVerifySignature:
    def _fresh_digest(self) -> dict:
        ts_ms = datetime.now(UTC).timestamp() * 1000
        return {"timestamp": ts_ms, "distanceKm": 5.0}

    def test_no_signature_skips_check(self) -> None:
        _verify_signature(None, None, "secret")  # must not raise

    def test_ph_bypass_skips_hmac(self) -> None:
        _verify_signature(self._fresh_digest(), "ph:sprint1", "secret")  # must not raise

    def test_missing_digest_with_signature_raises_403(self) -> None:
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            _verify_signature(None, "somesig", "secret")
        assert exc_info.value.status_code == 403

    def test_valid_hmac_passes(self) -> None:
        secret = "testsecret"
        digest = self._fresh_digest()
        canonical = json.dumps(digest, sort_keys=True, separators=(",", ":"))
        sig = hmac.new(secret.encode(), canonical.encode(), hashlib.sha256).hexdigest()
        _verify_signature(digest, sig, secret)  # must not raise

    def test_invalid_hmac_raises_403(self) -> None:
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            _verify_signature(self._fresh_digest(), "badhash", "secret")
        assert exc_info.value.status_code == 403

    def test_no_secret_skips_hmac(self) -> None:
        _verify_signature(self._fresh_digest(), "anysig", "")  # must not raise


# ─── _validate_plausibility ───────────────────────────────────────────────────


class TestValidatePlausibility:
    def _make(self, **kwargs) -> SaveTripIn:
        return SaveTripIn(**kwargs)

    def test_negative_hard_brakes_rejected(self) -> None:
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as e:
            _validate_plausibility(self._make(hard_brakes=-1))
        assert e.value.status_code == 422

    def test_negative_aggressive_accels_rejected(self) -> None:
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as e:
            _validate_plausibility(self._make(aggressive_accels=-1))
        assert e.value.status_code == 422

    def test_negative_sharp_turns_rejected(self) -> None:
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as e:
            _validate_plausibility(self._make(sharp_turns=-1))
        assert e.value.status_code == 422

    def test_negative_touch_epochs_rejected(self) -> None:
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as e:
            _validate_plausibility(self._make(touch_epochs=-1))
        assert e.value.status_code == 422

    def test_negative_screen_secs_rejected(self) -> None:
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as e:
            _validate_plausibility(self._make(screen_interaction_seconds=-1))
        assert e.value.status_code == 422

    def test_negative_distance_rejected(self) -> None:
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as e:
            _validate_plausibility(self._make(distance_km=-1.0))
        assert e.value.status_code == 422

    def test_zero_values_pass(self) -> None:
        _validate_plausibility(
            self._make(
                hard_brakes=0,
                aggressive_accels=0,
                sharp_turns=0,
                touch_epochs=0,
                screen_interaction_seconds=0,
                distance_km=0.0,
            )
        )

    def test_client_points_skip_when_digest_present(self) -> None:
        _validate_plausibility(
            self._make(
                points=999_999,
                telemetry_digest={"distanceKm": 5.0, "durationSeconds": 600},
            )
        )  # must not raise — oracle overrides

    def test_client_points_checked_without_digest(self) -> None:
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as e:
            _validate_plausibility(self._make(points=999_999, telemetry_digest=None))
        assert e.value.status_code == 422

    def test_avg_score_out_of_range_rejected(self) -> None:
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as e:
            _validate_plausibility(self._make(avg_score=101.0))
        assert e.value.status_code == 422

    def test_implausible_speed_rejected(self) -> None:
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as e:
            _validate_plausibility(self._make(distance_km=300.0, duration_seconds=60))
        assert e.value.status_code == 422


# ─── Digest physics validation ────────────────────────────────────────────────


class TestValidatePlausibilityDigestPhysics:
    def _make(self, **kwargs) -> SaveTripIn:
        return SaveTripIn(**kwargs)

    def test_digest_implausible_speed_rejected(self) -> None:
        from fastapi import HTTPException

        dto = self._make(
            distance_km=10.0,
            duration_seconds=600,
            telemetry_digest={"distanceKm": 999.0, "durationSeconds": 60},
        )
        with pytest.raises(HTTPException) as e:
            _validate_plausibility(dto)
        assert e.value.status_code == 422

    def test_digest_plausible_speed_passes(self) -> None:
        _validate_plausibility(
            self._make(
                telemetry_digest={"distanceKm": 10.0, "durationSeconds": 600},
            )
        )

    def test_digest_zero_distance_skips_speed_check(self) -> None:
        _validate_plausibility(
            self._make(
                telemetry_digest={"distanceKm": 0, "durationSeconds": 1},
            )
        )

    def test_digest_missing_distance_skips_speed_check(self) -> None:
        _validate_plausibility(
            self._make(
                telemetry_digest={"durationSeconds": 60},
            )
        )

    def test_digest_at_speed_boundary_passes(self) -> None:
        _validate_plausibility(
            self._make(
                telemetry_digest={"distanceKm": 250.0, "durationSeconds": 3600},
            )
        )

    def test_digest_one_over_boundary_rejected(self) -> None:
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as e:
            _validate_plausibility(
                self._make(
                    telemetry_digest={"distanceKm": 251.0, "durationSeconds": 3600},
                )
            )
        assert e.value.status_code == 422


# ─── _witness_distance (issue #56) ────────────────────────────────────────────


class TestWitnessDistance:
    def test_claim_within_witness_is_untouched(self) -> None:
        assert _witness_distance(10.0, 10.0) == 10.0

    def test_claim_inside_tolerance_is_untouched(self) -> None:
        # 10 km witnessed → cap is 10 * 1.35 + 1 = 14.5
        assert _witness_distance(14.0, 10.0) == 14.0

    def test_inflated_claim_is_capped(self) -> None:
        assert _witness_distance(150.0, 10.0) == pytest.approx(14.5)

    def test_sparse_trace_still_gets_generous_headroom(self) -> None:
        """A trace that witnesses only half the real drive must not halve the score."""
        # Honest 20 km trip whose gappy trace only accounts for 15 km.
        assert _witness_distance(20.0, 15.0) == 20.0

    def test_short_trip_grace_floor(self) -> None:
        """Coarse sampling on a 1 km trip witnesses almost nothing — grace covers it."""
        assert _witness_distance(1.5, 0.2) == pytest.approx(1.27)

    def test_no_trace_is_not_capped(self) -> None:
        """Clients that send no waypoints still work — the case is audited, not blocked."""
        assert _witness_distance(150.0, 0.0) == 150.0

    def test_zero_claim_with_no_trace(self) -> None:
        assert _witness_distance(0.0, 0.0) == 0.0


class TestDistractionExposure:
    """The distraction denominator, and what it does with a trace that stopped early.

    CMT score only the stretch where speed data exists and err in favour of the
    driver being undistracted everywhere else (US11932257B2). Until the numerator
    is per-second (CAR-175), crediting the unwitnessed remainder as driving is the
    same bias in the same direction.
    """

    def test_a_fully_traced_drive_is_charged_over_the_whole_trip(self) -> None:
        gps = telemetry.analyze(_cruise_trace(2700, 60.0), 2700)
        assert trips._distraction_exposure_min(gps, 2700) == pytest.approx(45.0, abs=0.01)

    def test_a_traced_crawl_is_not_charged_as_driving(self) -> None:
        """Half the trip stuck in traffic. Built from 4 km/h waypoints because that is
        what the SDK actually emits: it gates capture at 3 km/h, so a genuinely
        stationary car sends nothing and never reaches this layer at all."""
        trace = _cruise_trace(1350, 60.0) + [_wp_at(1350 + i * 3, 4.0) for i in range(450)]
        gps = telemetry.analyze(trace, 2700)
        assert trips._distraction_exposure_min(gps, 2700) == pytest.approx(22.55, abs=0.05)

    def test_a_truncated_trace_does_not_shrink_the_denominator(self) -> None:
        """The regression this class exists for: a 45-minute drive whose trace dies
        after 5 minutes must still be charged over ~45 minutes, not over 5."""
        gps = telemetry.analyze(_cruise_trace(300, 60.0), 2700)
        assert gps.driving_seconds_above_threshold / 60.0 == pytest.approx(4.95, abs=0.01)
        assert trips._distraction_exposure_min(gps, 2700) == pytest.approx(45.0, abs=0.05)

    def test_no_usable_trace_still_falls_back_to_wall_clock(self) -> None:
        assert trips._distraction_exposure_min(telemetry.EMPTY_ANALYSIS, 2700) == 45.0

    def test_a_measured_crawl_is_still_a_measured_zero(self) -> None:
        """A fully-traced trip spent below 15 km/h yields no driving seconds. That is
        a real measurement, and the 5-minute floor in scoring takes it from here."""
        gps = telemetry.analyze(_cruise_trace(2400, 10.0), 2400)
        assert gps.driving_seconds_above_threshold == 0.0
        assert trips._distraction_exposure_min(gps, 2400) == pytest.approx(0.05, abs=0.01)

    def test_a_gap_inside_the_span_is_not_credited_twice(self) -> None:
        """Gaps are already counted as driving; only the untraced head and tail are
        added. The denominator can never exceed the trip's own duration."""
        trace = [_wp_at(0, 80.0), _wp_at(3, 80.0), _wp_at(60, 80.0), _wp_at(63, 80.0)]
        gps = telemetry.analyze(trace, 63)
        assert trips._distraction_exposure_min(gps, 63) == pytest.approx(63.0 / 60.0)


def _wp_at(ts_s: float, speed: float) -> dict:
    return {"ts": ts_s * 1000.0, "lat": 32.0 + ts_s * 1e-4, "lng": 34.8, "speedKmh": speed}


def _cruise_trace(seconds: int, speed: float, dt: float = 3.0) -> list[dict]:
    n = int(seconds / dt)
    return [_wp_at(i * dt, speed) for i in range(n)]

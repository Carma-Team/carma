"""Unit tests for the server-side scoring oracle and signature verification."""

from __future__ import annotations

import hashlib
import hmac
import json
import math
from datetime import UTC, datetime

import pytest

from app.schemas.trip import SaveTripIn
from app.services.scoring import calculate_score
from app.services.trips import _check_timestamp_drift, _validate_plausibility, _verify_signature

# ─── Helpers ──────────────────────────────────────────────────────────────────


def _score(
    *,
    hard_brakes: int = 0,
    aggressive_accels: int = 0,
    sharp_turns: int = 0,
    touch_epochs: int = 0,
    screen_interaction_seconds: int = 0,
    duration_seconds: int = 600,
    distance_km: float = 5.0,
    iso: str = "2026-01-08T14:00:00+02:00",  # Thu 14:00 IL — daytime
) -> tuple[float, float, float]:
    start = datetime.fromisoformat(iso)
    return calculate_score(
        hard_brakes=hard_brakes,
        aggressive_accels=aggressive_accels,
        sharp_turns=sharp_turns,
        touch_epochs=touch_epochs,
        screen_interaction_seconds=screen_interaction_seconds,
        duration_seconds=duration_seconds,
        distance_km=distance_km,
        start_time=start,
    )


# ─── calculate_score — basics ─────────────────────────────────────────────────

class TestServerScoreBasic:
    def test_perfect_clean_trip_5km(self) -> None:
        score, points, rm = _score(distance_km=5.0)
        assert score == 100.0
        assert rm == 1.0
        expected = round(100.0 * math.log(6) / math.log(11) * 1.0 * 10) / 10
        assert points == expected

    def test_hard_brakes_penalty(self) -> None:
        # 2 hard brakes × 5 = 10 penalty → score 90
        score, _, _ = _score(hard_brakes=2, distance_km=12.0)
        assert score == 90.0

    def test_score_clamps_to_zero(self) -> None:
        score, points, _ = _score(hard_brakes=30)
        assert score == 0.0
        assert points == 0.0

    def test_score_clamps_to_hundred(self) -> None:
        score, _, _ = _score(distance_km=100.0)
        assert score == 100.0

    def test_zero_distance_gives_zero_points(self) -> None:
        _, points, _ = _score(distance_km=0.0)
        assert points == 0.0

    def test_screen_interaction_fraction_penalty(self) -> None:
        # 50% screen time → penalty = 0.5 × 40 = 20 → score 80
        score, _, _ = _score(screen_interaction_seconds=300, duration_seconds=600)
        assert score == 80.0

    def test_touch_epochs_penalty(self) -> None:
        # 2 touch epochs × 4 = 8 penalty → score 92
        score, _, _ = _score(touch_epochs=2)
        assert score == 92.0

    def test_all_event_types_combined(self) -> None:
        # hb=1×5 + aa=1×3 + st=1×2 + te=1×4 + sis=60/600×40 = 18
        expected_score = round(max(0.0, min(100.0, 100.0 - (5 + 3 + 2 + 4 + (60/600)*40))) * 10) / 10
        score, _, _ = _score(
            hard_brakes=1, aggressive_accels=1, sharp_turns=1,
            touch_epochs=1, screen_interaction_seconds=60, duration_seconds=600,
        )
        assert score == expected_score

    def test_full_screen_session(self) -> None:
        # 100% screen time → penalty=40 → score=60
        score, _, _ = _score(screen_interaction_seconds=600, duration_seconds=600)
        assert score == 60.0


# ─── get_risk_multiplier ──────────────────────────────────────────────────────

class TestServerScoreRiskMultiplier:
    # All timestamps expressed in Israel local time (+02:00 in January).

    def test_daytime_risk_1(self) -> None:
        _, _, rm = _score(iso="2026-01-08T14:00:00+02:00")  # Thu 14:00 IL
        assert rm == 1.0

    def test_thursday_night_risk_2(self) -> None:
        score, points, rm = _score(iso="2026-01-08T23:00:00+02:00")  # Thu 23:00 IL
        assert rm == 2.0
        assert score == 100.0
        expected = round(100.0 * math.log(6) / math.log(11) * 2.0 * 10) / 10
        assert points == expected

    def test_friday_night_risk_2(self) -> None:
        _, _, rm = _score(iso="2026-01-09T01:00:00+02:00")  # Fri 01:00 IL
        assert rm == 2.0

    def test_saturday_night_risk_2(self) -> None:
        _, _, rm = _score(iso="2026-01-10T02:00:00+02:00")  # Sat 02:00 IL
        assert rm == 2.0

    def test_sunday_night_risk_1_5(self) -> None:
        _, _, rm = _score(iso="2026-01-11T23:30:00+02:00")  # Sun 23:30 IL — not weekend
        assert rm == 1.5

    def test_wednesday_night_risk_1_5(self) -> None:
        _, _, rm = _score(iso="2026-01-07T00:30:00+02:00")  # Wed 00:30 IL — not weekend
        assert rm == 1.5

    def test_hour_23_is_night(self) -> None:
        _, _, rm = _score(iso="2026-01-08T23:00:00+02:00")  # Thu 23:00 IL
        assert rm == 2.0

    def test_hour_3_is_night(self) -> None:
        _, _, rm = _score(iso="2026-01-09T03:00:00+02:00")  # Fri 03:00 IL
        assert rm == 2.0

    def test_hour_4_is_day(self) -> None:
        _, _, rm = _score(iso="2026-01-08T04:00:00+02:00")  # Thu 04:00 IL — boundary
        assert rm == 1.0

    def test_hour_22_is_day(self) -> None:
        _, _, rm = _score(iso="2026-01-08T22:00:00+02:00")  # Thu 22:00 IL
        assert rm == 1.0


# ─── Timezone: UTC input → Israel local ───────────────────────────────────────

class TestServerScoreTimezone:
    def test_utc_21_thursday_is_night_in_israel(self) -> None:
        # Thu 21:00 UTC = Thu 23:00 Israel (UTC+2) → weekend night → rm=2.0
        start = datetime(2026, 1, 8, 21, 0, 0, tzinfo=UTC)
        _, _, rm = calculate_score(0, 0, 0, 0, 0, 600, 5.0, start)
        assert rm == 2.0

    def test_utc_21_thursday_is_not_daytime(self) -> None:
        # Without timezone fix, UTC hour=21 → daytime (rm=1.0). Confirms fix works.
        start = datetime(2026, 1, 8, 21, 0, 0, tzinfo=UTC)
        _, _, rm = calculate_score(0, 0, 0, 0, 0, 600, 5.0, start)
        assert rm != 1.0

    def test_utc_midnight_friday_is_night_in_israel(self) -> None:
        # Fri 00:00 UTC = Fri 02:00 IL → night + Fri → rm=2.0
        start = datetime(2026, 1, 9, 0, 0, 0, tzinfo=UTC)
        _, _, rm = calculate_score(0, 0, 0, 0, 0, 600, 5.0, start)
        assert rm == 2.0

    def test_utc_22_thursday_crosses_to_friday_midnight_in_israel(self) -> None:
        # Thu 22:00 UTC = Fri 00:00 IL → night + Fri → rm=2.0
        start = datetime(2026, 1, 8, 22, 0, 0, tzinfo=UTC)
        _, _, rm = calculate_score(0, 0, 0, 0, 0, 600, 5.0, start)
        assert rm == 2.0


# ─── Negative event count security ────────────────────────────────────────────

class TestServerScoreNegativeEventCountSecurity:
    """Negative event counts must not reduce penalties (anti-fraud)."""

    def test_negative_hard_brakes_floored(self) -> None:
        legit, _, _ = _score(hard_brakes=0, aggressive_accels=10)
        attack, _, _ = _score(hard_brakes=-5, aggressive_accels=10)
        assert attack == legit

    def test_negative_aggressive_accels_floored(self) -> None:
        legit, _, _ = _score(hard_brakes=2, aggressive_accels=0)
        attack, _, _ = _score(hard_brakes=2, aggressive_accels=-100)
        assert attack == legit

    def test_negative_sharp_turns_floored(self) -> None:
        legit, _, _ = _score(sharp_turns=0)
        attack, _, _ = _score(sharp_turns=-50)
        assert attack == legit == 100.0

    def test_negative_touch_epochs_floored(self) -> None:
        legit, _, _ = _score(touch_epochs=0)
        attack, _, _ = _score(touch_epochs=-20)
        assert attack == legit == 100.0

    def test_negative_screen_secs_floored(self) -> None:
        legit, _, _ = _score(screen_interaction_seconds=0)
        attack, _, _ = _score(screen_interaction_seconds=-300)
        assert attack == legit == 100.0

    def test_negative_distance_gives_zero_points(self) -> None:
        _, points, _ = _score(distance_km=-10.0)
        assert points == 0.0

    def test_combined_all_negative_equals_all_zero(self) -> None:
        clean, clean_pts, _ = _score()
        attack, attack_pts, _ = _score(
            hard_brakes=-999, aggressive_accels=-999, sharp_turns=-999,
            touch_epochs=-999, screen_interaction_seconds=-9999, distance_km=-5.0,
        )
        assert attack == clean == 100.0
        assert attack_pts == 0.0  # negative distance → no points


# ─── Missing / null fields ────────────────────────────────────────────────────

class TestServerScoreMissingFields:
    def test_zero_input_returns_perfect_no_points(self) -> None:
        score, points, rm = _score(distance_km=0.0)
        assert score == 100.0
        assert points == 0.0
        assert rm == 1.0

    def test_duration_zero_uses_floor_of_1(self) -> None:
        # durationSeconds=0 → clamped to 1 → no division-by-zero
        score, _, _ = _score(duration_seconds=0)
        assert score == 100.0


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
        _validate_plausibility(self._make(
            hard_brakes=0, aggressive_accels=0, sharp_turns=0,
            touch_epochs=0, screen_interaction_seconds=0, distance_km=0.0,
        ))

    def test_client_points_skip_when_digest_present(self) -> None:
        _validate_plausibility(self._make(
            points=999_999,
            telemetry_digest={"distanceKm": 5.0, "durationSeconds": 600},
        ))  # must not raise — oracle overrides

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
            distance_km=10.0, duration_seconds=600,
            telemetry_digest={"distanceKm": 999.0, "durationSeconds": 60},
        )
        with pytest.raises(HTTPException) as e:
            _validate_plausibility(dto)
        assert e.value.status_code == 422

    def test_digest_plausible_speed_passes(self) -> None:
        _validate_plausibility(self._make(
            telemetry_digest={"distanceKm": 10.0, "durationSeconds": 600},
        ))

    def test_digest_zero_distance_skips_speed_check(self) -> None:
        _validate_plausibility(self._make(
            telemetry_digest={"distanceKm": 0, "durationSeconds": 1},
        ))

    def test_digest_missing_distance_skips_speed_check(self) -> None:
        _validate_plausibility(self._make(
            telemetry_digest={"durationSeconds": 60},
        ))

    def test_digest_at_speed_boundary_passes(self) -> None:
        _validate_plausibility(self._make(
            telemetry_digest={"distanceKm": 250.0, "durationSeconds": 3600},
        ))

    def test_digest_one_over_boundary_rejected(self) -> None:
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as e:
            _validate_plausibility(self._make(
                telemetry_digest={"distanceKm": 251.0, "durationSeconds": 3600},
            ))
        assert e.value.status_code == 422

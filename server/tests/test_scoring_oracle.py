"""Unit tests for the server-side scoring oracle and signature verification."""

from __future__ import annotations

import hashlib
import hmac
import json
import math
from datetime import UTC, datetime

import pytest

from app.schemas.trip import SaveTripIn
from app.services.trips import _server_score, _validate_plausibility, _verify_signature

# ─── _server_score ────────────────────────────────────────────────────────────

def _score(digest: dict, iso: str = "2026-01-08T14:00:00+00:00") -> tuple[float, int, float]:
    start = datetime.fromisoformat(iso)
    return _server_score(digest, start)


class TestServerScoreBasic:
    def test_perfect_clean_trip_5km(self) -> None:
        # Scenario B: zero events, 5 km, 10 min
        score, points, rm = _score(
            {"hardBrakes": 0, "aggressiveAccels": 0, "sharpTurns": 0,
             "phoneSeconds": 0, "durationSeconds": 600, "distanceKm": 5.0}
        )
        assert score == 100.0
        assert rm == 1.0
        # distance_factor = log(6)/log(11) ≈ 0.7508
        expected = max(0, round(100.0 * math.log(6) / math.log(11) * 1.0))
        assert points == expected

    def test_scenario_a_hard_brakes_12km(self) -> None:
        # Scenario A: hb=2, 12km, 600s → penalties=10, score=90
        score, points, rm = _score(
            {"hardBrakes": 2, "aggressiveAccels": 0, "sharpTurns": 0,
             "phoneSeconds": 0, "durationSeconds": 600, "distanceKm": 12.0}
        )
        assert score == 90.0
        assert rm == 1.0
        expected = max(0, round(90.0 * math.log(13) / math.log(11) * 1.0))
        assert points == expected

    def test_score_clamps_to_zero(self) -> None:
        score, points, rm = _score(
            {"hardBrakes": 30, "aggressiveAccels": 0, "sharpTurns": 0,
             "phoneSeconds": 0, "durationSeconds": 600, "distanceKm": 5.0}
        )
        assert score == 0.0
        assert points == 0

    def test_score_clamps_to_hundred(self) -> None:
        score, _, _ = _score(
            {"hardBrakes": 0, "aggressiveAccels": 0, "sharpTurns": 0,
             "phoneSeconds": 0, "durationSeconds": 600, "distanceKm": 100.0}
        )
        assert score == 100.0

    def test_zero_distance_gives_zero_points(self) -> None:
        _, points, _ = _score(
            {"hardBrakes": 0, "aggressiveAccels": 0, "sharpTurns": 0,
             "phoneSeconds": 0, "durationSeconds": 600, "distanceKm": 0.0}
        )
        assert points == 0

    def test_phone_fraction_penalty(self) -> None:
        # 50% phone time → penalty=20
        score, _, _ = _score(
            {"hardBrakes": 0, "aggressiveAccels": 0, "sharpTurns": 0,
             "phoneSeconds": 300, "durationSeconds": 600, "distanceKm": 5.0}
        )
        assert score == 80.0

    def test_all_event_types_combined(self) -> None:
        # hb=1*5 + aa=1*3 + st=1*2 + phone=100s/600s*40 = 10 + 6.67 = 16.67 → score=83.3
        score, _, _ = _score(
            {"hardBrakes": 1, "aggressiveAccels": 1, "sharpTurns": 1,
             "phoneSeconds": 100, "durationSeconds": 600, "distanceKm": 5.0}
        )
        assert score == round(max(0.0, min(100.0, 100.0 - (5 + 3 + 2 + 100/600*40))) * 10) / 10


class TestServerScoreRiskMultiplier:
    # All timestamps expressed in Israel local time (UTC+2 in January).
    # The server converts to Asia/Jerusalem before extracting hour/weekday.

    def test_daytime_risk_1(self) -> None:
        _, _, rm = _score(
            {"distanceKm": 5.0, "durationSeconds": 600},
            iso="2026-01-08T14:00:00+02:00",  # Thu 14:00 IL — daytime
        )
        assert rm == 1.0

    def test_thursday_night_risk_2(self) -> None:
        # Scenario F: Thu 23:00 IL — Israeli weekend night → rm=2.0
        score, points, rm = _score(
            {"hardBrakes": 0, "aggressiveAccels": 0, "sharpTurns": 0,
             "phoneSeconds": 0, "durationSeconds": 600, "distanceKm": 5.0},
            iso="2026-01-08T23:00:00+02:00",  # Thu Jan 8 23:00 IL
        )
        assert rm == 2.0
        assert score == 100.0
        expected = max(0, round(100.0 * math.log(6) / math.log(11) * 2.0))
        assert points == expected

    def test_friday_night_risk_2(self) -> None:
        _, _, rm = _score(
            {"distanceKm": 5.0, "durationSeconds": 600},
            iso="2026-01-09T01:00:00+02:00",  # Fri Jan 9 01:00 IL
        )
        assert rm == 2.0

    def test_saturday_night_risk_2(self) -> None:
        _, _, rm = _score(
            {"distanceKm": 5.0, "durationSeconds": 600},
            iso="2026-01-10T02:00:00+02:00",  # Sat Jan 10 02:00 IL
        )
        assert rm == 2.0

    def test_sunday_night_risk_1_5(self) -> None:
        _, _, rm = _score(
            {"distanceKm": 5.0, "durationSeconds": 600},
            iso="2026-01-11T23:30:00+02:00",  # Sun Jan 11 23:30 IL — night, not weekend
        )
        assert rm == 1.5

    def test_wednesday_night_risk_1_5(self) -> None:
        _, _, rm = _score(
            {"distanceKm": 5.0, "durationSeconds": 600},
            iso="2026-01-07T00:30:00+02:00",  # Wed Jan 7 00:30 IL — night, not weekend
        )
        assert rm == 1.5

    def test_hour_23_is_night(self) -> None:
        _, _, rm = _score(
            {"distanceKm": 5.0, "durationSeconds": 600},
            iso="2026-01-08T23:00:00+02:00",  # Thu 23:00 IL
        )
        assert rm == 2.0

    def test_hour_3_is_night(self) -> None:
        _, _, rm = _score(
            {"distanceKm": 5.0, "durationSeconds": 600},
            iso="2026-01-09T03:00:00+02:00",  # Fri 03:00 IL
        )
        assert rm == 2.0

    def test_hour_4_is_day(self) -> None:
        _, _, rm = _score(
            {"distanceKm": 5.0, "durationSeconds": 600},
            iso="2026-01-08T04:00:00+02:00",  # Thu 04:00 IL — boundary, no longer night
        )
        assert rm == 1.0

    def test_hour_22_is_day(self) -> None:
        _, _, rm = _score(
            {"distanceKm": 5.0, "durationSeconds": 600},
            iso="2026-01-08T22:00:00+02:00",  # Thu 22:00 IL — daytime
        )
        assert rm == 1.0


class TestServerScoreNegativeEventCountSecurity:
    """Ensure negative event counts cannot reduce penalties (anti-fraud)."""

    def test_negative_hard_brakes_floored(self) -> None:
        score_legit, _, _ = _score(
            {"hardBrakes": 0, "aggressiveAccels": 10, "sharpTurns": 0,
             "phoneSeconds": 0, "durationSeconds": 600, "distanceKm": 5.0}
        )
        score_attack, _, _ = _score(
            {"hardBrakes": -5, "aggressiveAccels": 10, "sharpTurns": 0,
             "phoneSeconds": 0, "durationSeconds": 600, "distanceKm": 5.0}
        )
        # Negative hb must be treated as 0 — scores must be equal
        assert score_attack == score_legit

    def test_negative_aggressive_accels_floored(self) -> None:
        score_legit, _, _ = _score(
            {"hardBrakes": 2, "aggressiveAccels": 0, "sharpTurns": 0,
             "phoneSeconds": 0, "durationSeconds": 600, "distanceKm": 5.0}
        )
        score_attack, _, _ = _score(
            {"hardBrakes": 2, "aggressiveAccels": -100, "sharpTurns": 0,
             "phoneSeconds": 0, "durationSeconds": 600, "distanceKm": 5.0}
        )
        assert score_attack == score_legit

    def test_negative_sharp_turns_floored(self) -> None:
        score_legit, _, _ = _score(
            {"hardBrakes": 0, "aggressiveAccels": 0, "sharpTurns": 0,
             "phoneSeconds": 0, "durationSeconds": 600, "distanceKm": 5.0}
        )
        score_attack, _, _ = _score(
            {"hardBrakes": 0, "aggressiveAccels": 0, "sharpTurns": -50,
             "phoneSeconds": 0, "durationSeconds": 600, "distanceKm": 5.0}
        )
        assert score_attack == score_legit
        assert score_attack == 100.0

    def test_negative_phone_seconds_floored(self) -> None:
        score_legit, _, _ = _score(
            {"hardBrakes": 0, "aggressiveAccels": 0, "sharpTurns": 0,
             "phoneSeconds": 0, "durationSeconds": 600, "distanceKm": 5.0}
        )
        score_attack, _, _ = _score(
            {"hardBrakes": 0, "aggressiveAccels": 0, "sharpTurns": 0,
             "phoneSeconds": -300, "durationSeconds": 600, "distanceKm": 5.0}
        )
        assert score_attack == score_legit
        assert score_attack == 100.0

    def test_negative_distance_km_floored(self) -> None:
        # Negative distance must not give negative distance_factor (imaginary log)
        _, points, _ = _score(
            {"hardBrakes": 0, "aggressiveAccels": 0, "sharpTurns": 0,
             "phoneSeconds": 0, "durationSeconds": 600, "distanceKm": -10.0}
        )
        assert points == 0

    def test_combined_attack_all_negative(self) -> None:
        # Fully adversarial digest — all events negative, should give same as all-zero
        score_zero, points_zero, _ = _score(
            {"hardBrakes": 0, "aggressiveAccels": 0, "sharpTurns": 0,
             "phoneSeconds": 0, "durationSeconds": 600, "distanceKm": 5.0}
        )
        score_attack, points_attack, _ = _score(
            {"hardBrakes": -999, "aggressiveAccels": -999, "sharpTurns": -999,
             "phoneSeconds": -9999, "durationSeconds": 600, "distanceKm": 5.0}
        )
        assert score_attack == score_zero
        assert points_attack == points_zero


class TestServerScoreMissingFields:
    def test_missing_all_fields_returns_perfect(self) -> None:
        score, _, rm = _score({})
        assert score == 100.0
        assert rm == 1.0

    def test_null_fields_treated_as_zero(self) -> None:
        score, _, _ = _score(
            {"hardBrakes": None, "aggressiveAccels": None, "sharpTurns": None,
             "phoneSeconds": None, "durationSeconds": None, "distanceKm": None}
        )
        assert score == 100.0

    def test_duration_zero_uses_floor_of_1(self) -> None:
        # durationSeconds=0 → clamped to 1.0 → phoneSeconds/duration does not divide by zero
        score, _, _ = _score(
            {"hardBrakes": 0, "aggressiveAccels": 0, "sharpTurns": 0,
             "phoneSeconds": 0, "durationSeconds": 0, "distanceKm": 5.0}
        )
        assert score == 100.0


# ─── _verify_signature ────────────────────────────────────────────────────────

class TestVerifySignatureStaleCheck:
    def _fresh_digest(self, offset_s: float = 0.0) -> dict:
        ts_ms = (datetime.now(UTC).timestamp() + offset_s) * 1000
        return {"timestamp": ts_ms, "distanceKm": 5.0}

    def test_fresh_signature_passes(self) -> None:
        digest = self._fresh_digest(offset_s=0)
        # ph: bypass — just checks staleness, should not raise
        _verify_signature(digest, "ph:sprint1", "secret")

    def test_signature_at_299s_passes(self) -> None:
        digest = self._fresh_digest(offset_s=-299)
        _verify_signature(digest, "ph:sprint1", "secret")

    def test_stale_signature_raises_401(self) -> None:
        from fastapi import HTTPException
        digest = self._fresh_digest(offset_s=-301)
        with pytest.raises(HTTPException) as exc_info:
            _verify_signature(digest, "ph:sprint1", "secret")
        assert exc_info.value.status_code == 401

    def test_no_signature_skips_all_checks(self) -> None:
        # signature=None → no-op, even with stale digest
        digest = self._fresh_digest(offset_s=-9999)
        _verify_signature(digest, None, "secret")  # must not raise

    def test_ph_bypass_skips_hmac(self) -> None:
        digest = self._fresh_digest()
        _verify_signature(digest, "ph:anything", "secret")  # must not raise

    def test_missing_digest_with_signature_raises_403(self) -> None:
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc_info:
            _verify_signature(None, "somesignature", "secret")
        assert exc_info.value.status_code == 403

    def test_valid_hmac_passes(self) -> None:
        secret = "testsecret"
        digest = self._fresh_digest()
        canonical = json.dumps(digest, sort_keys=True, separators=(",", ":"))
        sig = hmac.new(
            secret.encode(), f"{secret}:{canonical}".encode(), hashlib.sha256
        ).hexdigest()
        _verify_signature(digest, sig, secret)  # must not raise

    def test_invalid_hmac_raises_403(self) -> None:
        from fastapi import HTTPException
        digest = self._fresh_digest()
        with pytest.raises(HTTPException) as exc_info:
            _verify_signature(digest, "badhash", "secret")
        assert exc_info.value.status_code == 403

    def test_stale_checked_before_hmac(self) -> None:
        """A stale digest must raise 401 even if HMAC would be valid."""
        from fastapi import HTTPException
        secret = "testsecret"
        digest = self._fresh_digest(offset_s=-400)
        canonical = json.dumps(digest, sort_keys=True, separators=(",", ":"))
        sig = hmac.new(
            secret.encode(), f"{secret}:{canonical}".encode(), hashlib.sha256
        ).hexdigest()
        with pytest.raises(HTTPException) as exc_info:
            _verify_signature(digest, sig, secret)
        assert exc_info.value.status_code == 401

    def test_stale_checked_before_ph_bypass(self) -> None:
        """A stale digest must raise 401 even for ph: placeholder signatures."""
        from fastapi import HTTPException
        digest = self._fresh_digest(offset_s=-400)
        with pytest.raises(HTTPException) as exc_info:
            _verify_signature(digest, "ph:sprint1", "secret")
        assert exc_info.value.status_code == 401


# ─── _validate_plausibility ───────────────────────────────────────────────────

class TestValidatePlausibility:
    def _make(self, **kwargs) -> SaveTripIn:
        return SaveTripIn(**kwargs)

    def test_negative_hard_brakes_rejected(self) -> None:
        from fastapi import HTTPException
        dto = self._make(hard_brakes=-1)
        with pytest.raises(HTTPException) as exc_info:
            _validate_plausibility(dto)
        assert exc_info.value.status_code == 422

    def test_negative_aggressive_accels_rejected(self) -> None:
        from fastapi import HTTPException
        dto = self._make(aggressive_accels=-1)
        with pytest.raises(HTTPException) as exc_info:
            _validate_plausibility(dto)
        assert exc_info.value.status_code == 422

    def test_negative_sharp_turns_rejected(self) -> None:
        from fastapi import HTTPException
        dto = self._make(sharp_turns=-1)
        with pytest.raises(HTTPException) as exc_info:
            _validate_plausibility(dto)
        assert exc_info.value.status_code == 422

    def test_negative_phone_seconds_rejected(self) -> None:
        from fastapi import HTTPException
        dto = self._make(phone_seconds=-1)
        with pytest.raises(HTTPException) as exc_info:
            _validate_plausibility(dto)
        assert exc_info.value.status_code == 422

    def test_negative_distance_rejected(self) -> None:
        from fastapi import HTTPException
        dto = self._make(distance_km=-1.0)
        with pytest.raises(HTTPException) as exc_info:
            _validate_plausibility(dto)
        assert exc_info.value.status_code == 422

    def test_zero_values_pass(self) -> None:
        dto = self._make(hard_brakes=0, aggressive_accels=0, sharp_turns=0, phone_seconds=0, distance_km=0.0)
        _validate_plausibility(dto)  # must not raise

    def test_client_points_skip_when_digest_present(self) -> None:
        dto = self._make(points=999_999, telemetry_digest={"distanceKm": 5.0})
        _validate_plausibility(dto)  # must not raise — oracle overrides

    def test_client_points_checked_without_digest(self) -> None:
        from fastapi import HTTPException
        dto = self._make(points=999_999, telemetry_digest=None)
        with pytest.raises(HTTPException) as exc_info:
            _validate_plausibility(dto)
        assert exc_info.value.status_code == 422

    def test_avg_score_out_of_range_rejected(self) -> None:
        from fastapi import HTTPException
        dto = self._make(avg_score=101.0)
        with pytest.raises(HTTPException) as exc_info:
            _validate_plausibility(dto)
        assert exc_info.value.status_code == 422

    def test_implausible_speed_rejected(self) -> None:
        from fastapi import HTTPException
        dto = self._make(distance_km=300.0, duration_seconds=60)
        with pytest.raises(HTTPException) as exc_info:
            _validate_plausibility(dto)
        assert exc_info.value.status_code == 422

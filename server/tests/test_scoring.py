"""
Cross-language parity tests for server/app/services/scoring.py.
Each vector must produce identical outputs to mobile/src/lib/scoring.ts.
Dates use fixed January-2026 values (Jan 5=Mon … Jan 10=Sat, verified against
the same anchor used in the TypeScript test suite).
"""
from datetime import datetime, timezone

import pytest

from app.services.scoring import calculate_score, get_risk_multiplier


def _dt(year: int, month: int, day: int, hour: int, minute: int = 0) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=timezone.utc)


# ─── get_risk_multiplier ──────────────────────────────────────────────────────

class TestGetRiskMultiplier:
    def test_daytime_any_day(self):
        assert get_risk_multiplier(_dt(2026, 1, 6, 14)) == 1.0   # Tue 14:00
        assert get_risk_multiplier(_dt(2026, 1, 8, 14)) == 1.0   # Thu 14:00
        assert get_risk_multiplier(_dt(2026, 1, 10, 10)) == 1.0  # Sat 10:00

    def test_night_boundary_04_not_night(self):
        assert get_risk_multiplier(_dt(2026, 1, 5, 4)) == 1.0    # Mon 04:00 — boundary, not night

    def test_weekday_night_returns_1_5(self):
        assert get_risk_multiplier(_dt(2026, 1, 5, 23)) == 1.5   # Mon 23:00
        assert get_risk_multiplier(_dt(2026, 1, 6, 1)) == 1.5    # Tue 01:00
        assert get_risk_multiplier(_dt(2026, 1, 11, 23)) == 1.5  # Sun 23:00

    def test_weekend_night_thu_returns_2_0(self):
        assert get_risk_multiplier(_dt(2026, 1, 8, 23)) == 2.0   # Thu 23:00

    def test_weekend_night_fri_returns_2_0(self):
        assert get_risk_multiplier(_dt(2026, 1, 9, 1)) == 2.0    # Fri 01:00

    def test_weekend_night_sat_returns_2_0(self):
        assert get_risk_multiplier(_dt(2026, 1, 10, 23)) == 2.0  # Sat 23:00


# ─── calculate_score parity vectors ──────────────────────────────────────────
# Inputs and expected outputs must match mobile/src/lib/scoring.ts exactly.
# Vector 3 uses phone_seconds=900 (full-session phone use) to demonstrate the
# score=0 floor; the RFC §8.3 table phoneSec column had a transcription error.

class TestCalculateScoreParity:
    def test_vector1_perfect_score_daytime_15km(self):
        """0 events, 1800s, 15km, Tue 14:00 → rm=1.0, score=100.0, points=115.6"""
        score, points, rm = calculate_score(
            hard_brakes=0, aggressive_accels=0, sharp_turns=0,
            phone_seconds=0, duration_seconds=1800, distance_km=15.0,
            start_time=_dt(2026, 1, 6, 14),  # Tue 14:00
        )
        assert rm == 1.0
        assert score == 100.0
        assert points == 115.6

    def test_vector2_mixed_penalties_daytime_5km(self):
        """3 HB, 2 AA, 1 ST, 60 phone/600s, 5km, Mon 10:00 → score=73.0, points=54.5
        Note: 73 × ln(6)/ln(11) × 1.0 = 54.550… → IEEE 754 rounds to 54.5."""
        score, points, rm = calculate_score(
            hard_brakes=3, aggressive_accels=2, sharp_turns=1,
            phone_seconds=60, duration_seconds=600, distance_km=5.0,
            start_time=_dt(2026, 1, 5, 10),  # Mon 10:00
        )
        assert rm == 1.0
        assert score == 73.0
        assert points == 54.5

    def test_vector3_score_floor_weekend_night(self):
        """10 HB, 5 AA, 3 ST, 900 phone/900s, 8km, Fri 23:30 → penalties>100 → score=0"""
        score, points, rm = calculate_score(
            hard_brakes=10, aggressive_accels=5, sharp_turns=3,
            phone_seconds=900, duration_seconds=900, distance_km=8.0,
            start_time=_dt(2026, 1, 9, 23, 30),  # Fri 23:30
        )
        assert rm == 2.0
        assert score == 0.0
        assert points == 0.0

    def test_vector4_light_penalty_thu_night_50km(self):
        """1 HB, 50km, Thu 23:00 → rm=2.0, score=95.0, points=311.5"""
        score, points, rm = calculate_score(
            hard_brakes=1, aggressive_accels=0, sharp_turns=0,
            phone_seconds=0, duration_seconds=3600, distance_km=50.0,
            start_time=_dt(2026, 1, 8, 23),  # Thu 23:00
        )
        assert rm == 2.0
        assert score == 95.0
        assert points == 311.5

    def test_vector5_phone_penalty_sat_night_12km(self):
        """0 events, 120 phone/1200s, 12km, Sat 01:00 → rm=2.0, score=96.0, points=205.4"""
        score, points, rm = calculate_score(
            hard_brakes=0, aggressive_accels=0, sharp_turns=0,
            phone_seconds=120, duration_seconds=1200, distance_km=12.0,
            start_time=_dt(2026, 1, 10, 1),  # Sat 01:00
        )
        assert rm == 2.0
        assert score == 96.0
        assert points == 205.4


# ─── edge cases ───────────────────────────────────────────────────────────────

class TestCalculateScoreEdgeCases:
    def test_zero_duration_no_division_error(self):
        score, points, rm = calculate_score(
            hard_brakes=0, aggressive_accels=0, sharp_turns=0,
            phone_seconds=0, duration_seconds=0, distance_km=5.0,
            start_time=_dt(2026, 1, 6, 12),
        )
        assert score == 100.0
        assert not (score != score)  # not NaN

    def test_zero_distance_gives_zero_points(self):
        score, points, rm = calculate_score(
            hard_brakes=0, aggressive_accels=0, sharp_turns=0,
            phone_seconds=0, duration_seconds=600, distance_km=0.0,
            start_time=_dt(2026, 1, 6, 12),
        )
        assert score == 100.0
        assert points == 0.0

    def test_score_clamped_to_100_max(self):
        score, _, _ = calculate_score(
            hard_brakes=0, aggressive_accels=0, sharp_turns=0,
            phone_seconds=0, duration_seconds=600, distance_km=5.0,
            start_time=_dt(2026, 1, 6, 12),
        )
        assert score <= 100.0

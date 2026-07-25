"""
Cross-language parity tests for server/app/services/risk.py.
Each vector must produce the same result as the mobile client's copy of the
multiplier, which is sent up on every trip save.
Dates use fixed January-2026 values (Jan 5=Mon … Jan 10=Sat, verified against
the same anchor used in the TypeScript test suite).

The v1 `calculate_score` parity vectors that used to live below were deleted
with the function itself (#53) — their counterpart in mobile/src/lib/scoring.ts
had already gone in #49, so they were asserting parity between two dead
implementations.
"""

from datetime import UTC, datetime

from app.services.risk import get_risk_multiplier


def _dt(year: int, month: int, day: int, hour: int, minute: int = 0) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=UTC)


# ─── get_risk_multiplier ──────────────────────────────────────────────────────


class TestGetRiskMultiplier:
    def test_daytime_any_day(self):
        assert get_risk_multiplier(_dt(2026, 1, 6, 14)) == 1.0  # Tue 14:00
        assert get_risk_multiplier(_dt(2026, 1, 8, 14)) == 1.0  # Thu 14:00
        assert get_risk_multiplier(_dt(2026, 1, 10, 10)) == 1.0  # Sat 10:00

    def test_night_boundary_04_not_night(self):
        assert get_risk_multiplier(_dt(2026, 1, 5, 4)) == 1.0  # Mon 04:00 — boundary, not night

    def test_weekday_night_returns_1_5(self):
        assert get_risk_multiplier(_dt(2026, 1, 5, 23)) == 1.5  # Mon 23:00
        assert get_risk_multiplier(_dt(2026, 1, 6, 1)) == 1.5  # Tue 01:00
        assert get_risk_multiplier(_dt(2026, 1, 11, 23)) == 1.5  # Sun 23:00

    def test_weekend_night_thu_returns_2_0(self):
        assert get_risk_multiplier(_dt(2026, 1, 8, 23)) == 2.0  # Thu 23:00

    def test_weekend_night_fri_returns_2_0(self):
        assert get_risk_multiplier(_dt(2026, 1, 9, 1)) == 2.0  # Fri 01:00

    def test_weekend_night_sat_returns_2_0(self):
        assert get_risk_multiplier(_dt(2026, 1, 10, 21)) == 2.0  # Sat 23:00 Israel (21:00 UTC+2)


# ─── Timezone: UTC input → Israel local ───────────────────────────────────────
# Moved here from the old test_scoring_oracle.py, where they reached the
# multiplier through calculate_score. They test this module, not that one.


class TestTimezoneConversion:
    def test_utc_21_thursday_is_weekend_night_in_israel(self):
        # Thu 21:00 UTC = Thu 23:00 Israel (UTC+2) → weekend night → 2.0.
        # Without the conversion, UTC hour=21 would read as daytime (1.0).
        assert get_risk_multiplier(datetime(2026, 1, 8, 21, tzinfo=UTC)) == 2.0

    def test_utc_midnight_friday_is_night_in_israel(self):
        # Fri 00:00 UTC = Fri 02:00 IL → night + Fri → 2.0
        assert get_risk_multiplier(datetime(2026, 1, 9, 0, tzinfo=UTC)) == 2.0

    def test_utc_22_thursday_crosses_to_friday_midnight_in_israel(self):
        # Thu 22:00 UTC = Fri 00:00 IL → night + Fri → 2.0
        assert get_risk_multiplier(datetime(2026, 1, 8, 22, tzinfo=UTC)) == 2.0

    def test_naive_datetime_is_read_as_israel_local(self):
        # No tzinfo → treated as already-local rather than UTC.
        assert get_risk_multiplier(datetime(2026, 1, 8, 23)) == 2.0

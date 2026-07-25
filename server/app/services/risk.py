"""Time-of-day risk multiplier.

All that survives of the v1 scoring engine (retired in `a1a5e73`, the rest
deleted in #53). `scoring_v2` is the authoritative scoring engine; this factor
is orthogonal to it — it scales *points*, not the score, because when you drove
is a property of exposure rather than of how you drove.

The mobile client ships its own copy and sends the result up on every trip save,
so the two implementations must stay in parity. See `tests/test_risk.py`.
"""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

_TZ_IL = ZoneInfo("Asia/Jerusalem")


def get_risk_multiplier(start_time: datetime) -> float:
    local = start_time.astimezone(_TZ_IL) if start_time.tzinfo else start_time.replace(tzinfo=_TZ_IL)
    hour = local.hour
    weekday = local.weekday()  # Mon=0 … Thu=3, Fri=4, Sat=5, Sun=6
    is_night = hour >= 23 or hour < 4
    if not is_night:
        return 1.0
    is_weekend_night = weekday in (3, 4, 5)  # Thu, Fri, Sat (Israeli weekend)
    return 2.0 if is_weekend_night else 1.5

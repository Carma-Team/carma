from __future__ import annotations

import math
from datetime import datetime


def get_risk_multiplier(start_time: datetime) -> float:
    hour = start_time.hour
    weekday = start_time.weekday()  # Mon=0 … Thu=3, Fri=4, Sat=5, Sun=6
    is_night = hour >= 23 or hour < 4
    if not is_night:
        return 1.0
    is_weekend_night = weekday in (3, 4, 5)  # Thu, Fri, Sat (Israeli weekend)
    return 2.0 if is_weekend_night else 1.5


def calculate_score(
    hard_brakes: int,
    aggressive_accels: int,
    sharp_turns: int,
    touch_epochs: int,
    screen_interaction_seconds: int,
    duration_seconds: int,
    distance_km: float,
    start_time: datetime,
) -> tuple[float, float, float]:
    """Returns (score, points, risk_multiplier). Both score and points rounded to 1 decimal."""
    safe_duration = max(duration_seconds, 1)
    penalties = (
        hard_brakes * 5
        + aggressive_accels * 3
        + sharp_turns * 2
        + touch_epochs * 4
        + (screen_interaction_seconds / safe_duration) * 40
    )
    score = max(0.0, min(100.0, 100.0 - penalties))
    distance_factor = math.log(distance_km + 1) / math.log(11)
    risk_multiplier = get_risk_multiplier(start_time)
    points = score * distance_factor * risk_multiplier
    return round(score * 10) / 10, round(points * 10) / 10, risk_multiplier

from __future__ import annotations

from app.schemas._base import CamelModel


class RecentScore(CamelModel):
    date: str
    score: float


class EventCounts(CamelModel):
    hard_brakes: int
    aggressive_accels: int
    sharp_turns: int
    touch_epochs: int


class DrivingStats(CamelModel):
    total_trips: int
    total_distance: float
    total_points: int
    average_score: int
    safe_trips_count: int
    total_duration_seconds: int
    # Days in a row of good driving, and the driver's own record (scoring.md
    # "Streaks"). Both count days, not trips, and neither is worth any points.
    current_streak: int
    best_streak: int
    recent_scores: list[RecentScore]
    event_counts: EventCounts


class StatsOut(CamelModel):
    stats: DrivingStats

from __future__ import annotations

from app.schemas._base import CamelModel


class RecentScore(CamelModel):
    date: str
    score: float


class EventCounts(CamelModel):
    hard_brakes: int
    aggressive_accels: int
    sharp_turns: int
    phone_seconds: int


class DrivingStats(CamelModel):
    total_trips: int
    total_distance: float
    total_points: int
    average_score: int
    safe_trips_count: int
    total_duration_seconds: int
    recent_scores: list[RecentScore]
    event_counts: EventCounts


class StatsOut(CamelModel):
    stats: DrivingStats

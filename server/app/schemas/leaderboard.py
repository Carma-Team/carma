from __future__ import annotations

from typing import Literal

from app.schemas._base import CamelModel


class LeaderboardUserSummary(CamelModel):
    id: str
    name: str | None
    city: str | None
    level: int
    avatar_url: str | None


class LeaderboardEntry(CamelModel):
    id: str
    user_id: str
    rank: int
    score: int
    user: LeaderboardUserSummary


class LeaderboardOut(CamelModel):
    entries: list[LeaderboardEntry]
    current_user_id: str


LeaderboardType = Literal["national", "city", "friends"]

from __future__ import annotations

from datetime import datetime
from typing import Literal

from app.schemas._base import CamelModel

FollowStatus = Literal["none", "pending", "accepted", "blocked"]
LeaderboardType = Literal["national", "city", "friends"]


class LeaderboardUserSummary(CamelModel):
    id: str
    name: str | None
    city: str | None
    level: int
    avatar_url: str | None
    is_private: bool = False


class LeaderboardEntry(CamelModel):
    id: str
    user_id: str
    rank: int
    score: int
    user: LeaderboardUserSummary
    follow_status: FollowStatus = "none"


class LeaderboardOut(CamelModel):
    entries: list[LeaderboardEntry]
    current_user_id: str
    my_rank: int | None = None


class FollowRequestOut(CamelModel):
    follower_id: str
    follower_name: str | None
    follower_level: int
    follower_city: str | None
    requested_at: datetime


class FollowStatusOut(CamelModel):
    status: FollowStatus

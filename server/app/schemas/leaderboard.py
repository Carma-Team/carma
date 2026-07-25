from __future__ import annotations

from typing import Literal

from app.schemas._base import CamelModel
from app.schemas.friend import FriendshipStatus

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
    # Wire name kept as `followStatus` for the mobile client; the value is the
    # friendship status from the viewer toward this row's user.
    follow_status: FriendshipStatus = "none"


class LeaderboardOut(CamelModel):
    entries: list[LeaderboardEntry]
    current_user_id: str
    my_rank: int | None = None

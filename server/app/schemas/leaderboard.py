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
    # Lifetime kilometres, covering the same window as `score` (lifetime points),
    # so the client's points-per-km divides two figures over the same period.
    # Narrowing either one to a rolling window silently skews the ratio.
    distance_km: float
    user: LeaderboardUserSummary
    # Wire name kept as `followStatus` for the mobile client; the value is the
    # friendship status from the viewer toward this row's user.
    follow_status: FriendshipStatus = "none"


class LeaderboardOut(CamelModel):
    entries: list[LeaderboardEntry]
    current_user_id: str
    my_rank: int | None = None


class LocationsOut(CamelModel):
    """Filter options for the leaderboard's city picker.

    Shaped as countries + cities-per-country because the client was written
    against a mock server that had both. CARMA operates in one country, so
    `countries` is a single fixed entry — see leaderboard.COUNTRY.
    """

    countries: list[str]
    cities_by_country: dict[str, list[str]]

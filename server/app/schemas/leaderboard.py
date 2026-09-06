from __future__ import annotations

from typing import Literal

from app.schemas._base import CamelModel
from app.schemas.city import CityOut, CountryOut
from app.schemas.friend import FriendshipStatus

LeaderboardType = Literal["national", "city", "friends"]


class LeaderboardUserSummary(CamelModel):
    id: str
    name: str | None
    city: CityOut | None
    level: int
    avatar_url: str | None
    is_private: bool = False


class LeaderboardEntry(CamelModel):
    id: str
    user_id: str
    rank: int
    score: int
    # Lifetime kilometres, from the users.total_distance accumulator — which
    # counts a trip the moment it is saved, so it runs ahead of the COMPLETED-only
    # sum behind `GET /api/users/:id/stats`. The two answer differently for a
    # driver mid-trip; do not treat either as the other.
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

    Only cities that actually have a driver on the board, so a filter choice can
    never come back empty. That is the difference from `GET /api/cities`, which
    serves the whole canonical list for registration to pick from.

    The old countries + cities-per-country shape is gone with CAR-218: it came
    from a retired mock server, and its values were bare labels that could only
    be right in one language.
    """

    country: CountryOut
    cities: list[CityOut]

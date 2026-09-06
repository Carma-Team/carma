from __future__ import annotations

from datetime import datetime
from typing import Literal

from app.schemas._base import CamelModel
from app.schemas.city import CityOut

# Relationship between the caller and another user, from the caller's side.
#   none     – no edge
#   pending  – a friend request is open in one direction or the other
#   accepted – friends (mutual)
#   blocked  – one of the two blocked the other
FriendshipStatus = Literal["none", "pending", "accepted", "blocked"]


class FriendRequestOut(CamelModel):
    """One incoming friend request, addressed by the `user_friends` row id."""

    id: str
    from_user_id: str
    from_user_name: str | None
    from_user_level: int
    from_user_city: CityOut | None
    created_at: datetime


class FriendRequestsOut(CamelModel):
    requests: list[FriendRequestOut]


class FriendStatusOut(CamelModel):
    status: FriendshipStatus

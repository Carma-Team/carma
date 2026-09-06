from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Query

from app.core.deps import CurrentUser, DbSession
from app.schemas.leaderboard import LeaderboardOut, LocationsOut
from app.services import leaderboard as svc

router = APIRouter(prefix="/api/leaderboard", tags=["leaderboard"])


@router.get(
    "",
    response_model=LeaderboardOut,
    response_model_by_alias=True,
    summary="Leaderboard ranked by total_points. Friends tab = accepted friendships only.",
)
async def get_leaderboard(
    user: CurrentUser,
    db: DbSession,
    type: Literal["national", "city", "friends"] = "national",
    city_code: Annotated[
        str | None,
        Query(
            alias="cityCode",
            max_length=10,
            description="A CBS settlement code. Only with type=city. Defaults to the caller's own city.",
        ),
    ] = None,
) -> LeaderboardOut:
    # The client also sends `country`; it is deliberately not a parameter here.
    # CARMA is single-country, so the value can only ever be one thing —
    # declaring it would advertise a filter that does not exist.
    return await svc.get(db, user, type, city_code)


# Declared after the bare path so it cannot shadow it.
@router.get(
    "/locations",
    response_model=LocationsOut,
    response_model_by_alias=True,
    summary="Cities that have a driver on the board. The whole canonical list is GET /api/cities.",
)
async def get_locations(user: CurrentUser, db: DbSession) -> LocationsOut:
    return await svc.locations(db)

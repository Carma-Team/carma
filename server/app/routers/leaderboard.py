from __future__ import annotations

from typing import Literal

from fastapi import APIRouter

from app.core.deps import CurrentUser, DbSession
from app.schemas.leaderboard import LeaderboardOut
from app.services import leaderboard as leaderboard_service

router = APIRouter(prefix="/api/leaderboard", tags=["leaderboard"])


@router.get("", response_model=LeaderboardOut, response_model_by_alias=True,
            summary="Leaderboard ranked by total points")
async def get_leaderboard(
    user: CurrentUser,
    db: DbSession,
    type: Literal["national", "city", "friends"] = "national",
) -> LeaderboardOut:
    return await leaderboard_service.get(db, user, type)

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter

from app.core.deps import CurrentUser, DbSession
from app.schemas.leaderboard import FollowRequestOut, FollowStatusOut, LeaderboardOut
from app.services import leaderboard as svc

router = APIRouter(prefix="/api/leaderboard", tags=["leaderboard"])


@router.get(
    "",
    response_model=LeaderboardOut,
    response_model_by_alias=True,
    summary="Leaderboard ranked by total_points. Friends tab = accepted follows only.",
)
async def get_leaderboard(
    user: CurrentUser,
    db: DbSession,
    type: Literal["national", "city", "friends"] = "national",
) -> LeaderboardOut:
    return await svc.get(db, user, type)


# ── Follow / Unfollow ─────────────────────────────────────────────────────────

@router.get(
    "/follow/{target_id}",
    response_model=FollowStatusOut,
    response_model_by_alias=True,
    summary="Get current follow status toward a user",
)
async def get_follow_status(target_id: str, user: CurrentUser, db: DbSession) -> FollowStatusOut:
    return await svc.get_follow_status(db, user, target_id)


@router.post(
    "/follow/{target_id}",
    response_model=FollowStatusOut,
    response_model_by_alias=True,
    summary="Follow a driver. Public → accepted instantly. Private → pending until accepted.",
)
async def follow_user(target_id: str, user: CurrentUser, db: DbSession) -> FollowStatusOut:
    return await svc.follow(db, user, target_id)


@router.delete(
    "/follow/{target_id}",
    response_model=FollowStatusOut,
    response_model_by_alias=True,
    summary="Unfollow or cancel a pending follow request",
)
async def unfollow_user(target_id: str, user: CurrentUser, db: DbSession) -> FollowStatusOut:
    return await svc.unfollow(db, user, target_id)


# ── Incoming follow requests (for private accounts) ───────────────────────────

@router.get(
    "/requests",
    response_model=list[FollowRequestOut],
    response_model_by_alias=True,
    summary="List pending follow requests for the authenticated user's private account",
)
async def list_requests(user: CurrentUser, db: DbSession) -> list[FollowRequestOut]:
    return await svc.incoming_requests(db, user)


@router.post(
    "/requests/{follower_id}/accept",
    response_model=FollowStatusOut,
    response_model_by_alias=True,
    summary="Accept a pending follow request",
)
async def accept_request(follower_id: str, user: CurrentUser, db: DbSession) -> FollowStatusOut:
    return await svc.accept_request(db, user, follower_id)


@router.delete(
    "/requests/{follower_id}",
    response_model=FollowStatusOut,
    response_model_by_alias=True,
    summary="Reject / remove a pending follow request",
)
async def reject_request(follower_id: str, user: CurrentUser, db: DbSession) -> FollowStatusOut:
    return await svc.reject_request(db, user, follower_id)


# ── Block / Unblock ───────────────────────────────────────────────────────────

@router.post(
    "/block/{target_id}",
    response_model=FollowStatusOut,
    response_model_by_alias=True,
    summary="Block a user. Removes their follow and prevents re-following.",
)
async def block_user(target_id: str, user: CurrentUser, db: DbSession) -> FollowStatusOut:
    return await svc.block_user(db, user, target_id)


@router.delete(
    "/block/{target_id}",
    response_model=FollowStatusOut,
    response_model_by_alias=True,
    summary="Unblock a previously blocked user",
)
async def unblock_user(target_id: str, user: CurrentUser, db: DbSession) -> FollowStatusOut:
    return await svc.unblock_user(db, user, target_id)

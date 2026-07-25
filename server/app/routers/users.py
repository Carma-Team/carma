from __future__ import annotations

from fastapi import APIRouter, Query, Response, status

from app.core.deps import CurrentUser, DbSession
from app.schemas.stats import StatsOut
from app.schemas.user import (
    FoundUserOut,
    MatchContactsIn,
    MatchContactsOut,
    UpdateLocationIn,
    UpdateProfileIn,
    UserOut,
    UserSearchOut,
)
from app.services import users as users_service

# Plural namespace for profile management.
router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("/me", response_model=UserOut, response_model_by_alias=True, summary="Get the authenticated user profile")
async def me(user: CurrentUser) -> UserOut:
    return UserOut.model_validate(user)


@router.patch("/me", response_model=UserOut, response_model_by_alias=True, summary="Update profile fields")
async def update_profile(dto: UpdateProfileIn, user: CurrentUser, db: DbSession) -> UserOut:
    updated = await users_service.update_profile(db, user, dto)
    return UserOut.model_validate(updated)


@router.put(
    "/me/location", response_model=UserOut, response_model_by_alias=True, summary="Update last known driver location"
)
async def update_location(dto: UpdateLocationIn, user: CurrentUser, db: DbSession) -> UserOut:
    updated = await users_service.update_location(db, user, dto)
    return UserOut.model_validate(updated)


@router.get(
    "/search",
    response_model=UserSearchOut,
    response_model_by_alias=True,
    summary="Find a driver by phone number, to send them a friend request",
)
async def search(user: CurrentUser, db: DbSession, phone: str = Query(min_length=6, max_length=20)) -> UserSearchOut:
    found = await users_service.search_by_phone(db, user, phone)
    return UserSearchOut(user=FoundUserOut.model_validate(found))


@router.post(
    "/match-contacts",
    response_model=MatchContactsOut,
    response_model_by_alias=True,
    summary="Which of the caller's contacts are CARMA drivers (hashed phone numbers)",
)
async def match_contacts(dto: MatchContactsIn, user: CurrentUser, db: DbSession) -> MatchContactsOut:
    return await users_service.match_contacts(db, user, dto.phone_hashes)


@router.delete(
    "/me",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Delete the authenticated user account (GDPR right to be forgotten)",
)
async def delete_me(user: CurrentUser, db: DbSession) -> Response:
    await users_service.delete_account(db, user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# Singular `/api/user/stats` is its own router because May's client uses that exact path.
stats_router = APIRouter(prefix="/api/user", tags=["user"])


@stats_router.get(
    "/stats",
    response_model=StatsOut,
    response_model_by_alias=True,
    summary="Aggregate driving stats for the authenticated user",
)
async def stats(user: CurrentUser, db: DbSession) -> StatsOut:
    return await users_service.stats(db, user.id)

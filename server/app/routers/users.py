from __future__ import annotations

from fastapi import APIRouter, status

from app.core.deps import CurrentUser, DbSession
from app.schemas.stats import StatsOut
from app.schemas.user import UpdateLocationIn, UpdateProfileIn, UserOut
from app.services import users as users_service

# Plural namespace for profile management.
router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("/me", response_model=UserOut, response_model_by_alias=True,
            summary="Get the authenticated user profile")
async def me(user: CurrentUser) -> UserOut:
    return UserOut.model_validate(user)


@router.patch("/me", response_model=UserOut, response_model_by_alias=True,
              summary="Update profile fields")
async def update_profile(dto: UpdateProfileIn, user: CurrentUser, db: DbSession) -> UserOut:
    updated = await users_service.update_profile(db, user, dto)
    return UserOut.model_validate(updated)


@router.put("/me/location", response_model=UserOut, response_model_by_alias=True,
            summary="Update last known driver location")
async def update_location(dto: UpdateLocationIn, user: CurrentUser, db: DbSession) -> UserOut:
    updated = await users_service.update_location(db, user, dto)
    return UserOut.model_validate(updated)


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT,
               summary="Delete the authenticated user account (GDPR right to be forgotten)")
async def delete_me(user: CurrentUser, db: DbSession) -> None:
    await users_service.delete_account(db, user)


# Singular `/api/user/stats` is its own router because May's client uses that exact path.
stats_router = APIRouter(prefix="/api/user", tags=["user"])


@stats_router.get("/stats", response_model=StatsOut, response_model_by_alias=True,
                  summary="Aggregate driving stats for the authenticated user")
async def stats(user: CurrentUser, db: DbSession) -> StatsOut:
    return await users_service.stats(db, user.id)

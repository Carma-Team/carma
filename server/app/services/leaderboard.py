from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import ColumnElement

from app.models import City, User, UserRole
from app.schemas.city import CityOut
from app.schemas.friend import FriendshipStatus
from app.schemas.leaderboard import (
    LeaderboardEntry,
    LeaderboardOut,
    LeaderboardType,
    LeaderboardUserSummary,
    LocationsOut,
)
from app.services import friends
from app.services.cities import COUNTRY


async def locations(db: AsyncSession) -> LocationsOut:
    """Cities that actually have a driver on the board, for the filter picker.

    Drawn from the same population the board itself shows, so picking a listed
    city can never come back empty. `GET /api/cities` is the other list: the
    whole canonical register, for registration to pick from.
    """
    rows = (
        await db.scalars(
            select(City)
            .join(User, User.city_code == City.code)
            .where(User.role == UserRole.DRIVER, User.is_private.is_(False))
            .distinct()
            .order_by(City.name_he)
        )
    ).all()
    return LocationsOut(country=COUNTRY, cities=[CityOut.from_orm_city(c) for c in rows])


async def get(db: AsyncSession, current: User, type_: LeaderboardType, city_code: str | None = None) -> LeaderboardOut:
    if type_ == "friends":
        # Everyone the user is actually friends with, plus themselves for context.
        ids = await friends.friend_ids(db, current.id)
        statuses: dict[str, FriendshipStatus] = {uid: "accepted" for uid in ids}
        users = (
            await db.scalars(
                select(User)
                .where(User.role == UserRole.DRIVER, User.id.in_(ids | {current.id}))
                .order_by(User.total_points.desc(), User.created_at.asc())
                .limit(100)
            )
        ).all()
    else:
        board_where: list[ColumnElement[bool]] = [User.role == UserRole.DRIVER, User.is_private.is_(False)]
        if type_ == "city":
            # An explicit ?city= wins, so the picker actually moves the board;
            # without one the caller's own city is still the sensible default.
            target_city = city_code or current.city_code
            if target_city:
                board_where.append(User.city_code == target_city)
        users = (
            await db.scalars(
                select(User).where(*board_where).order_by(User.total_points.desc(), User.created_at.asc()).limit(100)
            )
        ).all()
        statuses = await friends.status_map(db, current.id, [u.id for u in users])

    entries = [
        LeaderboardEntry(
            id=f"entry-{u.id}",
            user_id=u.id,
            rank=idx + 1,
            score=u.total_points,
            # Settled to metres, as telemetry.py does: the accumulator is built by
            # repeated float addition, so it drifts to 596.2000000000003.
            distance_km=round(u.total_distance, 3),
            follow_status=statuses.get(u.id, "none"),
            user=LeaderboardUserSummary(
                id=u.id,
                name=u.name,
                city=CityOut.from_orm_city(u.city) if u.city else None,
                level=u.level,
                avatar_url=u.avatar_url,
                is_private=u.is_private,
            ),
        )
        for idx, u in enumerate(users)
    ]

    # If current user didn't land in the visible window, compute their absolute
    # rank — against the same population the board was drawn from, so a city
    # board never answers with a national rank.
    my_rank: int | None = None
    if not any(u.id == current.id for u in users) and type_ != "friends":
        above = await db.scalar(
            select(func.count()).select_from(User).where(*board_where, User.total_points > current.total_points)
        )
        my_rank = (above or 0) + 1

    return LeaderboardOut(entries=entries, current_user_id=current.id, my_rank=my_rank)

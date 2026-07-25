from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User, UserRole
from app.schemas.friend import FriendshipStatus
from app.schemas.leaderboard import (
    LeaderboardEntry,
    LeaderboardOut,
    LeaderboardType,
    LeaderboardUserSummary,
)
from app.services import friends


async def get(db: AsyncSession, current: User, type_: LeaderboardType) -> LeaderboardOut:
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
        stmt = select(User).where(User.role == UserRole.DRIVER, User.is_private.is_(False))
        if type_ == "city" and current.city:
            stmt = stmt.where(User.city == current.city)
        users = (await db.scalars(stmt.order_by(User.total_points.desc(), User.created_at.asc()).limit(100))).all()
        statuses = await friends.status_map(db, current.id, [u.id for u in users])

    entries = [
        LeaderboardEntry(
            id=f"entry-{u.id}",
            user_id=u.id,
            rank=idx + 1,
            score=u.total_points,
            follow_status=statuses.get(u.id, "none"),
            user=LeaderboardUserSummary(
                id=u.id,
                name=u.name,
                city=u.city,
                level=u.level,
                avatar_url=u.avatar_url,
                is_private=u.is_private,
            ),
        )
        for idx, u in enumerate(users)
    ]

    # If current user didn't land in the visible window, compute their absolute rank.
    my_rank: int | None = None
    if not any(u.id == current.id for u in users) and type_ != "friends":
        above = await db.scalar(
            select(func.count())
            .select_from(User)
            .where(
                User.role == UserRole.DRIVER,
                User.is_private.is_(False),
                User.total_points > current.total_points,
            )
        )
        my_rank = (above or 0) + 1

    return LeaderboardOut(entries=entries, current_user_id=current.id, my_rank=my_rank)

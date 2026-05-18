from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User, UserRole
from app.schemas.leaderboard import LeaderboardEntry, LeaderboardOut, LeaderboardType, LeaderboardUserSummary


async def get(db: AsyncSession, current: User, type_: LeaderboardType) -> LeaderboardOut:
    stmt = select(User).where(User.role == UserRole.DRIVER)
    if type_ == "city" and current.city:
        stmt = stmt.where(User.city == current.city)
    elif type_ == "friends":
        # friend graph not modelled — return only self until implemented
        stmt = stmt.where(User.id == current.id)

    users = (await db.scalars(stmt.order_by(User.total_points.desc()).limit(100))).all()
    entries = [
        LeaderboardEntry(
            id=f"entry-{u.id}",
            user_id=u.id,
            rank=idx + 1,
            score=u.total_points,
            user=LeaderboardUserSummary(id=u.id, name=u.name, city=u.city, level=u.level, avatar_url=u.avatar_url),
        )
        for idx, u in enumerate(users)
    ]
    return LeaderboardOut(entries=entries, current_user_id=current.id)

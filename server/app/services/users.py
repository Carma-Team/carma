from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Trip, TripStatus, User
from app.schemas.stats import DrivingStats, EventCounts, RecentScore, StatsOut
from app.schemas.user import UpdateLocationIn, UpdateProfileIn


async def update_profile(db: AsyncSession, user: User, dto: UpdateProfileIn) -> User:
    for field, value in dto.model_dump(exclude_unset=True).items():
        setattr(user, field, value)
    await db.commit()
    await db.refresh(user)
    return user


async def update_location(db: AsyncSession, user: User, dto: UpdateLocationIn) -> User:
    user.last_lat = dto.lat
    user.last_lng = dto.lng
    user.last_location_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(user)
    return user


async def delete_account(db: AsyncSession, user: User) -> None:
    await db.delete(user)
    await db.commit()


async def stats(db: AsyncSession, user_id: str) -> StatsOut:
    completed = (
        select(Trip)
        .where(Trip.user_id == user_id, Trip.status == TripStatus.COMPLETED)
    )

    recent_rows = (await db.scalars(completed.order_by(Trip.start_time.desc()).limit(14))).all()
    recent_scores = [
        RecentScore(date=t.start_time.date().isoformat(), score=t.avg_score or 0.0)
        for t in reversed(recent_rows)
    ]

    agg = (await db.execute(
        select(
            func.count(Trip.id),
            func.coalesce(func.sum(Trip.distance_km), 0.0),
            func.coalesce(func.sum(Trip.points), 0),
            func.coalesce(func.sum(Trip.duration_seconds), 0),
            func.coalesce(func.avg(Trip.avg_score), 0.0),
            func.coalesce(func.sum(Trip.hard_brakes), 0),
            func.coalesce(func.sum(Trip.aggressive_accels), 0),
            func.coalesce(func.sum(Trip.sharp_turns), 0),
            func.coalesce(func.sum(Trip.phone_seconds), 0),
        ).select_from(Trip).where(Trip.user_id == user_id, Trip.status == TripStatus.COMPLETED)
    )).one()

    safe_trips_count = await db.scalar(
        select(func.count(Trip.id)).where(
            Trip.user_id == user_id,
            Trip.status == TripStatus.COMPLETED,
            Trip.avg_score >= 90,
        )
    ) or 0

    return StatsOut(stats=DrivingStats(
        total_trips=int(agg[0] or 0),
        total_distance=float(agg[1] or 0.0),
        total_points=int(agg[2] or 0),
        average_score=int(round(agg[4] or 0.0)),
        safe_trips_count=int(safe_trips_count),
        total_duration_seconds=int(agg[3] or 0),
        recent_scores=recent_scores,
        event_counts=EventCounts(
            hard_brakes=int(agg[5] or 0),
            aggressive_accels=int(agg[6] or 0),
            sharp_turns=int(agg[7] or 0),
            phone_seconds=int(agg[8] or 0),
        ),
    ))

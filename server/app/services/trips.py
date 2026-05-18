from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.audit import audit
from app.models import Trip, TripStatus, User
from app.schemas.trip import SaveTripIn, TripOut


async def list_for_user(db: AsyncSession, user_id: str) -> list[TripOut]:
    rows = await db.scalars(
        select(Trip).where(Trip.user_id == user_id).order_by(Trip.start_time.desc()).limit(100)
    )
    return [TripOut.from_orm_trip(t) for t in rows.all()]


async def get_by_id(db: AsyncSession, user_id: str, trip_id: str) -> Trip:
    trip = await db.scalar(
        select(Trip)
        .where(Trip.id == trip_id, Trip.user_id == user_id)
        .options(selectinload(Trip.events))
    )
    if trip is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Trip not found")
    return trip


async def save(db: AsyncSession, user: User, dto: SaveTripIn) -> TripOut:
    start = dto.start_time or datetime.now(timezone.utc)
    end = dto.end_time
    duration = dto.duration_seconds
    if duration is None and end is not None:
        duration = max(0, int((end - start).total_seconds()))
    distance = dto.distance_km or 0.0
    avg_score = dto.avg_score

    trip = Trip(
        user_id=user.id,
        start_time=start,
        end_time=end,
        duration_seconds=duration or 0,
        distance_km=distance,
        avg_score=avg_score,
        points=dto.points or 0,
        hard_brakes=dto.hard_brakes or 0,
        aggressive_accels=dto.aggressive_accels or 0,
        sharp_turns=dto.sharp_turns or 0,
        phone_seconds=dto.phone_seconds or 0,
        start_location=dto.start_location,
        end_location=dto.end_location,
        ai_insight=dto.ai_insight,
        status=TripStatus.COMPLETED if end else TripStatus.ACTIVE,
        synced_at=datetime.now(timezone.utc),
    )
    db.add(trip)

    if trip.points > 0 or trip.distance_km > 0:
        user.points += trip.points
        user.total_points += trip.points
        user.total_distance += trip.distance_km

    await db.commit()
    await db.refresh(trip)
    audit("trips.saved", user_id=user.id, trip_id=trip.id, distance_km=trip.distance_km,
          points=trip.points, avg_score=trip.avg_score)
    return TripOut.from_orm_trip(trip)

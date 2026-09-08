from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import TripOccupancy
from app.schemas.occupancy import OccupancyDeclarationIn, OccupancyOut, OccupancySource, OccupancyVerdict
from app.services import trips as trips_service


async def declare(db: AsyncSession, user_id: str, trip_id: str, dto: OccupancyDeclarationIn) -> OccupancyOut:
    trip = await trips_service.get_by_id(db, user_id, trip_id)  # 404s if not the caller's trip

    verdict = OccupancyVerdict.PASSENGER if not dto.was_driving else OccupancyVerdict.DRIVER
    source = OccupancySource.ANSWERED if dto.prompted else OccupancySource.DECLARED
    excluded = verdict is OccupancyVerdict.PASSENGER

    row = await db.get(TripOccupancy, trip_id)
    if row is None:
        row = TripOccupancy(trip_id=trip_id)
        db.add(row)
    row.verdict = verdict.value
    row.source = source.value
    row.excluded_from_driver_score = excluded
    if excluded:
        # ensure_ai_insight skips a trip already declared PASSENGER, but the detail
        # screen generates on mount and offers this declaration underneath, so the
        # usual order is view first, declare second — by which point the coaching is
        # already on the row. The attempt marker goes with it, or correcting back to
        # DRIVER would leave the trip permanently insight-less.
        trip.ai_insight = None
        trip.ai_insight_attempted_at = None
    await db.commit()

    return OccupancyOut(
        trip_id=trip_id,
        verdict=verdict,
        excluded_from_driver_score=excluded,
    )


async def get(db: AsyncSession, user_id: str, trip_id: str) -> OccupancyOut:
    await trips_service.get_by_id(db, user_id, trip_id)  # 404s if not the caller's trip

    row = await db.get(TripOccupancy, trip_id)
    if row is None:
        # No declaration yet is normal state for most trips, not missing data.
        return OccupancyOut(
            trip_id=trip_id,
            verdict=OccupancyVerdict.UNKNOWN,
            excluded_from_driver_score=False,
        )

    return OccupancyOut(
        trip_id=trip_id,
        verdict=OccupancyVerdict(row.verdict),
        excluded_from_driver_score=row.excluded_from_driver_score,
    )

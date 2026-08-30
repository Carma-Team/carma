from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import TripOccupancy
from app.schemas.occupancy import OccupancyDeclarationIn, OccupancyOut, OccupancySource, OccupancyVerdict
from app.services import trips as trips_service


async def declare(db: AsyncSession, user_id: str, trip_id: str, dto: OccupancyDeclarationIn) -> OccupancyOut:
    await trips_service.get_by_id(db, user_id, trip_id)  # 404s if not the caller's trip

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
    await db.commit()

    return OccupancyOut(
        trip_id=trip_id,
        verdict=verdict,
        excluded_from_driver_score=excluded,
        points_reversed=0.0,
        appeal_available=False,
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
            points_reversed=0.0,
            appeal_available=False,
        )

    return OccupancyOut(
        trip_id=trip_id,
        verdict=OccupancyVerdict(row.verdict),
        excluded_from_driver_score=row.excluded_from_driver_score,
        points_reversed=0.0,
        appeal_available=False,
    )

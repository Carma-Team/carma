from __future__ import annotations

from fastapi import APIRouter, Header

from app.core.deps import CurrentUser, DbSession
from app.schemas.trip import SaveTripIn, TripList, TripOut, TripSingle
from app.services import trips as trips_service

router = APIRouter(prefix="/api/trips", tags=["trips"])


@router.get("", response_model=TripList, response_model_by_alias=True, summary="List the authenticated user trips")
async def list_trips(user: CurrentUser, db: DbSession) -> TripList:
    return TripList(trips=await trips_service.list_for_user(db, user.id))


@router.post(
    "",
    response_model=TripOut,
    response_model_by_alias=True,
    status_code=201,
    summary="Persist a completed trip from the mobile app",
)
async def save_trip(
    dto: SaveTripIn,
    user: CurrentUser,
    db: DbSession,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
) -> TripOut:
    return await trips_service.save(db, user, dto, idempotency_key=idempotency_key)


@router.get("/{trip_id}", response_model=TripSingle, response_model_by_alias=True, summary="Get a single trip by id")
async def get_trip(trip_id: str, user: CurrentUser, db: DbSession) -> TripSingle:
    trip = await trips_service.get_by_id(db, user.id, trip_id)
    return TripSingle(trip=TripOut.from_orm_trip(trip))

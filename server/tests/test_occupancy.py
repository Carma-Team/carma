"""Live DB integration tests for the occupancy declaration (CAR-220).

Both tests exist because an in-session assertion would pass even if `declare()`
never committed — the row is visible to the writer's own session either way.
The first opens a second session against the same engine to prove the row
survives past the request; the second exercises the actual exclusion path in
`trips._compute_score` rather than re-stating its WHERE clause.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from fastapi import HTTPException
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.models import Trip, TripOccupancy, User
from app.models.enums import UserRole
from app.schemas.occupancy import OccupancyDeclarationIn, OccupancyVerdict
from app.schemas.trip import SaveTripIn
from app.services import occupancy as occupancy_service
from app.services import trips as trips_service

_TRIP_START_MS = 1781510400000  # 2026-06-14T08:00:00Z


def _steady_waypoints() -> list[dict[str, Any]]:
    """Confidence-bearing trace so trip_score is not pinned to the rolling score."""
    return [
        {"ts": _TRIP_START_MS + i * 4000, "speedKmh": 24.8, "lat": 32.07 + i * 0.0002, "lng": 34.78} for i in range(226)
    ]


def _trip_dto(*, hard_brakes: int) -> SaveTripIn:
    return SaveTripIn(
        distanceKm=6.2,
        durationSeconds=900,
        startTime="2026-06-14T08:00:00Z",
        endTime="2026-06-14T08:15:00Z",
        hardBrakes=hard_brakes,
        routeWaypoints=_steady_waypoints(),
    )


async def _make_user(db: AsyncSession) -> User:
    user = User(
        email=f"_occ_{uuid.uuid4().hex[:10]}@carma.test",
        password_hash="x",
        role=UserRole.DRIVER,
        name="Occupancy Test",
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _cleanup(db: AsyncSession, *users: User) -> None:
    for user in users:
        await db.execute(delete(Trip).where(Trip.user_id == user.id))
        await db.delete(user)
    await db.commit()


@pytest.mark.asyncio
async def test_declare_persists_across_a_fresh_session(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    try:
        trip = await trips_service.save(db_session, user, _trip_dto(hard_brakes=1), idempotency_key=uuid.uuid4().hex)

        await occupancy_service.declare(
            db_session, user.id, trip.id, OccupancyDeclarationIn(was_driving=False, prompted=False)
        )

        # A session opened fresh against the same engine — an in-session read would
        # pass even without a commit, which is exactly the bug this guards against.
        session_factory = async_sessionmaker(db_session.bind, class_=AsyncSession)
        async with session_factory() as fresh:
            row = await fresh.get(TripOccupancy, trip.id)
            assert row is not None, "declaration was never committed"
            assert row.verdict == OccupancyVerdict.PASSENGER.value
            assert row.excluded_from_driver_score is True

        out = await occupancy_service.get(db_session, user.id, trip.id)
        assert out.verdict is OccupancyVerdict.PASSENGER
        assert out.excluded_from_driver_score is True
    finally:
        await _cleanup(db_session, user)


@pytest.mark.asyncio
async def test_get_before_any_declaration_returns_unknown_not_excluded(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    try:
        trip = await trips_service.save(db_session, user, _trip_dto(hard_brakes=1), idempotency_key=uuid.uuid4().hex)
        out = await occupancy_service.get(db_session, user.id, trip.id)
        assert out.verdict is OccupancyVerdict.UNKNOWN
        assert out.excluded_from_driver_score is False
    finally:
        await _cleanup(db_session, user)


@pytest.mark.asyncio
async def test_declaring_on_another_users_trip_404s(db_session: AsyncSession) -> None:
    owner = await _make_user(db_session)
    stranger = await _make_user(db_session)
    try:
        trip = await trips_service.save(db_session, owner, _trip_dto(hard_brakes=1), idempotency_key=uuid.uuid4().hex)
        with pytest.raises(HTTPException) as exc_info:
            await occupancy_service.declare(
                db_session, stranger.id, trip.id, OccupancyDeclarationIn(was_driving=False, prompted=False)
            )
        assert exc_info.value.status_code == 404
    finally:
        await _cleanup(db_session, owner, stranger)


@pytest.mark.asyncio
async def test_declared_passenger_trip_excluded_from_rolling_driver_score(db_session: AsyncSession) -> None:
    """A trip declared passenger must drop out of the next save's history exactly as
    if it had never been saved — proving the exclusion filter, not restating it.
    """
    with_history_user = await _make_user(db_session)
    control_user = await _make_user(db_session)
    try:
        # with_history_user: a bad first trip, declared passenger, then a clean second trip.
        bad_trip = await trips_service.save(
            db_session, with_history_user, _trip_dto(hard_brakes=6), idempotency_key=uuid.uuid4().hex
        )
        await occupancy_service.declare(
            db_session,
            with_history_user.id,
            bad_trip.id,
            OccupancyDeclarationIn(was_driving=False, prompted=False),
        )
        second = await trips_service.save(
            db_session, with_history_user, _trip_dto(hard_brakes=0), idempotency_key=uuid.uuid4().hex
        )

        # control_user: only the clean trip, no history at all.
        control = await trips_service.save(
            db_session, control_user, _trip_dto(hard_brakes=0), idempotency_key=uuid.uuid4().hex
        )

        await db_session.refresh(with_history_user)
        await db_session.refresh(control_user)
        assert (
            with_history_user.driver_score == control_user.driver_score
        ), "the declared-passenger trip is still influencing the rolling driver score"
        assert second.avg_score == control.avg_score
    finally:
        await _cleanup(db_session, with_history_user, control_user)

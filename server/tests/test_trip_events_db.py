"""Live DB integration tests for trip → Event persistence.

The pure parser tests (test_trip_events.py) prove the validation contract; these
prove the other half — that save() actually writes the rows through the
Trip→Event cascade, that the type bridge survives a round-trip, and that the
idempotent re-save does not duplicate the timeline. Skipped automatically when
no Postgres is reachable (see conftest.db_session).
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Event, Trip, User
from app.models.enums import UserRole
from app.schemas.trip import SaveTripIn
from app.services import trips as trips_service


@pytest.fixture
def trip_dto_with_events() -> SaveTripIn:
    return SaveTripIn(
        distanceKm=6.2,
        durationSeconds=900,
        startTime="2026-06-14T08:00:00Z",
        endTime="2026-06-14T08:15:00Z",
        hardBrakes=2,
        sharpTurns=1,
        events=[
            {
                "type": "HARD_BRAKE",
                "severity": 0.7,
                "timestamp": "2026-06-14T08:03:00Z",
                "location": {"latitude": 32.07, "longitude": 34.78},
                "peakG": 0.52,
            },
            {"type": "PHONE_USAGE", "severity": 0.4, "timestamp": "2026-06-14T08:06:00Z"},
            {"type": "SHARP_TURN", "severity": 0.6, "lat": 32.08, "lng": 34.79},
            {"type": "TELEPORT"},  # unknown → dropped
            {"type": "HARD_BRAKE", "lat": 999.0},  # bad coord → kept, coord nulled
        ],
    )


async def _make_user(db: AsyncSession) -> User:
    user = User(
        email=f"_evt_{uuid.uuid4().hex[:10]}@carma.test",
        password_hash="x",
        role=UserRole.DRIVER,
        name="Evt Test",
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _cleanup(db: AsyncSession, user: User) -> None:
    # Events cascade-delete with their trips; deleting the user removes the trips.
    await db.execute(delete(Trip).where(Trip.user_id == user.id))
    await db.delete(user)
    await db.commit()


@pytest.mark.asyncio
async def test_save_persists_event_rows(db_session: AsyncSession, trip_dto_with_events: SaveTripIn) -> None:
    user = await _make_user(db_session)
    try:
        out = await trips_service.save(db_session, user, trip_dto_with_events, idempotency_key=uuid.uuid4().hex)

        rows = (
            (await db_session.execute(select(Event).where(Event.trip_id == out.id).order_by(Event.timestamp)))
            .scalars()
            .all()
        )

        # 5 input events: TELEPORT dropped → 4 persisted.
        assert len(rows) == 4
        types = {e.type.value for e in rows}
        assert types == {"HARD_BRAKE", "PHONE_USE", "SHARP_TURN"}

        # PHONE_USAGE (SDK) must have been bridged to PHONE_USE (column) on the way in.
        assert any(e.type.value == "PHONE_USE" for e in rows)

        # The raw payload is retained for forensics — peak_g survives until v2 reads it.
        braked = next(e for e in rows if e.lat == 32.07)
        assert braked.sensor_data is not None and braked.sensor_data["peakG"] == 0.52

        # Out-of-range coordinate was nulled, but the event itself was kept.
        bad_coord = next(e for e in rows if e.type.value == "HARD_BRAKE" and e.lat is None)
        assert bad_coord.lng is None
    finally:
        await _cleanup(db_session, user)


@pytest.mark.asyncio
async def test_idempotent_resave_does_not_duplicate_events(
    db_session: AsyncSession, trip_dto_with_events: SaveTripIn
) -> None:
    user = await _make_user(db_session)
    key = uuid.uuid4().hex
    try:
        first = await trips_service.save(db_session, user, trip_dto_with_events, idempotency_key=key)
        # Same idempotency key → must return the existing trip without re-inserting events.
        second = await trips_service.save(db_session, user, trip_dto_with_events, idempotency_key=key)
        assert first.id == second.id

        count = await db_session.scalar(select(func.count()).select_from(Event).where(Event.trip_id == first.id))
        assert count == 4, "idempotent re-save must not duplicate the event timeline"
    finally:
        await _cleanup(db_session, user)

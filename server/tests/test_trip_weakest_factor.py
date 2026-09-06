"""The weakest factor survives past the save response (CAR-186).

CAR-185 computed it and returned it once. Nothing wrote it down, so the "one
thing to fix" line on the trip summary vanished the moment the driver reopened
the same trip from history. These tests are what notices if it stops being
persisted: the save has to store it, and both read paths have to hand it back.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import get_args
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import UserRole
from app.models.trip import WEAKEST_FACTORS, Trip
from app.models.user import User
from app.schemas.trip import SaveTripIn, TripDetailOut
from app.services import trips as trips_service
from app.services.scoring import WeakestFactor

_TZ_IL = ZoneInfo("Asia/Jerusalem")


def test_the_column_and_the_engine_name_the_same_five_factors() -> None:
    """The model spells the set out instead of importing it; this is the seam.

    Adding a sixth subscore to the engine without a migration would otherwise
    fail at INSERT, in production, on the first trip that names it.
    """
    assert WEAKEST_FACTORS == get_args(WeakestFactor)


async def _driver(db: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4().hex,
        phone=f"+9725{uuid.uuid4().int % 10**8:08d}",
        name="Weakest Factor Test",
        role=UserRole.DRIVER,
    )
    db.add(user)
    await db.commit()
    return user


def _trip(hard_brakes: int) -> SaveTripIn:
    """A midday drive whose only flaw is braking; noon pins the risk multiplier."""
    noon = datetime.now(_TZ_IL).replace(hour=12, minute=0, second=0, microsecond=0)
    return SaveTripIn(
        startTime=noon,
        endTime=noon,
        distanceKm=4.0,
        durationSeconds=1800,
        hardBrakes=hard_brakes,
        aggressiveAccels=0,
        sharpTurns=0,
        touchEpochs=0,
        screenInteractionSeconds=0,
    )


@pytest.mark.asyncio
async def test_the_computed_factor_reaches_the_row(db_session: AsyncSession) -> None:
    driver = await _driver(db_session)
    saved = await trips_service.save(db_session, driver, _trip(hard_brakes=12))

    assert saved.weakest_factor == "braking"
    row = await db_session.scalar(select(Trip).where(Trip.id == saved.id))
    assert row is not None
    assert row.weakest_factor == "braking"


@pytest.mark.asyncio
async def test_history_and_detail_still_name_it(db_session: AsyncSession) -> None:
    """The bug itself: both read paths answered None on every trip ever saved."""
    driver = await _driver(db_session)
    saved = await trips_service.save(db_session, driver, _trip(hard_brakes=12))

    listed = await trips_service.list_for_user(db_session, driver.id)
    assert [t.weakest_factor for t in listed if t.id == saved.id] == ["braking"]

    detail = TripDetailOut.from_orm_trip_detail(await trips_service.get_by_id(db_session, driver.id, saved.id))
    assert detail.weakest_factor == "braking"


@pytest.mark.asyncio
async def test_a_clean_trip_names_nothing(db_session: AsyncSession) -> None:
    """Above 90 on every subscore there is nothing worth telling the driver.

    NULL rather than a sixth "none" value: it is the same answer a trip scored
    before this column existed gives, and the screen treats both the same way.
    """
    driver = await _driver(db_session)
    saved = await trips_service.save(db_session, driver, _trip(hard_brakes=0))

    assert saved.weakest_factor is None
    row = await db_session.scalar(select(Trip).where(Trip.id == saved.id))
    assert row is not None
    assert row.weakest_factor is None

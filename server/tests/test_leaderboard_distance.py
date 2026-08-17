"""The leaderboard entry carries lifetime kilometres (CAR-173).

CAR-19 divides `score` by this to rank drivers on efficiency rather than on
totals, so two things have to hold: the number is the driver's real lifetime
distance, and a driver who has never driven reports 0.0 rather than null — the
client can guard a zero divisor, it cannot guard a missing field.

Needs real rows, so it skips without Postgres.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User, UserRole
from app.services import leaderboard as svc

CITY = f"עיר-מרחק-{uuid.uuid4().hex[:6]}"


async def _driver(db: AsyncSession, *, points: int, distance: float | None = None) -> User:
    user = User(
        email=f"_lbkm_{uuid.uuid4().hex[:10]}@carmatest.co.il",
        password_hash="x",
        name="KM Driver",
        role=UserRole.DRIVER,
        city=CITY,
        total_points=points,
        **({} if distance is None else {"total_distance": distance}),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _cleanup(db: AsyncSession, *users: User) -> None:
    for user in users:
        await db.delete(user)
    await db.commit()


@pytest.mark.asyncio
async def test_entry_carries_the_drivers_lifetime_distance(db_session: AsyncSession) -> None:
    viewer = await _driver(db_session, points=900, distance=412.5)
    other = await _driver(db_session, points=100, distance=25.0)
    try:
        board = await svc.get(db_session, viewer, "city", CITY)
        by_id = {e.user_id: e for e in board.entries}

        assert by_id[viewer.id].distance_km == pytest.approx(412.5)
        assert by_id[other.id].distance_km == pytest.approx(25.0)
    finally:
        await _cleanup(db_session, viewer, other)


@pytest.mark.asyncio
async def test_a_driver_who_never_drove_reports_zero_not_null(db_session: AsyncSession) -> None:
    # The divisor CAR-19 has to guard. Left to the column default on purpose:
    # this is exactly the shape a freshly registered user has.
    fresh = await _driver(db_session, points=0)
    try:
        board = await svc.get(db_session, fresh, "city", CITY)
        entry = next(e for e in board.entries if e.user_id == fresh.id)

        assert entry.distance_km == 0.0
    finally:
        await _cleanup(db_session, fresh)


@pytest.mark.asyncio
async def test_distance_reaches_the_wire_as_distance_km(db_session: AsyncSession) -> None:
    """The client reads `distanceKm`; the alias is the part CAR-19 depends on."""
    driver = await _driver(db_session, points=300, distance=88.25)
    try:
        board = await svc.get(db_session, driver, "city", CITY)
        payload = board.model_dump(by_alias=True)
        entry = next(e for e in payload["entries"] if e["userId"] == driver.id)

        assert entry["distanceKm"] == pytest.approx(88.25)
        assert "distance_km" not in entry
    finally:
        await _cleanup(db_session, driver)

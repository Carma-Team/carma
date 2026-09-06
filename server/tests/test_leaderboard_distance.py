"""The leaderboard entry carries lifetime kilometres (CAR-173).

CAR-19 divides `score` by this, so what matters is that the number is the
driver's real lifetime distance and that it reaches the client under the name
the client reads. The wire name is the fragile half: it comes from
`response_model_by_alias=True` on the route, not from the schema, so the
serialisation is exercised through the router rather than through `model_dump`.

Needs real rows, so it skips without Postgres.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token
from app.models import City, User, UserRole
from app.services import leaderboard as svc

# A city of this test's own. Cities are reference rows now (CAR-218), so the
# isolation a random name used to give comes from a code nothing else uses.
CITY_CODE = f"t{uuid.uuid4().hex[:8]}"


async def _ensure_city(db: AsyncSession) -> None:
    if await db.get(City, CITY_CODE) is None:
        db.add(City(code=CITY_CODE, name_he="עיר-מרחק", name_en="Distance City"))
        await db.commit()


async def _driver(db: AsyncSession, *, points: int, distance: float = 0.0, private: bool = False) -> User:
    await _ensure_city(db)
    user = User(
        email=f"_lbkm_{uuid.uuid4().hex[:10]}@carmatest.co.il",
        password_hash="x",
        name="KM Driver",
        role=UserRole.DRIVER,
        city_code=CITY_CODE,
        total_points=points,
        total_distance=distance,
        is_private=private,
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
        board = await svc.get(db_session, viewer, "city", CITY_CODE)
        by_id = {e.user_id: e for e in board.entries}

        assert by_id[viewer.id].distance_km == pytest.approx(412.5)
        assert by_id[other.id].distance_km == pytest.approx(25.0)
    finally:
        await _cleanup(db_session, viewer, other)


@pytest.mark.asyncio
async def test_the_client_reads_distance_km_off_the_response(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    """The camelCase name is the contract CAR-19 depends on.

    Driven through the router on purpose: the alias comes from
    `response_model_by_alias=True` in routers/leaderboard.py, so a test that
    serialises the model itself would still pass with that argument deleted and
    every client reading `undefined`.
    """
    driver = await _driver(db_session, points=300, distance=88.25)
    token = create_access_token(user_id=driver.id, email=driver.email, phone=None, role=UserRole.DRIVER)
    try:
        r = await db_api_client.get(
            "/api/leaderboard",
            params={"type": "city", "cityCode": CITY_CODE},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200

        entry = next(e for e in r.json()["entries"] if e["userId"] == driver.id)
        assert entry["distanceKm"] == pytest.approx(88.25)
        assert "distance_km" not in entry
    finally:
        await _cleanup(db_session, driver)


@pytest.mark.asyncio
async def test_every_board_type_carries_the_field(db_session: AsyncSession) -> None:
    """`friends` builds its rows from a separate query to the other two.

    It is also the only board that does not filter out private profiles, so it
    is the one path where a private driver's distance is emitted at all.
    """
    viewer = await _driver(db_session, points=400, distance=61.0, private=True)
    try:
        for board_type in ("national", "city", "friends"):
            board = await svc.get(db_session, viewer, board_type, CITY_CODE if board_type == "city" else None)
            mine = [e for e in board.entries if e.user_id == viewer.id]

            # A private driver is off the public boards by design; the assertion
            # is about the rows that *are* returned carrying the field.
            for entry in board.entries:
                assert entry.distance_km >= 0.0, f"{board_type} board dropped the field"
            if board_type == "friends":
                assert mine and mine[0].distance_km == pytest.approx(61.0)
    finally:
        await _cleanup(db_session, viewer)


@pytest.mark.asyncio
async def test_the_accumulators_float_drift_does_not_reach_the_client(db_session: AsyncSession) -> None:
    """`total_distance` is grown by repeated SQL addition, so it carries noise.

    Nobody should have to render 596.2000000000003. Settled to metres, matching
    what telemetry.py does to the same quantity on the way in.
    """
    drifted = await _driver(db_session, points=100, distance=596.2000000000003)
    try:
        board = await svc.get(db_session, drifted, "city", CITY_CODE)
        entry = next(e for e in board.entries if e.user_id == drifted.id)

        assert entry.distance_km == 596.2
    finally:
        await _cleanup(db_session, drifted)

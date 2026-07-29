"""Leaderboard location filter — the picker's options and what they actually do.

Two things the screen depends on and one it silently did not get before:
  1. /locations offers only cities that have a driver on the board, so a listed
     option can never come back empty.
  2. ?city= actually moves the board. Until now the server ignored it and always
     used the caller's own city, which made the picker decorative.
  3. myRank is counted against whatever board was requested, not the nation.

Guards run in-process; the filtering needs real rows and skips without Postgres.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.models import User, UserRole
from app.services import leaderboard as svc

CITY_A = f"עיר-א-{uuid.uuid4().hex[:6]}"
CITY_B = f"עיר-ב-{uuid.uuid4().hex[:6]}"


@pytest.mark.asyncio
async def test_locations_requires_auth() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/leaderboard/locations")
    assert r.status_code == 401


async def _driver(db: AsyncSession, *, city: str | None, points: int = 100, private: bool = False) -> User:
    user = User(
        email=f"_lb_{uuid.uuid4().hex[:10]}@carmatest.co.il",
        password_hash="x",
        name="LB Driver",
        role=UserRole.DRIVER,
        city=city,
        total_points=points,
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
async def test_locations_lists_one_country_and_the_cities_under_it(db_session: AsyncSession) -> None:
    a = await _driver(db_session, city=CITY_A)
    b = await _driver(db_session, city=CITY_B)
    try:
        out = await svc.locations(db_session)

        assert out.countries == [svc.COUNTRY], "single-country deployment — exactly one option"
        cities = out.cities_by_country[svc.COUNTRY]
        assert CITY_A in cities and CITY_B in cities
        assert len(cities) == len(set(cities)), "a city must not repeat once per driver in it"
    finally:
        await _cleanup(db_session, a, b)


@pytest.mark.asyncio
async def test_locations_omits_cities_with_nothing_on_the_board(db_session: AsyncSession) -> None:
    hidden_city = f"עיר-נסתרת-{uuid.uuid4().hex[:6]}"
    private_only = await _driver(db_session, city=hidden_city, private=True)
    no_city = await _driver(db_session, city=None)
    blank_city = await _driver(db_session, city="")
    try:
        cities = (await svc.locations(db_session)).cities_by_country[svc.COUNTRY]

        # Offering this city would hand the user a filter that returns nothing:
        # the board excludes private drivers.
        assert hidden_city not in cities
        assert None not in cities and "" not in cities
    finally:
        await _cleanup(db_session, private_only, no_city, blank_city)


@pytest.mark.asyncio
async def test_city_filter_overrides_the_callers_own_city(db_session: AsyncSession) -> None:
    viewer = await _driver(db_session, city=CITY_A, points=10)
    in_a = await _driver(db_session, city=CITY_A, points=500)
    in_b = await _driver(db_session, city=CITY_B, points=500)
    try:
        board = await svc.get(db_session, viewer, "city", CITY_B)
        ids = {e.user_id for e in board.entries}

        # The viewer lives in CITY_A but asked for CITY_B — the picker must win.
        assert in_b.id in ids
        assert in_a.id not in ids
        assert viewer.id not in ids
    finally:
        await _cleanup(db_session, viewer, in_a, in_b)


@pytest.mark.asyncio
async def test_city_board_falls_back_to_the_callers_city(db_session: AsyncSession) -> None:
    viewer = await _driver(db_session, city=CITY_A, points=10)
    in_a = await _driver(db_session, city=CITY_A, points=500)
    in_b = await _driver(db_session, city=CITY_B, points=500)
    try:
        board = await svc.get(db_session, viewer, "city")
        ids = {e.user_id for e in board.entries}

        assert in_a.id in ids and viewer.id in ids
        assert in_b.id not in ids, "no ?city= means the caller's own city, as before"
    finally:
        await _cleanup(db_session, viewer, in_a, in_b)


@pytest.mark.asyncio
async def test_my_rank_is_counted_within_the_requested_board(db_session: AsyncSession) -> None:
    # Viewer is off the visible window in a foreign city, so my_rank is computed.
    viewer = await _driver(db_session, city=CITY_A, points=50, private=True)
    richer_in_b = await _driver(db_session, city=CITY_B, points=900)
    richer_elsewhere = await _driver(db_session, city=CITY_A, points=900)
    try:
        board = await svc.get(db_session, viewer, "city", CITY_B)

        # Exactly one driver in CITY_B outranks the viewer; the one in CITY_A
        # must not count, which is what a national tally would have done.
        assert board.my_rank == 2
        assert richer_in_b.id in {e.user_id for e in board.entries}
        assert richer_elsewhere.id not in {e.user_id for e in board.entries}
    finally:
        await _cleanup(db_session, viewer, richer_in_b, richer_elsewhere)

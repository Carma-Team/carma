"""The canonical settlement list, and what replaced the free-text city (CAR-218).

`users.city` was a display label, so it could only ever be right in one language,
and the column held both: the seed alone wrote "Tel Aviv" for some drivers and
"תל אביב" for others. A city is a reference row now, keyed by its CBS code.

The endpoint being public is the load-bearing part. Registration is its first
caller and runs before a token exists; wiring the picker to the authenticated
leaderboard endpoint is exactly what left it empty for every registering user
(CAR-224).
"""

from __future__ import annotations

import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.models import City, User, UserRole
from app.schemas.user import UpdateProfileIn
from app.services import cities as svc
from app.services import users as users_service

# Real CBS codes, from the list the migration ships.
JERUSALEM = "3000"
TEL_AVIV = "5000"
BNEI_BRAK = "6100"


# ─── the endpoint ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_the_list_is_served_without_a_token(db_session: AsyncSession) -> None:
    """The whole point. A registering user has no token yet."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/cities")

    assert r.status_code == 200, "registration cannot authenticate; this must answer anyway"
    body = r.json()
    assert len(body["cities"]) > 1000, "the whole CBS register, not just cities with drivers"


@pytest.mark.asyncio
async def test_every_entry_carries_both_labels(db_session: AsyncSession) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        body = (await ac.get("/api/cities")).json()

    by_code = {c["code"]: c for c in body["cities"]}
    assert by_code[TEL_AVIV]["nameHe"] == "תל אביב - יפו"
    assert by_code[TEL_AVIV]["nameEn"] == "Tel Aviv-Yafo"
    # CBS transliterates this BENE BERAQ, which is not what an English reader
    # recognises; the shipped list carries the preferred form.
    assert by_code[BNEI_BRAK]["nameEn"] == "Bnei Brak"
    assert all(c["nameHe"] and c["nameEn"] for c in body["cities"]), "no entry may be unlabelled"


@pytest.mark.asyncio
async def test_the_country_is_not_a_bare_hebrew_string(db_session: AsyncSession) -> None:
    """COUNTRY was the string "ישראל", sent to the English build as well."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        body = (await ac.get("/api/cities")).json()

    assert body["country"] == {"nameHe": "ישראל", "nameEn": "Israel"}


@pytest.mark.asyncio
async def test_it_is_cacheable_and_answers_304(db_session: AsyncSession) -> None:
    """A list that changes a few times a year should not be a query per signup."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        first = await ac.get("/api/cities")
        etag = first.headers["etag"]
        again = await ac.get("/api/cities", headers={"If-None-Match": etag})

    assert "public" in first.headers["cache-control"]
    assert "max-age=" in first.headers["cache-control"]
    assert again.status_code == 304
    assert again.headers["etag"] == etag


# ─── resolving whatever a client sends ───────────────────────────────────────


@pytest.mark.asyncio
async def test_a_code_resolves_to_itself(db_session: AsyncSession) -> None:
    assert await svc.resolve_code(db_session, code=JERUSALEM, label=None) == JERUSALEM


@pytest.mark.asyncio
async def test_a_legacy_label_resolves_in_either_language(db_session: AsyncSession) -> None:
    """Builds shipped before the canonical list still send a bare city name.

    422ing them would break registration on an app already in the field, and the
    column being replaced held labels in both languages anyway.
    """
    assert await svc.resolve_code(db_session, code=None, label="ירושלים") == JERUSALEM
    assert await svc.resolve_code(db_session, code=None, label="Jerusalem") == JERUSALEM
    assert await svc.resolve_code(db_session, code=None, label="  jerusalem  ") == JERUSALEM


@pytest.mark.asyncio
async def test_an_unrecognised_value_is_none_rather_than_an_error(db_session: AsyncSession) -> None:
    """The same answer the column gave before any of this existed."""
    assert await svc.resolve_code(db_session, code=None, label="Nowhereville") is None
    assert await svc.resolve_code(db_session, code="not-a-code", label=None) is None
    assert await svc.resolve_code(db_session, code=None, label="   ") is None
    assert await svc.resolve_code(db_session, code=None, label=None) is None


# ─── the profile round trip ──────────────────────────────────────────────────


async def _driver(db: AsyncSession) -> User:
    user = User(
        email=f"_city_{uuid.uuid4().hex[:10]}@carmatest.co.il",
        password_hash="x",
        name="City Test",
        role=UserRole.DRIVER,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@pytest.mark.asyncio
async def test_a_profile_update_stores_a_code_and_reads_back_both_labels(db_session: AsyncSession) -> None:
    driver = await _driver(db_session)
    try:
        await users_service.update_profile(db_session, driver, UpdateProfileIn(cityCode=TEL_AVIV))
        assert driver.city_code == TEL_AVIV

        out = await users_service.profile_out(db_session, driver)
        assert out.city is not None
        assert out.city.code == TEL_AVIV
        assert out.city.name_he == "תל אביב - יפו"
        assert out.city.name_en == "Tel Aviv-Yafo"
    finally:
        await db_session.delete(driver)
        await db_session.commit()


@pytest.mark.asyncio
async def test_a_deprecated_label_still_updates_a_profile(db_session: AsyncSession) -> None:
    driver = await _driver(db_session)
    try:
        await users_service.update_profile(db_session, driver, UpdateProfileIn(city="ירושלים"))
        assert driver.city_code == JERUSALEM
    finally:
        await db_session.delete(driver)
        await db_session.commit()


@pytest.mark.asyncio
async def test_clearing_the_city_is_still_a_real_edit(db_session: AsyncSession) -> None:
    driver = await _driver(db_session)
    try:
        await users_service.update_profile(db_session, driver, UpdateProfileIn(cityCode=TEL_AVIV))
        await users_service.update_profile(db_session, driver, UpdateProfileIn(cityCode=None))
        assert driver.city_code is None
    finally:
        await db_session.delete(driver)
        await db_session.commit()


@pytest.mark.asyncio
async def test_an_unrelated_update_leaves_the_city_alone(db_session: AsyncSession) -> None:
    """`exclude_unset` is what makes this true; the city keys are simply absent."""
    driver = await _driver(db_session)
    try:
        await users_service.update_profile(db_session, driver, UpdateProfileIn(cityCode=BNEI_BRAK))
        await users_service.update_profile(db_session, driver, UpdateProfileIn(age=41))
        assert driver.city_code == BNEI_BRAK
        assert driver.age == 41
    finally:
        await db_session.delete(driver)
        await db_session.commit()


@pytest.mark.asyncio
async def test_the_reference_table_holds_the_whole_register(db_session: AsyncSession) -> None:
    total = await db_session.scalar(select(func.count()).select_from(City))
    assert total is not None and total >= 1310

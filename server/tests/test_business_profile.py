"""Business profile read/update (CAR-341) — auth guards and the field boundary.

The one thing that would hurt if it broke: `registration_number` (the ח.פ./tax
id) becoming editable through this endpoint despite `BusinessProfileUpdateIn`
never declaring it — there is no verification workflow for changing it yet
(see the approved design's own "flagged, not built" note), so it must stay
server-side read-only no matter what a client sends.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.models import Business, BusinessCategory, BusinessMembership, BusinessMembershipRole, User, UserRole
from app.schemas.business_profile import BusinessProfileUpdateIn
from app.services import business as business_service

# ─── Auth guards (no DB) ─────────────────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/api/business/profile"),
        ("PATCH", "/api/business/profile"),
    ],
)
async def test_business_profile_requires_auth(method: str, path: str) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.request(method, path, json={})
    assert r.status_code == 401, f"{method} {path} must reject anonymous callers before any handler logic"


# ─── Fixtures for the DB-backed tests ────────────────────────────────────────


async def _make_business(
    db: AsyncSession, *, role: BusinessMembershipRole = BusinessMembershipRole.OWNER
) -> tuple[Business, User]:
    owner = User(
        email=f"_biz_{uuid.uuid4().hex[:10]}@carmatest.co.il",
        password_hash="x",
        role=UserRole.BUSINESS,
        name="Biz Owner",
    )
    db.add(owner)
    await db.flush()

    business = Business(
        owner_user_id=owner.id,
        name="Test Biz",
        name_he="עסק בדיקה",
        category=BusinessCategory.FOOD,
        location_lat=32.07,
        location_lng=34.78,
        address="Old Address 1",
        registration_number=f"51{uuid.uuid4().int % 10**7:07d}",
    )
    db.add(business)
    await db.flush()
    db.add(BusinessMembership(user_id=owner.id, business_id=business.id, role=role))
    await db.commit()
    await db.refresh(business)
    return business, owner


async def _cleanup(db: AsyncSession, business: Business, owner: User) -> None:
    await db.delete(business)
    await db.commit()
    reloaded_owner = await db.get(User, owner.id)
    if reloaded_owner is not None:
        await db.delete(reloaded_owner)
        await db.commit()


# ─── Service-level behaviour ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_update_applies_only_sent_fields(db_session: AsyncSession) -> None:
    business, owner = await _make_business(db_session)
    try:
        out = await business_service.update_profile(
            db_session, business, BusinessProfileUpdateIn.model_validate({"address": "New Address 5"})
        )
        assert out.address == "New Address 5"
        # Untouched — PATCH is partial, same exclude_unset contract as rewards.
        assert out.name == "Test Biz"
        assert out.name_he == "עסק בדיקה"
        assert out.category == "food"
    finally:
        await _cleanup(db_session, business, owner)


@pytest.mark.asyncio
async def test_update_lowercases_category_for_the_client(db_session: AsyncSession) -> None:
    business, owner = await _make_business(db_session)
    try:
        out = await business_service.update_profile(
            db_session, business, BusinessProfileUpdateIn.model_validate({"category": "shopping"})
        )
        assert out.category == "shopping"
        assert business.category == BusinessCategory.SHOPPING
    finally:
        await _cleanup(db_session, business, owner)


@pytest.mark.asyncio
async def test_update_can_clear_name_he_back_to_the_fallback(db_session: AsyncSession) -> None:
    business, owner = await _make_business(db_session)
    try:
        out = await business_service.update_profile(
            db_session, business, BusinessProfileUpdateIn.model_validate({"nameHe": None})
        )
        assert out.name_he is None
    finally:
        await _cleanup(db_session, business, owner)


@pytest.mark.asyncio
async def test_update_never_touches_registration_number(db_session: AsyncSession) -> None:
    business, owner = await _make_business(db_session)
    original_number = business.registration_number
    try:
        # BusinessProfileUpdateIn has no such field at all — this proves the
        # server-side boundary, not just that the client UI hides it.
        assert "registration_number" not in BusinessProfileUpdateIn.model_fields
        await business_service.update_profile(
            db_session, business, BusinessProfileUpdateIn.model_validate({"name": "Renamed Biz"})
        )
        assert business.registration_number == original_number
    finally:
        await _cleanup(db_session, business, owner)


@pytest.mark.asyncio
async def test_get_profile_returns_current_record(db_session: AsyncSession) -> None:
    business, owner = await _make_business(db_session)
    try:
        from app.schemas.business_profile import BusinessProfileOut

        out = BusinessProfileOut.from_orm_business(business)
        assert out.id == business.id
        assert out.registration_number == business.registration_number
    finally:
        await _cleanup(db_session, business, owner)

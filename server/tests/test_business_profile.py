"""Business profile read/update (CAR-341) — auth guards and the field boundary.

Three things that would hurt if they broke:
  1. `registration_number` (the ח.פ./tax id) becoming editable through this
     endpoint despite `BusinessProfileUpdateIn` never declaring it — there is
     no verification workflow for changing it yet (see the approved design's
     own "flagged, not built" note), so it must stay server-side read-only no
     matter what a client sends.
  2. `address` changing without `location_lat`/`location_lng` moving with it
     — the business's displayed address and its actual map/marketplace point
     silently diverging.
  3. An explicit null reaching a NOT-NULL column (`name`, `category`,
     `address`) and failing ugly at commit instead of a clean 422 — `name_he`
     is the one field that must still accept an explicit null (it's nullable
     on the model, and null is how a caller clears the override).
"""

from __future__ import annotations

import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError
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


async def _add_member(db: AsyncSession, business: Business, role: BusinessMembershipRole) -> User:
    user = User(
        email=f"_biz_{uuid.uuid4().hex[:10]}@carmatest.co.il",
        password_hash="x",
        role=UserRole.BUSINESS,
        name=f"{role.value.title()} User",
    )
    db.add(user)
    await db.flush()
    db.add(BusinessMembership(user_id=user.id, business_id=business.id, role=role))
    await db.commit()
    return user


async def _cleanup(db: AsyncSession, business: Business, *users: User) -> None:
    await db.delete(business)
    await db.commit()
    for user in users:
        reloaded = await db.get(User, user.id)
        if reloaded is not None:
            await db.delete(reloaded)
            await db.commit()


# ─── Service-level behaviour ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_update_applies_only_sent_fields(db_session: AsyncSession) -> None:
    business, owner = await _make_business(db_session)
    try:
        out = await business_service.update_profile(
            db_session, business, BusinessProfileUpdateIn.model_validate({"name": "Renamed Biz"})
        )
        assert out.name == "Renamed Biz"
        # Untouched — PATCH is partial, same exclude_unset contract as rewards.
        assert out.name_he == "עסק בדיקה"
        assert out.category == "food"
        assert out.address == "Old Address 1"
    finally:
        await _cleanup(db_session, business, owner)


@pytest.mark.asyncio
async def test_update_moves_address_and_coordinates_together(db_session: AsyncSession) -> None:
    business, owner = await _make_business(db_session)
    try:
        out = await business_service.update_profile(
            db_session,
            business,
            BusinessProfileUpdateIn.model_validate(
                {"address": "New Address 5", "locationLat": 32.08, "locationLng": 34.79}
            ),
        )
        assert out.address == "New Address 5"
        assert out.location_lat == 32.08
        assert out.location_lng == 34.79
        # The ORM row itself, not just the response DTO — a stale `.business`
        # elsewhere in the same request must never see the two disagree.
        assert business.location_lat == 32.08
        assert business.location_lng == 34.79
    finally:
        await _cleanup(db_session, business, owner)


@pytest.mark.parametrize(
    "payload",
    [
        {"address": "New Address 5"},
        {"locationLat": 32.08},
        {"locationLng": 34.79},
        {"address": "New Address 5", "locationLat": 32.08},
    ],
)
def test_address_and_coordinates_reject_a_partial_set(payload: dict[str, object]) -> None:
    # Schema-level, no DB needed — the whole point is this never reaches a
    # session at all.
    with pytest.raises(ValidationError):
        BusinessProfileUpdateIn.model_validate(payload)


@pytest.mark.parametrize("field", ["name", "category", "address", "locationLat", "locationLng"])
def test_explicit_null_is_rejected_for_non_clearable_fields(field: str) -> None:
    with pytest.raises(ValidationError):
        BusinessProfileUpdateIn.model_validate({field: None})


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
async def test_get_profile_returns_current_record_and_coordinates(db_session: AsyncSession) -> None:
    business, owner = await _make_business(db_session)
    try:
        out = await business_service.get_profile(db_session, business)
        assert out.id == business.id
        assert out.registration_number == business.registration_number
        assert out.location_lat == business.location_lat
        assert out.location_lng == business.location_lng
    finally:
        await _cleanup(db_session, business, owner)


# ─── Contact person (owner) resolution ───────────────────────────────────────


@pytest.mark.asyncio
async def test_profile_contact_is_the_owner_membership_not_the_caller(db_session: AsyncSession) -> None:
    """A MANAGER or CASHIER reading (or editing) the profile must still see
    the real owner as the contact person, never themselves."""
    business, owner = await _make_business(db_session)
    try:
        manager = await _add_member(db_session, business, BusinessMembershipRole.MANAGER)
        out = await business_service.get_profile(db_session, business)
        assert out.owner_name == owner.name
        assert out.owner_email == owner.email
        assert out.owner_name != manager.name
    finally:
        await _cleanup(db_session, business, owner, manager)


@pytest.mark.asyncio
async def test_profile_contact_picks_the_earliest_owner_when_there_is_more_than_one(db_session: AsyncSession) -> None:
    business, first_owner = await _make_business(db_session)
    try:
        second_owner = await _add_member(db_session, business, BusinessMembershipRole.OWNER)
        out = await business_service.get_profile(db_session, business)
        assert out.owner_name == first_owner.name
        assert out.owner_name != second_owner.name
    finally:
        await _cleanup(db_session, business, first_owner, second_owner)


@pytest.mark.asyncio
async def test_profile_contact_is_null_rather_than_crashing_with_no_owner_membership(db_session: AsyncSession) -> None:
    business, legacy_owner_fk_user = await _make_business(db_session, role=BusinessMembershipRole.MANAGER)
    try:
        out = await business_service.get_profile(db_session, business)
        assert out.owner_name is None
        assert out.owner_email is None
    finally:
        await _cleanup(db_session, business, legacy_owner_fk_user)


@pytest.mark.asyncio
async def test_update_profile_response_still_reflects_the_owner_contact(db_session: AsyncSession) -> None:
    business, owner = await _make_business(db_session)
    try:
        out = await business_service.update_profile(
            db_session, business, BusinessProfileUpdateIn.model_validate({"name": "Renamed Biz"})
        )
        assert out.owner_name == owner.name
    finally:
        await _cleanup(db_session, business, owner)

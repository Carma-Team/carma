"""Business profile read/update (CAR-341) — auth guards and the field boundary.

Two things that would hurt if they broke:
  1. `registration_number` (the ח.פ./tax id) becoming editable through this
     endpoint despite `BusinessProfileUpdateIn` never declaring it — there is
     no verification workflow for changing it yet (see the approved design's
     own "flagged, not built" note), so it must stay server-side read-only no
     matter what a client sends.
  2. An explicit null reaching a NOT-NULL column (`name`, `category`) and
     failing ugly at commit instead of a clean 422 — `name_he` is the one
     field that must still accept an explicit null (it's nullable on the
     model, and null is how a caller clears the override).

`address`/`location_lat`/`location_lng` moved to branch data (CAR-341
continuation, see `test_business_branches.py`) — this file only checks that
`BusinessProfileOut` still mirrors the default branch correctly, never that
editing one works, since `BusinessProfileUpdateIn` no longer accepts them.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.models import (
    Business,
    BusinessBranch,
    BusinessCategory,
    BusinessMembership,
    BusinessMembershipRole,
    User,
    UserRole,
)
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
    # Every business needs at least one branch as of the CAR-341 continuation
    # (`services.business._default_branch` asserts one exists) — mirrors
    # `business`'s own address/coordinates, same as a real approval or the
    # 0034_business_branches backfill would produce.
    db.add(
        BusinessBranch(
            business_id=business.id,
            address=business.address,
            location_lat=business.location_lat,
            location_lng=business.location_lng,
        )
    )
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


@pytest.mark.parametrize("field", ["name", "category"])
def test_explicit_null_is_rejected_for_non_clearable_fields(field: str) -> None:
    with pytest.raises(ValidationError):
        BusinessProfileUpdateIn.model_validate({field: None})


def test_update_in_has_no_location_fields() -> None:
    # The server-side half of "Business Details isn't a second
    # address-editing path" — proven at the schema level, not just that the
    # web form hides the fields.
    assert "address" not in BusinessProfileUpdateIn.model_fields
    assert "location_lat" not in BusinessProfileUpdateIn.model_fields
    assert "location_lng" not in BusinessProfileUpdateIn.model_fields


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


@pytest.mark.asyncio
async def test_get_profile_reflects_a_branch_edit_not_the_frozen_business_columns(db_session: AsyncSession) -> None:
    """Proves the profile mirror is live, not a copy frozen at creation —
    `Business.address/location_lat/location_lng` never change again after
    this migration, so a stale mirror would silently diverge the moment
    someone edits the default branch through `/api/business/branches`.
    """
    business, owner = await _make_business(db_session)
    try:
        default_branch = await business_service._default_branch(db_session, business.id)
        default_branch.address = "New Address 5"
        default_branch.location_lat = 32.08
        default_branch.location_lng = 34.79
        await db_session.commit()

        out = await business_service.get_profile(db_session, business)
        assert out.address == "New Address 5"
        assert out.location_lat == 32.08
        assert out.location_lng == 34.79
        # The legacy columns are frozen — this is the divergence the mirror
        # exists to hide from anything still reading BusinessProfileOut.
        assert business.address != out.address
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

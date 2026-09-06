"""Business branch CRUD (CAR-341 continuation).

Three invariants that would hurt if they broke:
  1. `address` changing without `location_lat`/`location_lng` moving with it
     on a branch — same hazard `BusinessProfileUpdateIn` used to guard before
     location moved to branch data.
  2. A branch belonging to another business becoming reachable via id — same
     404-not-403 rule `_owned_reward` uses, so a business can't even confirm
     a competitor's branch id exists.
  3. The last active branch of a business becoming deactivatable — the
     approved design's own "every business has at least one branch" promise.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException
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
from app.schemas.business_branch import BranchCreateIn, BranchUpdateIn
from app.services import business as business_service

# ─── Auth guards (no DB) ─────────────────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/api/business/branches"),
        ("POST", "/api/business/branches"),
        ("PATCH", "/api/business/branches/some-id"),
    ],
)
async def test_business_branches_require_auth(method: str, path: str) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.request(method, path, json={})
    assert r.status_code == 401, f"{method} {path} must reject anonymous callers before any handler logic"


# ─── Fixtures ─────────────────────────────────────────────────────────────────


async def _make_business(db: AsyncSession, *, with_branch: bool = True) -> tuple[Business, User]:
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
        category=BusinessCategory.FOOD,
        location_lat=32.07,
        location_lng=34.78,
        address="Old Address 1",
        registration_number=f"51{uuid.uuid4().int % 10**7:07d}",
    )
    db.add(business)
    await db.flush()
    db.add(BusinessMembership(user_id=owner.id, business_id=business.id, role=BusinessMembershipRole.OWNER))
    if with_branch:
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


async def _add_branch(db: AsyncSession, business: Business, *, address: str, lat: float, lng: float) -> None:
    """A second branch, added directly rather than through `create_branch`,
    for tests that only care that more than one branch exists."""
    dto = BranchCreateIn.model_validate({"address": address, "locationLat": lat, "locationLng": lng})
    await business_service.create_branch(db, business, dto)


async def _cleanup(db: AsyncSession, business: Business, *users: User) -> None:
    await db.delete(business)
    await db.commit()
    for user in users:
        reloaded = await db.get(User, user.id)
        if reloaded is not None:
            await db.delete(reloaded)
            await db.commit()


# ─── Schema-level invariants ──────────────────────────────────────────────────


@pytest.mark.parametrize(
    "payload",
    [
        {"address": "New Address 5"},
        {"locationLat": 32.08},
        {"locationLng": 34.79},
        {"address": "New Address 5", "locationLat": 32.08},
    ],
)
def test_branch_update_rejects_a_partial_location_set(payload: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        BranchUpdateIn.model_validate(payload)


@pytest.mark.parametrize("field", ["address", "locationLat", "locationLng", "isActive"])
def test_branch_update_rejects_explicit_null_on_non_clearable_fields(field: str) -> None:
    with pytest.raises(ValidationError):
        BranchUpdateIn.model_validate({field: None})


def test_branch_update_allows_clearing_the_name() -> None:
    # `name` is the one field the approved design lets a caller clear — the
    # UI then falls back to showing the address alone.
    dto = BranchUpdateIn.model_validate({"name": None})
    assert "name" in dto.model_fields_set
    assert dto.name is None


# ─── CRUD ──────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_branch_persists_name_address_and_coordinates(db_session: AsyncSession) -> None:
    business, owner = await _make_business(db_session)
    try:
        dto = BranchCreateIn.model_validate(
            {"name": "Dizengoff", "address": "Dizengoff 210", "locationLat": 32.08, "locationLng": 34.77}
        )
        out = await business_service.create_branch(db_session, business, dto)
        assert out.name == "Dizengoff"
        assert out.address == "Dizengoff 210"
        assert out.is_active is True

        branches = await business_service.list_branches(db_session, business)
        assert len(branches) == 2
        assert out.id in {b.id for b in branches}
    finally:
        await _cleanup(db_session, business, owner)


@pytest.mark.asyncio
async def test_create_branch_allows_no_name(db_session: AsyncSession) -> None:
    business, owner = await _make_business(db_session)
    try:
        dto = BranchCreateIn.model_validate({"address": "Ramat Gan Mall", "locationLat": 32.08, "locationLng": 34.82})
        out = await business_service.create_branch(db_session, business, dto)
        assert out.name is None
    finally:
        await _cleanup(db_session, business, owner)


@pytest.mark.asyncio
async def test_update_branch_moves_address_and_coordinates_together(db_session: AsyncSession) -> None:
    business, owner = await _make_business(db_session)
    try:
        [branch] = await business_service.list_branches(db_session, business)
        dto = BranchUpdateIn.model_validate({"address": "New Address 5", "locationLat": 32.09, "locationLng": 34.80})
        out = await business_service.update_branch(db_session, business, branch.id, dto)
        assert out.address == "New Address 5"
        assert out.location_lat == 32.09
        assert out.location_lng == 34.80
    finally:
        await _cleanup(db_session, business, owner)


@pytest.mark.asyncio
async def test_update_branch_on_another_business_is_404(db_session: AsyncSession) -> None:
    business_a, owner_a = await _make_business(db_session)
    business_b, owner_b = await _make_business(db_session)
    try:
        [branch_a] = await business_service.list_branches(db_session, business_a)
        dto = BranchUpdateIn.model_validate({"name": "Hijacked"})
        with pytest.raises(HTTPException) as exc_info:
            await business_service.update_branch(db_session, business_b, branch_a.id, dto)
        assert exc_info.value.status_code == 404
    finally:
        await _cleanup(db_session, business_a, owner_a)
        await _cleanup(db_session, business_b, owner_b)


@pytest.mark.asyncio
async def test_cannot_deactivate_the_last_active_branch(db_session: AsyncSession) -> None:
    business, owner = await _make_business(db_session)
    try:
        [branch] = await business_service.list_branches(db_session, business)
        dto = BranchUpdateIn.model_validate({"isActive": False})
        with pytest.raises(HTTPException) as exc_info:
            await business_service.update_branch(db_session, business, branch.id, dto)
        assert exc_info.value.status_code == 409
        assert exc_info.value.detail["code"] == business_service.LAST_ACTIVE_BRANCH  # type: ignore[index]
    finally:
        await _cleanup(db_session, business, owner)


@pytest.mark.asyncio
async def test_can_deactivate_a_branch_when_another_stays_active(db_session: AsyncSession) -> None:
    business, owner = await _make_business(db_session)
    try:
        [first] = await business_service.list_branches(db_session, business)
        await _add_branch(db_session, business, address="Second branch", lat=32.1, lng=34.9)

        dto = BranchUpdateIn.model_validate({"isActive": False})
        out = await business_service.update_branch(db_session, business, first.id, dto)
        assert out.is_active is False

        branches = {b.id: b for b in await business_service.list_branches(db_session, business)}
        assert branches[first.id].is_active is False
        assert sum(1 for b in branches.values() if b.is_active) == 1
    finally:
        await _cleanup(db_session, business, owner)


@pytest.mark.asyncio
async def test_reactivating_a_branch_is_allowed(db_session: AsyncSession) -> None:
    business, owner = await _make_business(db_session)
    try:
        [first] = await business_service.list_branches(db_session, business)
        await _add_branch(db_session, business, address="Second branch", lat=32.1, lng=34.9)

        deactivate = BranchUpdateIn.model_validate({"isActive": False})
        reactivate = BranchUpdateIn.model_validate({"isActive": True})
        await business_service.update_branch(db_session, business, first.id, deactivate)
        out = await business_service.update_branch(db_session, business, first.id, reactivate)
        assert out.is_active is True
    finally:
        await _cleanup(db_session, business, owner)


# ─── Profile mirror ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_default_branch_is_the_earliest_created_active_one(db_session: AsyncSession) -> None:
    business, owner = await _make_business(db_session)
    try:
        [first] = await business_service.list_branches(db_session, business)
        await _add_branch(db_session, business, address="Newer branch", lat=32.2, lng=34.6)

        default = await business_service._default_branch(db_session, business.id)
        assert default.id == first.id

        # Deactivating the earliest one hands the mirror to the next-oldest
        # active branch rather than raising.
        deactivate = BranchUpdateIn.model_validate({"isActive": False})
        await business_service.update_branch(db_session, business, first.id, deactivate)
        default_after = await business_service._default_branch(db_session, business.id)
        assert default_after.id != first.id
    finally:
        await _cleanup(db_session, business, owner)

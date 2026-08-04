"""Business reward CRUD — auth guards and the ownership boundary.

The two things that would hurt if they broke:
  1. A driver (or an anonymous caller) must never reach the business catalog.
  2. One business must never see or mutate another's rewards, and a reward that
     drivers already redeemed must not be deletable out from under their vouchers.

The guard tests run in-process via ASGITransport (no DB). The ownership and
delete-rule tests need real rows, so they use the db_session fixture and skip
when no Postgres is reachable — same contract as the other *_db-style tests.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.main import app
from app.models import Business, BusinessCategory, Redemption, RedemptionStatus, Reward, User, UserRole
from app.schemas.reward import BusinessRewardIn, BusinessRewardPatchIn
from app.services import business as business_service
from app.services import users as users_service

# ─── Auth guards (no DB) ─────────────────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/api/business/rewards"),
        ("POST", "/api/business/rewards"),
        ("PATCH", "/api/business/rewards/any-id"),
        ("DELETE", "/api/business/rewards/any-id"),
    ],
)
async def test_business_rewards_require_auth(method: str, path: str) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.request(method, path, json={})
    assert r.status_code == 401, f"{method} {path} must reject anonymous callers before any handler logic"


# ─── Fixtures for the DB-backed tests ────────────────────────────────────────


async def _make_business(db: AsyncSession, *, category: BusinessCategory = BusinessCategory.FOOD) -> Business:
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
        name=f"Test Biz {uuid.uuid4().hex[:6]}",
        category=category,
        location_lat=32.07,
        location_lng=34.78,
    )
    db.add(business)
    await db.commit()
    await db.refresh(business)
    return business


async def _cleanup(db: AsyncSession, *businesses: Business) -> None:
    for business in businesses:
        owner_id = business.owner_user_id
        await db.delete(business)  # rewards cascade with the business
        await db.commit()
        if owner_id:
            owner = await db.get(User, owner_id)
            if owner is not None:
                await db.delete(owner)
                await db.commit()


def _reward_payload(**overrides: object) -> BusinessRewardIn:
    data: dict[str, object] = {
        "titleHe": "קפה חינם",
        "descriptionHe": "כוס קפה על חשבון הבית",
        "costPoints": 50,
        "stock": 10,
    }
    data.update(overrides)
    return BusinessRewardIn.model_validate(data)


# ─── Create / list / update ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_defaults_category_to_the_business(db_session: AsyncSession) -> None:
    business = await _make_business(db_session, category=BusinessCategory.FUEL)
    try:
        out = await business_service.create_reward(db_session, business, _reward_payload())
        # No category sent → the reward inherits the business's own, not OTHER.
        assert out.category == "fuel"
        assert out.business_id == business.id, "the reward must land in the caller's own catalog"
    finally:
        await _cleanup(db_session, business)


@pytest.mark.asyncio
async def test_list_includes_inactive_rewards(db_session: AsyncSession) -> None:
    business = await _make_business(db_session)
    try:
        await business_service.create_reward(db_session, business, _reward_payload(isActive=True))
        await business_service.create_reward(db_session, business, _reward_payload(isActive=False))

        result = await business_service.list_rewards(db_session, business)
        rewards = result["rewards"]
        assert isinstance(rewards, list)
        # The driver-facing list filters is_active; the owner's dashboard must not.
        assert len(rewards) == 2
        assert {r.is_active for r in rewards} == {True, False}
    finally:
        await _cleanup(db_session, business)


@pytest.mark.asyncio
async def test_patch_applies_only_sent_fields(db_session: AsyncSession) -> None:
    business = await _make_business(db_session)
    try:
        created = await business_service.create_reward(db_session, business, _reward_payload(costPoints=50, stock=10))

        patched = await business_service.update_reward(
            db_session,
            business,
            created.id,
            BusinessRewardPatchIn.model_validate({"costPoints": 80}),
        )
        assert patched.cost_points == 80
        assert patched.stock == 10, "a field absent from the PATCH body must be left alone"
        assert patched.title_he == created.title_he
    finally:
        await _cleanup(db_session, business)


@pytest.mark.asyncio
async def test_unknown_category_is_rejected(db_session: AsyncSession) -> None:
    business = await _make_business(db_session)
    try:
        with pytest.raises(HTTPException) as exc:
            await business_service.create_reward(db_session, business, _reward_payload(category="spaceships"))
        assert exc.value.status_code == 400
    finally:
        await _cleanup(db_session, business)


# ─── Ownership boundary ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_another_business_cannot_see_or_touch_the_reward(db_session: AsyncSession) -> None:
    owner_biz = await _make_business(db_session)
    other_biz = await _make_business(db_session)
    try:
        created = await business_service.create_reward(db_session, owner_biz, _reward_payload())

        listed = await business_service.list_rewards(db_session, other_biz)
        assert listed["rewards"] == [], "another business's catalog must not appear in this one's list"

        # 404 rather than 403 on both — a 403 would confirm the id exists.
        with pytest.raises(HTTPException) as patch_exc:
            await business_service.update_reward(
                db_session, other_biz, created.id, BusinessRewardPatchIn.model_validate({"costPoints": 1})
            )
        assert patch_exc.value.status_code == 404

        with pytest.raises(HTTPException) as delete_exc:
            await business_service.delete_reward(db_session, other_biz, created.id)
        assert delete_exc.value.status_code == 404
    finally:
        await _cleanup(db_session, owner_biz, other_biz)


# ─── Delete rule ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_delete_removes_a_reward_with_no_vouchers(db_session: AsyncSession) -> None:
    business = await _make_business(db_session)
    try:
        created = await business_service.create_reward(db_session, business, _reward_payload())
        await business_service.delete_reward(db_session, business, created.id)
        assert await db_session.get(Reward, created.id) is None
    finally:
        await _cleanup(db_session, business)


@pytest.mark.asyncio
async def test_delete_is_refused_once_a_voucher_was_issued(db_session: AsyncSession) -> None:
    business = await _make_business(db_session)
    driver = User(email=f"_drv_{uuid.uuid4().hex[:10]}@carmatest.co.il", password_hash="x", name="Driver")
    db_session.add(driver)
    await db_session.commit()
    try:
        created = await business_service.create_reward(db_session, business, _reward_payload())
        db_session.add(
            Redemption(
                user_id=driver.id,
                reward_id=created.id,
                qr_code=uuid.uuid4().hex[:12].upper(),
                status=RedemptionStatus.PENDING,
                expires_at=datetime.now(UTC) + timedelta(minutes=5),
            )
        )
        await db_session.commit()

        with pytest.raises(HTTPException) as exc:
            await business_service.delete_reward(db_session, business, created.id)
        assert exc.value.status_code == 409
        # The reward — and therefore the driver's voucher history — survives.
        assert await db_session.get(Reward, created.id) is not None
    finally:
        await db_session.delete(driver)  # redemptions cascade with the user
        await db_session.commit()
        await _cleanup(db_session, business)


# ─── UserOut business fields ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_profile_out_carries_business_fields(db_session: AsyncSession) -> None:
    business = await _make_business(db_session, category=BusinessCategory.ENTERTAINMENT)
    assert business.owner_user_id
    owner = await db_session.get(User, business.owner_user_id)
    assert owner is not None
    try:
        out = await users_service.profile_out(db_session, owner)
        # RewardFormScreen categorises new rewards from businessCategory.
        assert out.business_id == business.id
        assert out.business_category == "entertainment"
    finally:
        await _cleanup(db_session, business)


@pytest.mark.asyncio
async def test_profile_out_leaves_business_fields_empty_for_a_driver(db_session: AsyncSession) -> None:
    driver = User(email=f"_drv_{uuid.uuid4().hex[:10]}@carmatest.co.il", password_hash="x", name="Driver")
    db_session.add(driver)
    await db_session.commit()
    try:
        out = await users_service.profile_out(db_session, driver)
        assert out.business_id is None and out.business_category is None
    finally:
        await db_session.delete(driver)
        await db_session.commit()

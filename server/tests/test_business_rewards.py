"""Business reward CRUD — auth guards and the ownership boundary.

The two things that would hurt if they broke:
  1. A driver (or an anonymous caller) must never reach the business catalog.
  2. One business must never see or mutate another's rewards, and archiving a
     reward (CAR-111) must never disturb a voucher a driver already holds.

The guard tests run in-process via ASGITransport (no DB). The ownership and
archive-rule tests need real rows, so they use the db_session fixture and skip
when no Postgres is reachable — same contract as the other *_db-style tests.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token
from app.main import app
from app.models import Business, BusinessCategory, Redemption, RedemptionStatus, Reward, User, UserRole
from app.schemas.reward import BusinessRewardIn, BusinessRewardPatchIn
from app.services import business as business_service
from app.services import rewards as rewards_service
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
        ("GET", "/api/business/rewards/any-id/live-vouchers"),
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

        with pytest.raises(HTTPException) as archive_exc:
            await business_service.archive_reward(db_session, other_biz, created.id)
        assert archive_exc.value.status_code == 404
    finally:
        await _cleanup(db_session, owner_biz, other_biz)


# ─── Archive rule (CAR-111) ──────────────────────────────────────────────────


def _voucher(
    reward_id: str,
    user_id: str,
    business_id: str,
    *,
    status: RedemptionStatus = RedemptionStatus.PENDING,
    expires_in: timedelta = timedelta(days=1),
) -> Redemption:
    return Redemption(
        user_id=user_id,
        reward_id=reward_id,
        business_id=business_id,
        points_cost=10,
        qr_code=uuid.uuid4().hex[:12].upper(),
        status=status,
        expires_at=datetime.now(UTC) + expires_in,
        settled_at=None if status == RedemptionStatus.PENDING else datetime.now(UTC),
    )


@pytest.mark.asyncio
async def test_archive_sets_archived_at_and_keeps_the_row(db_session: AsyncSession) -> None:
    business = await _make_business(db_session)
    try:
        created = await business_service.create_reward(db_session, business, _reward_payload())
        await business_service.archive_reward(db_session, business, created.id)

        reward = await db_session.get(Reward, created.id)
        assert reward is not None, "archiving must not remove the row"
        assert reward.archived_at is not None
        assert reward.is_active is True, "archiving must not touch is_active"
    finally:
        await _cleanup(db_session, business)


@pytest.mark.asyncio
async def test_archive_succeeds_once_a_voucher_was_issued(db_session: AsyncSession) -> None:
    business = await _make_business(db_session)
    driver = User(email=f"_drv_{uuid.uuid4().hex[:10]}@carmatest.co.il", password_hash="x", name="Driver")
    db_session.add(driver)
    await db_session.commit()
    try:
        created = await business_service.create_reward(db_session, business, _reward_payload())
        voucher = _voucher(created.id, driver.id, business.id)
        db_session.add(voucher)
        await db_session.commit()
        await db_session.refresh(voucher)

        # No 409, no exception — an issued voucher no longer blocks this.
        await business_service.archive_reward(db_session, business, created.id)

        reward = await db_session.get(Reward, created.id)
        assert reward is not None and reward.archived_at is not None
        # The driver's voucher — and therefore their history — survives.
        assert await db_session.get(Redemption, voucher.id) is not None
    finally:
        await db_session.delete(driver)  # redemptions cascade with the user
        await db_session.commit()
        await _cleanup(db_session, business)


@pytest.mark.asyncio
async def test_archived_reward_voucher_still_loads_and_can_be_consumed(db_session: AsyncSession) -> None:
    business = await _make_business(db_session)
    driver = User(email=f"_drv_{uuid.uuid4().hex[:10]}@carmatest.co.il", password_hash="x", name="Driver")
    db_session.add(driver)
    await db_session.commit()
    try:
        created = await business_service.create_reward(db_session, business, _reward_payload())
        voucher = _voucher(created.id, driver.id, business.id)
        db_session.add(voucher)
        await db_session.commit()
        await db_session.refresh(voucher)

        await business_service.archive_reward(db_session, business, created.id)

        # A scan still resolves the reward the voucher was issued for…
        peeked = await business_service.peek_voucher(db_session, business, voucher.qr_code)
        assert peeked.reward.id == created.id

        # …and consuming it works exactly as it would for a non-archived reward.
        consumed = await business_service.consume_voucher(db_session, business, voucher.qr_code)
        assert consumed.status == "used"
    finally:
        await db_session.delete(driver)
        await db_session.commit()
        await _cleanup(db_session, business)


@pytest.mark.asyncio
async def test_archived_reward_is_excluded_from_the_driver_marketplace(db_session: AsyncSession) -> None:
    business = await _make_business(db_session)
    driver = User(email=f"_drv_{uuid.uuid4().hex[:10]}@carmatest.co.il", password_hash="x", name="Driver")
    db_session.add(driver)
    await db_session.commit()
    try:
        created = await business_service.create_reward(db_session, business, _reward_payload())
        await business_service.archive_reward(db_session, business, created.id)

        listing = await rewards_service.list_rewards(db_session, driver.id, None)
        assert created.id not in {r.id for r in listing["rewards"]}
    finally:
        await db_session.delete(driver)
        await db_session.commit()
        await _cleanup(db_session, business)


@pytest.mark.asyncio
async def test_redeem_is_refused_for_an_archived_reward(db_session: AsyncSession) -> None:
    business = await _make_business(db_session)
    driver = User(email=f"_drv_{uuid.uuid4().hex[:10]}@carmatest.co.il", password_hash="x", name="Driver")
    db_session.add(driver)
    await db_session.commit()
    try:
        created = await business_service.create_reward(db_session, business, _reward_payload(costPoints=10))
        await business_service.archive_reward(db_session, business, created.id)

        with pytest.raises(HTTPException) as exc:
            await rewards_service.redeem(db_session, driver, created.id)
        assert exc.value.status_code == 404
    finally:
        await db_session.delete(driver)
        await db_session.commit()
        await _cleanup(db_session, business)


@pytest.mark.asyncio
async def test_redemption_history_still_loads_an_archived_reward(db_session: AsyncSession) -> None:
    business = await _make_business(db_session)
    driver = User(email=f"_drv_{uuid.uuid4().hex[:10]}@carmatest.co.il", password_hash="x", name="Driver")
    db_session.add(driver)
    await db_session.commit()
    try:
        created = await business_service.create_reward(db_session, business, _reward_payload())
        db_session.add(_voucher(created.id, driver.id, business.id))
        await db_session.commit()

        await business_service.archive_reward(db_session, business, created.id)

        history = await rewards_service.list_my_vouchers(db_session, driver.id)
        vouchers = history["vouchers"]
        assert len(vouchers) == 1
        assert vouchers[0].reward.id == created.id
        assert vouchers[0].reward.archived_at is not None
    finally:
        await db_session.delete(driver)
        await db_session.commit()
        await _cleanup(db_session, business)


@pytest.mark.asyncio
async def test_business_reward_list_still_includes_an_archived_reward(db_session: AsyncSession) -> None:
    # No business-statistics endpoint exists in this codebase (see PR notes) —
    # this is the one business-facing aggregate view that does exist, and it
    # must not silently drop archived rewards either.
    business = await _make_business(db_session)
    try:
        created = await business_service.create_reward(db_session, business, _reward_payload())
        await business_service.archive_reward(db_session, business, created.id)

        listed = await business_service.list_rewards(db_session, business)
        assert created.id in {r.id for r in listed["rewards"]}
    finally:
        await _cleanup(db_session, business)


@pytest.mark.asyncio
async def test_is_active_and_archived_at_are_independent(db_session: AsyncSession) -> None:
    business = await _make_business(db_session)
    try:
        created = await business_service.create_reward(db_session, business, _reward_payload(isActive=True))

        # is_active=false, archived_at=null — a plain, reversible deactivation.
        await business_service.update_reward(
            db_session, business, created.id, BusinessRewardPatchIn.model_validate({"isActive": False})
        )
        reward = await db_session.get(Reward, created.id)
        assert reward is not None
        assert reward.is_active is False and reward.archived_at is None

        # Reactivate, then archive — is_active=true, archived_at set.
        await business_service.update_reward(
            db_session, business, created.id, BusinessRewardPatchIn.model_validate({"isActive": True})
        )
        await business_service.archive_reward(db_session, business, created.id)
        reward = await db_session.get(Reward, created.id)
        assert reward is not None
        assert reward.is_active is True and reward.archived_at is not None

        # Deactivating an already-archived reward: both states hold at once.
        await business_service.update_reward(
            db_session, business, created.id, BusinessRewardPatchIn.model_validate({"isActive": False})
        )
        reward = await db_session.get(Reward, created.id)
        assert reward is not None
        assert reward.is_active is False and reward.archived_at is not None
    finally:
        await _cleanup(db_session, business)


# ─── Campaign expiry (CAR-131) ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_expired_reward_is_excluded_from_the_driver_marketplace(db_session: AsyncSession) -> None:
    business = await _make_business(db_session)
    driver = User(email=f"_drv_{uuid.uuid4().hex[:10]}@carmatest.co.il", password_hash="x", name="Driver")
    db_session.add(driver)
    await db_session.commit()
    try:
        created = await business_service.create_reward(
            db_session, business, _reward_payload(expiresAt=datetime.now(UTC) - timedelta(days=1))
        )

        listing = await rewards_service.list_rewards(db_session, driver.id, None)
        assert created.id not in {r.id for r in listing["rewards"]}
    finally:
        await db_session.delete(driver)
        await db_session.commit()
        await _cleanup(db_session, business)


@pytest.mark.asyncio
async def test_redeem_is_refused_for_an_expired_reward(db_session: AsyncSession) -> None:
    business = await _make_business(db_session)
    driver = User(email=f"_drv_{uuid.uuid4().hex[:10]}@carmatest.co.il", password_hash="x", name="Driver", points=1_000)
    db_session.add(driver)
    await db_session.commit()
    try:
        created = await business_service.create_reward(
            db_session, business, _reward_payload(costPoints=10, expiresAt=datetime.now(UTC) - timedelta(days=1))
        )

        with pytest.raises(HTTPException) as exc:
            await rewards_service.redeem(db_session, driver, created.id)
        assert exc.value.status_code == 409
        assert exc.value.detail["code"] == rewards_service.REWARD_CAMPAIGN_ENDED

        # The refusal rolls back, which expires every instance already in the
        # session — an explicit refresh, not a bare attribute read, is what
        # safely pulls them back (see `_cleanup`'s docstring in test_reward_stock.py).
        await db_session.refresh(driver)
        await db_session.refresh(business)
        assert driver.points == 1_000, "a refused redeem must not debit the driver"
    finally:
        await db_session.delete(driver)
        await db_session.commit()
        await _cleanup(db_session, business)


@pytest.mark.asyncio
async def test_expired_reward_still_in_the_business_list(db_session: AsyncSession) -> None:
    business = await _make_business(db_session)
    try:
        created = await business_service.create_reward(
            db_session, business, _reward_payload(expiresAt=datetime.now(UTC) - timedelta(days=1))
        )

        listed = await business_service.list_rewards(db_session, business)
        assert created.id in {r.id for r in listed["rewards"]}
    finally:
        await _cleanup(db_session, business)


@pytest.mark.asyncio
async def test_null_expires_at_is_listed_and_redeemable(db_session: AsyncSession) -> None:
    business = await _make_business(db_session)
    driver = User(email=f"_drv_{uuid.uuid4().hex[:10]}@carmatest.co.il", password_hash="x", name="Driver", points=1_000)
    db_session.add(driver)
    await db_session.commit()
    try:
        created = await business_service.create_reward(
            db_session, business, _reward_payload(costPoints=10, expiresAt=None)
        )

        listing = await rewards_service.list_rewards(db_session, driver.id, None)
        assert created.id in {r.id for r in listing["rewards"]}

        voucher = await rewards_service.redeem(db_session, driver, created.id)
        assert voucher.status == "pending"
    finally:
        await db_session.delete(driver)
        await db_session.commit()
        await _cleanup(db_session, business)


@pytest.mark.asyncio
async def test_a_reward_whose_campaign_has_not_yet_ended_is_still_redeemable(db_session: AsyncSession) -> None:
    business = await _make_business(db_session)
    driver = User(email=f"_drv_{uuid.uuid4().hex[:10]}@carmatest.co.il", password_hash="x", name="Driver", points=1_000)
    db_session.add(driver)
    await db_session.commit()
    try:
        created = await business_service.create_reward(
            db_session, business, _reward_payload(costPoints=10, expiresAt=datetime.now(UTC) + timedelta(days=1))
        )

        voucher = await rewards_service.redeem(db_session, driver, created.id)
        assert voucher.status == "pending"
    finally:
        await db_session.delete(driver)
        await db_session.commit()
        await _cleanup(db_session, business)


# ─── Live voucher count (CAR-111) ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_live_voucher_count_before_archive(db_session: AsyncSession) -> None:
    business = await _make_business(db_session)
    driver = User(email=f"_drv_{uuid.uuid4().hex[:10]}@carmatest.co.il", password_hash="x", name="Driver")
    db_session.add(driver)
    await db_session.commit()
    try:
        created = await business_service.create_reward(db_session, business, _reward_payload())
        assert await business_service.live_voucher_count(db_session, business, created.id) == 0

        db_session.add(_voucher(created.id, driver.id, business.id))
        db_session.add(_voucher(created.id, driver.id, business.id))
        await db_session.commit()

        assert await business_service.live_voucher_count(db_session, business, created.id) == 2
    finally:
        await db_session.delete(driver)
        await db_session.commit()
        await _cleanup(db_session, business)


@pytest.mark.asyncio
async def test_live_voucher_count_excludes_used_and_expired(db_session: AsyncSession) -> None:
    business = await _make_business(db_session)
    driver = User(email=f"_drv_{uuid.uuid4().hex[:10]}@carmatest.co.il", password_hash="x", name="Driver")
    db_session.add(driver)
    await db_session.commit()
    try:
        created = await business_service.create_reward(db_session, business, _reward_payload())
        db_session.add(_voucher(created.id, driver.id, business.id, status=RedemptionStatus.USED))
        db_session.add(_voucher(created.id, driver.id, business.id, status=RedemptionStatus.EXPIRED))
        # Lapsed but still stored as PENDING — expire_overdue hasn't swept it yet.
        # The count must key off expires_at, not the stored status.
        db_session.add(_voucher(created.id, driver.id, business.id, expires_in=timedelta(minutes=-5)))
        db_session.add(_voucher(created.id, driver.id, business.id))  # the one truly live voucher
        await db_session.commit()

        assert await business_service.live_voucher_count(db_session, business, created.id) == 1
    finally:
        await db_session.delete(driver)
        await db_session.commit()
        await _cleanup(db_session, business)


# ─── Live voucher count — HTTP layer (CAR-111) ───────────────────────────────


async def _business_with_headers(db: AsyncSession) -> tuple[Business, dict[str, str]]:
    """A business plus the Authorization header its owner would send."""
    business = await _make_business(db)
    owner = await db.get(User, business.owner_user_id)
    assert owner is not None
    token = create_access_token(user_id=owner.id, email=owner.email, phone=None, role=UserRole.BUSINESS)
    return business, {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_live_vouchers_http_returns_the_count_for_the_owning_business(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    business, headers = await _business_with_headers(db_session)
    driver = User(email=f"_drv_{uuid.uuid4().hex[:10]}@carmatest.co.il", password_hash="x", name="Driver")
    db_session.add(driver)
    await db_session.commit()
    try:
        created = await business_service.create_reward(db_session, business, _reward_payload())
        db_session.add(_voucher(created.id, driver.id, business.id))
        await db_session.commit()

        r = await db_api_client.get(f"/api/business/rewards/{created.id}/live-vouchers", headers=headers)
        assert r.status_code == 200
        assert r.json()["liveVouchers"] == 1
    finally:
        await db_session.delete(driver)
        await db_session.commit()
        await _cleanup(db_session, business)


@pytest.mark.asyncio
async def test_live_vouchers_http_is_not_found_for_another_businesss_reward(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    owner_biz = await _make_business(db_session)
    other_biz, other_headers = await _business_with_headers(db_session)
    try:
        created = await business_service.create_reward(db_session, owner_biz, _reward_payload())

        r = await db_api_client.get(f"/api/business/rewards/{created.id}/live-vouchers", headers=other_headers)
        assert r.status_code == 404
    finally:
        await _cleanup(db_session, owner_biz, other_biz)


@pytest.mark.asyncio
async def test_live_vouchers_http_is_not_found_for_an_unknown_reward(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    business, headers = await _business_with_headers(db_session)
    try:
        r = await db_api_client.get(f"/api/business/rewards/{uuid.uuid4().hex}/live-vouchers", headers=headers)
        assert r.status_code == 404
    finally:
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
        assert out.business_name == business.name
        # _make_business never sets name_he — the web shell falls back to
        # businessName itself, so a null here is the real, expected value.
        assert out.business_name_he is None
    finally:
        await _cleanup(db_session, business)


@pytest.mark.asyncio
async def test_profile_out_carries_the_hebrew_business_name_when_set(db_session: AsyncSession) -> None:
    business = await _make_business(db_session)
    business.name_he = "שם בעברית"
    await db_session.commit()
    assert business.owner_user_id
    owner = await db_session.get(User, business.owner_user_id)
    assert owner is not None
    try:
        out = await users_service.profile_out(db_session, owner)
        assert out.business_name_he == "שם בעברית"
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
        assert out.business_name is None and out.business_name_he is None
    finally:
        await db_session.delete(driver)
        await db_session.commit()

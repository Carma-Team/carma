"""Points reservation on live vouchers (CAR-73).

Issuing a voucher used to debit `User.points` on the spot, so a lapsed voucher
took points with it — nothing refunded them. This replaces that with a
reservation: `redeem` never writes `User.points`. What a driver can still spend
is `points - reserved`, where `reserved` is the sum of `points_cost` over their
live (PENDING and unexpired) vouchers — derived from the redemptions ledger,
never a stored counter, so it cannot drift from what it counts.

Expiry and cancellation need no release code: both simply stop being live and
drop out of the sum. `test_a_lapsed_voucher_frees_its_reservation_...` proves
that by never calling `expire_overdue` at all.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import inspect, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Business, BusinessCategory, Redemption, RedemptionStatus, Reward, User
from app.services import business as business_service
from app.services import rewards as rewards_service


async def _make_business(db: AsyncSession) -> Business:
    business = Business(
        name=f"Reserve Biz {uuid.uuid4().hex[:6]}",
        category=BusinessCategory.FOOD,
        location_lat=32.07,
        location_lng=34.78,
    )
    db.add(business)
    await db.commit()
    await db.refresh(business)
    return business


async def _make_reward(db: AsyncSession, business: Business, *, cost_points: int) -> Reward:
    reward = Reward(
        business_id=business.id,
        title_he="הטבת בדיקה",
        description_he="תיאור",
        category=business.category,
        cost_points=cost_points,
        stock=10,
    )
    db.add(reward)
    await db.commit()
    await db.refresh(reward)
    return reward


async def _make_driver(db: AsyncSession, *, points: int) -> User:
    driver = User(
        email=f"_reserve_{uuid.uuid4().hex[:10]}@carmatest.co.il",
        password_hash="x",
        name="Reserve Driver",
        points=points,
        total_points=points,
    )
    db.add(driver)
    await db.commit()
    await db.refresh(driver)
    return driver


async def _cleanup(db: AsyncSession, business_id: str, driver_id: str) -> None:
    driver = await db.get(User, driver_id)
    if driver is not None:
        await db.delete(driver)
    await db.commit()

    business = await db.get(Business, business_id)
    if business is not None:
        await db.delete(business)  # rewards cascade with the business
    await db.commit()


@pytest.mark.asyncio
async def test_issuing_a_voucher_leaves_points_unchanged_and_reserves_its_cost(db_session: AsyncSession) -> None:
    business = await _make_business(db_session)
    driver = await _make_driver(db_session, points=100)
    business_id, driver_id = business.id, driver.id
    try:
        reward = await _make_reward(db_session, business, cost_points=60)

        await rewards_service.redeem(db_session, driver, reward.id)

        balance = await db_session.scalar(select(User.points).where(User.id == driver_id))
        assert balance == 100, "issuing a voucher must not touch User.points"
        assert await rewards_service.reserved_points(db_session, driver_id) == 60
    finally:
        await _cleanup(db_session, business_id, driver_id)


@pytest.mark.asyncio
async def test_available_balance_blocks_a_second_voucher_that_would_exceed_it(db_session: AsyncSession) -> None:
    """100 points, a 60-point live voucher: available is 40, so a second 60 is refused."""
    business = await _make_business(db_session)
    driver = await _make_driver(db_session, points=100)
    business_id, driver_id = business.id, driver.id
    try:
        reward = await _make_reward(db_session, business, cost_points=60)

        await rewards_service.redeem(db_session, driver, reward.id)

        with pytest.raises(HTTPException) as exc:
            await rewards_service.redeem(db_session, driver, reward.id)
        assert exc.value.status_code == 400
        assert exc.value.detail == "Insufficient points"

        assert (
            await rewards_service.reserved_points(db_session, driver_id) == 60
        ), "the refused attempt must not have reserved anything"
    finally:
        await _cleanup(db_session, business_id, driver_id)


@pytest.mark.asyncio
async def test_a_lapsed_voucher_frees_its_reservation_with_nothing_having_swept_it(db_session: AsyncSession) -> None:
    """Backdated past its TTL, still PENDING — `expire_overdue` never runs here."""
    business = await _make_business(db_session)
    driver = await _make_driver(db_session, points=100)
    business_id, driver_id = business.id, driver.id
    try:
        reward = await _make_reward(db_session, business, cost_points=60)
        voucher = await rewards_service.redeem(db_session, driver, reward.id)
        assert await rewards_service.reserved_points(db_session, driver_id) == 60

        stale = await db_session.get(Redemption, voucher.id)
        assert stale is not None
        stale.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        await db_session.commit()

        assert await rewards_service.reserved_points(db_session, driver_id) == 0
        # Nothing swept the row — it is still PENDING in storage, just outside
        # its TTL, which is exactly what `live_voucher_where` excludes on.
        stored = await db_session.get(Redemption, voucher.id)
        assert stored is not None and stored.status is RedemptionStatus.PENDING
    finally:
        await _cleanup(db_session, business_id, driver_id)


@pytest.mark.asyncio
async def test_a_cancelled_voucher_frees_its_reservation_immediately(db_session: AsyncSession) -> None:
    """CANCELLED already exists in the enum; only the action that writes it is CAR-110."""
    business = await _make_business(db_session)
    driver = await _make_driver(db_session, points=100)
    business_id, driver_id = business.id, driver.id
    try:
        reward = await _make_reward(db_session, business, cost_points=60)
        voucher = await rewards_service.redeem(db_session, driver, reward.id)
        assert await rewards_service.reserved_points(db_session, driver_id) == 60

        cancelled = await db_session.get(Redemption, voucher.id)
        assert cancelled is not None
        cancelled.status = RedemptionStatus.CANCELLED
        cancelled.settled_at = datetime.now(UTC)
        await db_session.commit()

        assert await rewards_service.reserved_points(db_session, driver_id) == 0
    finally:
        await _cleanup(db_session, business_id, driver_id)


@pytest.mark.asyncio
async def test_a_consumed_voucher_stops_being_reserved(db_session: AsyncSession) -> None:
    """A USED voucher's points are charged (CAR-109), not reserved — it must drop out here."""
    business = await _make_business(db_session)
    driver = await _make_driver(db_session, points=100)
    business_id, driver_id = business.id, driver.id
    try:
        reward = await _make_reward(db_session, business, cost_points=60)
        voucher = await rewards_service.redeem(db_session, driver, reward.id)
        assert await rewards_service.reserved_points(db_session, driver_id) == 60

        await db_session.refresh(business)
        consumed = await business_service.consume_voucher(db_session, business, voucher.code)
        assert consumed.status == "used"

        assert await rewards_service.reserved_points(db_session, driver_id) == 0
    finally:
        await _cleanup(db_session, business_id, driver_id)


@pytest.mark.asyncio
async def test_total_points_is_never_touched_by_issuing_or_settling(db_session: AsyncSession) -> None:
    business = await _make_business(db_session)
    driver = await _make_driver(db_session, points=100)
    business_id, driver_id = business.id, driver.id
    try:
        reward = await _make_reward(db_session, business, cost_points=60)
        voucher = await rewards_service.redeem(db_session, driver, reward.id)

        stale = await db_session.get(Redemption, voucher.id)
        assert stale is not None
        stale.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        await db_session.commit()

        total = await db_session.scalar(select(User.total_points).where(User.id == driver_id))
        assert total == 100, "total_points is lifetime earned and must never move on spend"
    finally:
        await _cleanup(db_session, business_id, driver_id)


def test_no_reserved_points_column_exists_on_user() -> None:
    """CAR-73: reserved is always derived, never a second source of truth."""
    columns = {c.key for c in inspect(User).columns}
    assert "reserved_points" not in columns

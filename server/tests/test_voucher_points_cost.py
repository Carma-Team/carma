"""Redemption.points_cost — a price snapshot taken at issue time (CAR-70).

`Reward.cost_points` is what a driver pays to redeem today. Once a voucher
exists, its price must stop moving with that column — a business raising or
lowering a reward's price must not reprice a voucher already in a driver's
wallet. `points_cost` is written once, at redeem, from the live price at that
moment, and read back from the voucher itself from then on.
"""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Business, BusinessCategory, Redemption, Reward, User
from app.schemas.reward import VoucherOut
from app.services import rewards as rewards_service
from tests.test_business_vouchers import _cleanup


async def _make_business(db: AsyncSession) -> Business:
    business = Business(
        name=f"Price Biz {uuid.uuid4().hex[:6]}",
        category=BusinessCategory.FOOD,
        location_lat=32.07,
        location_lng=34.78,
    )
    db.add(business)
    await db.commit()
    await db.refresh(business)
    return business


async def _make_driver(db: AsyncSession, *, points: int = 1000) -> User:
    driver = User(
        email=f"_price_{uuid.uuid4().hex[:10]}@carmatest.co.il",
        password_hash="x",
        name="Price Driver",
        points=points,
    )
    db.add(driver)
    await db.commit()
    await db.refresh(driver)
    return driver


async def _make_reward(db: AsyncSession, business: Business, *, cost_points: int) -> Reward:
    reward = Reward(
        business_id=business.id,
        title_he="הטבת בדיקה",
        description_he="תיאור",
        category=business.category,
        cost_points=cost_points,
    )
    db.add(reward)
    await db.commit()
    await db.refresh(reward)
    return reward


async def test_changing_the_reward_price_does_not_reprice_an_issued_voucher(db_session: AsyncSession) -> None:
    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    try:
        reward = await _make_reward(db_session, business, cost_points=100)

        voucher: VoucherOut = await rewards_service.redeem(db_session, driver, reward.id)
        assert voucher.points_cost == 100

        reward.cost_points = 250
        db_session.add(reward)
        await db_session.commit()

        # Re-fetch the voucher's own row to prove the stored snapshot, not the
        # response object, survived the price change.
        stored = await db_session.get(Redemption, voucher.id)
        assert stored is not None
        assert stored.points_cost == 100, "an already-issued voucher must keep the price it was redeemed at"
    finally:
        await _cleanup(db_session, business, drivers=(driver,))


async def test_vouchers_issued_before_and_after_a_price_change_keep_different_prices(
    db_session: AsyncSession,
) -> None:
    business = await _make_business(db_session)
    driver = await _make_driver(db_session, points=1000)
    try:
        reward = await _make_reward(db_session, business, cost_points=50)

        before = await rewards_service.redeem(db_session, driver, reward.id)
        assert before.points_cost == 50

        reward.cost_points = 80
        db_session.add(reward)
        await db_session.commit()
        await db_session.refresh(reward)

        after = await rewards_service.redeem(db_session, driver, reward.id)
        assert after.points_cost == 80

        assert before.points_cost != after.points_cost
        assert before.points_cost == 50, "the earlier voucher must not drift toward the new price"
    finally:
        await _cleanup(db_session, business, drivers=(driver,))

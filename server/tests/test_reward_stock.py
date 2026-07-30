"""Reward stock as derived availability (CAR-47).

`Reward.stock` is the total the business allocated, not a counter: it is never
written back to, and what is left is derived from the redemptions ledger. Four
properties matter, and each is easy to break by "optimising" the count into a
stored column later:

  1. NULL stock means unlimited and must never read as sold out.
  2. A voucher releases its unit the moment its TTL lapses, with no job to run.
  3. A USED voucher holds its unit for good.
  4. Two drivers racing for the last unit produce exactly one voucher.

The last one is the reason `redeem` takes `FOR UPDATE` on the reward row, and it
needs two real connections to mean anything — see `_rival_session`.
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings
from app.models import Business, BusinessCategory, Redemption, RedemptionStatus, Reward, User
from app.services import rewards as rewards_service
from app.services.rewards import REWARD_OUT_OF_STOCK, available_units, claimed_by_reward


# ─── Availability arithmetic (no DB) ─────────────────────────────────────────
def test_null_stock_is_unlimited() -> None:
    # The old column default was 0, so every reward created without an explicit
    # stock sat at zero. Enforcing "0 means sold out" against those would have
    # made the whole marketplace unredeemable — NULL is what carries "no cap".
    assert available_units(None, 0) is None
    assert available_units(None, 9999) is None, "an uncapped reward never runs out, however many are claimed"


def test_zero_stock_is_sold_out() -> None:
    assert available_units(0, 0) == 0


def test_available_counts_down_from_the_allocation() -> None:
    assert available_units(10, 0) == 10
    assert available_units(10, 4) == 6
    assert available_units(10, 10) == 0


def test_available_floors_at_zero() -> None:
    assert available_units(5, 7) == 0, "an oversold reward reads as sold out, not negatively stocked"


def test_sold_out_is_distinguishable_from_unlimited() -> None:
    # The redeem guard tests `== 0`, which None must never satisfy — otherwise
    # every uncapped reward would start refusing.
    assert available_units(None, 0) != 0


# ─── Fixtures ────────────────────────────────────────────────────────────────
@asynccontextmanager
async def _rival_session() -> AsyncIterator[AsyncSession]:
    """A second session on its own engine — the other half of the race.

    Same construction as `test_points_atomicity._rival_session`, and for the same
    reason: two coroutines sharing one connection queue instead of contending, so
    the lock under test would never be exercised.
    """
    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    try:
        async with factory() as session:
            yield session
    finally:
        await engine.dispose()


async def _make_reward(db: AsyncSession, *, stock: int | None) -> tuple[Business, Reward]:
    business = Business(
        name=f"Stock Biz {uuid.uuid4().hex[:6]}",
        category=BusinessCategory.FOOD,
        location_lat=32.07,
        location_lng=34.78,
    )
    db.add(business)
    await db.flush()

    reward = Reward(
        business_id=business.id,
        title_he="הטבת בדיקה",
        description_he="תיאור",
        category=BusinessCategory.FOOD,
        cost_points=10,
        stock=stock,
    )
    db.add(reward)
    await db.commit()
    await db.refresh(reward)
    await db.refresh(business)
    return business, reward


async def _make_driver(db: AsyncSession, *, points: int = 10_000) -> User:
    driver = User(
        email=f"_stock_{uuid.uuid4().hex[:10]}@carmatest.co.il",
        password_hash="x",
        name="Stock Driver",
        points=points,
    )
    db.add(driver)
    await db.commit()
    await db.refresh(driver)
    return driver


def _voucher(reward: Reward, driver: User, *, status: RedemptionStatus, expires_in: timedelta) -> Redemption:
    code = uuid.uuid4().hex[:12].upper()
    return Redemption(
        user_id=driver.id,
        reward_id=reward.id,
        qr_code=code,
        qr_data=code,
        status=status,
        expires_at=datetime.now(UTC) + expires_in,
    )


async def _cleanup(db: AsyncSession, business_id: str, *driver_ids: str) -> None:
    """Takes ids, not instances, on purpose.

    A refused redeem rolls back, which expires every instance in the session —
    reading `driver.id` afterwards triggers a synchronous refresh and dies with
    `MissingGreenlet`. Plain strings cannot expire.
    """
    # Drivers first: redemptions cascade with the user, and Redemption.reward_id
    # has no cascade, so a reward cannot be dropped while a voucher still cites it.
    for driver_id in driver_ids:
        driver = await db.get(User, driver_id)
        if driver is not None:
            await db.delete(driver)
    await db.commit()

    business = await db.get(Business, business_id)
    if business is not None:
        await db.delete(business)  # rewards cascade with the business
    await db.commit()


# ─── The count itself ────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_lapsed_voucher_releases_its_unit(db_session: AsyncSession) -> None:
    """The property that removes the need for an expiry job."""
    business, reward = await _make_reward(db_session, stock=5)
    driver = await _make_driver(db_session)
    business_id, driver_id = business.id, driver.id
    try:
        db_session.add_all(
            [
                _voucher(reward, driver, status=RedemptionStatus.PENDING, expires_in=timedelta(minutes=5)),
                _voucher(reward, driver, status=RedemptionStatus.PENDING, expires_in=timedelta(minutes=-5)),
            ]
        )
        await db_session.commit()

        claimed = await claimed_by_reward(db_session, [reward.id])
        assert claimed.get(reward.id, 0) == 1, "only the live voucher still holds a unit"
        assert available_units(reward.stock, claimed.get(reward.id, 0)) == 4
    finally:
        await _cleanup(db_session, business_id, driver_id)


@pytest.mark.asyncio
async def test_used_voucher_holds_its_unit_past_the_ttl(db_session: AsyncSession) -> None:
    # A redeemed voucher consumed the unit for good — its TTL is irrelevant.
    business, reward = await _make_reward(db_session, stock=5)
    driver = await _make_driver(db_session)
    business_id, driver_id = business.id, driver.id
    try:
        db_session.add(_voucher(reward, driver, status=RedemptionStatus.USED, expires_in=timedelta(minutes=-60)))
        await db_session.commit()

        claimed = await claimed_by_reward(db_session, [reward.id])
        assert claimed.get(reward.id, 0) == 1, "a USED voucher keeps its unit however long ago it expired"
    finally:
        await _cleanup(db_session, business_id, driver_id)


@pytest.mark.asyncio
async def test_cancelled_voucher_releases_its_unit(db_session: AsyncSession) -> None:
    business, reward = await _make_reward(db_session, stock=5)
    driver = await _make_driver(db_session)
    business_id, driver_id = business.id, driver.id
    try:
        db_session.add(_voucher(reward, driver, status=RedemptionStatus.CANCELLED, expires_in=timedelta(minutes=5)))
        await db_session.commit()

        claimed = await claimed_by_reward(db_session, [reward.id])
        assert claimed.get(reward.id, 0) == 0, "a cancelled voucher holds nothing"
    finally:
        await _cleanup(db_session, business_id, driver_id)


@pytest.mark.asyncio
async def test_count_is_scoped_to_the_reward_asked_for(db_session: AsyncSession) -> None:
    business, reward = await _make_reward(db_session, stock=5)
    driver = await _make_driver(db_session)
    business_id, driver_id = business.id, driver.id
    try:
        db_session.add(_voucher(reward, driver, status=RedemptionStatus.PENDING, expires_in=timedelta(minutes=5)))
        await db_session.commit()

        assert await claimed_by_reward(db_session, []) == {}, "no ids means no query and no counts"
        other = await claimed_by_reward(db_session, [uuid.uuid4().hex])
        assert other == {}, "a reward with no redemptions is absent, not zero-filled"
    finally:
        await _cleanup(db_session, business_id, driver_id)


@pytest.mark.asyncio
async def test_stock_is_never_written_back_to(db_session: AsyncSession) -> None:
    """The allocation is business intent — issuing vouchers must not erode it."""
    business, reward = await _make_reward(db_session, stock=5)
    driver = await _make_driver(db_session)
    business_id, driver_id = business.id, driver.id
    try:
        await rewards_service.redeem(db_session, driver, reward.id)
        await db_session.refresh(reward)
        assert reward.stock == 5, "stock must still read as the total the business allocated"
    finally:
        await _cleanup(db_session, business_id, driver_id)


# ─── The guard on the issue path ─────────────────────────────────────────────
@pytest.mark.asyncio
async def test_redeem_refuses_once_the_allocation_is_taken(db_session: AsyncSession) -> None:
    """The headline of CAR-47: a reward with 2 units cannot issue a 3rd voucher."""
    business, reward = await _make_reward(db_session, stock=2)
    driver = await _make_driver(db_session)
    business_id, reward_id, driver_id = business.id, reward.id, driver.id
    try:
        await rewards_service.redeem(db_session, driver, reward.id)
        await rewards_service.redeem(db_session, driver, reward.id)

        before = await db_session.get(User, driver_id)
        assert before is not None
        points_before = before.points

        with pytest.raises(HTTPException) as exc:
            await rewards_service.redeem(db_session, driver, reward_id)
        assert exc.value.status_code == 409
        assert exc.value.detail["code"] == REWARD_OUT_OF_STOCK, "the client needs a code, not a message to parse"

        after = await db_session.get(User, driver_id)
        assert after is not None
        assert after.points == points_before, "a refused redeem must not debit the driver"
    finally:
        await _cleanup(db_session, business_id, driver_id)


@pytest.mark.asyncio
async def test_zero_stock_refuses_immediately(db_session: AsyncSession) -> None:
    business, reward = await _make_reward(db_session, stock=0)
    driver = await _make_driver(db_session)
    business_id, driver_id = business.id, driver.id
    try:
        with pytest.raises(HTTPException) as exc:
            await rewards_service.redeem(db_session, driver, reward.id)
        assert exc.value.status_code == 409
        assert exc.value.detail["code"] == REWARD_OUT_OF_STOCK
    finally:
        await _cleanup(db_session, business_id, driver_id)


@pytest.mark.asyncio
async def test_redeem_reopens_when_a_held_voucher_lapses(db_session: AsyncSession) -> None:
    # The whole point of deriving availability: the allocation is taken by
    # vouchers that expire, and issuing works again with no job having run.
    business, reward = await _make_reward(db_session, stock=1)
    driver = await _make_driver(db_session)
    business_id, driver_id = business.id, driver.id
    try:
        db_session.add(_voucher(reward, driver, status=RedemptionStatus.PENDING, expires_in=timedelta(minutes=-1)))
        await db_session.commit()

        voucher = await rewards_service.redeem(db_session, driver, reward.id)
        assert voucher.status == "pending", "the lapsed voucher released its unit, so this one must issue"
        assert voucher.reward.available == 0, "and it is now the one holding the only unit"
    finally:
        await _cleanup(db_session, business_id, driver_id)


@pytest.mark.asyncio
async def test_unlimited_reward_never_refuses(db_session: AsyncSession) -> None:
    business, reward = await _make_reward(db_session, stock=None)
    driver = await _make_driver(db_session)
    business_id, driver_id = business.id, driver.id
    try:
        for _ in range(5):
            voucher = await rewards_service.redeem(db_session, driver, reward.id)
        assert voucher.reward.available is None, "an uncapped reward reports unlimited, never a number"
    finally:
        await _cleanup(db_session, business_id, driver_id)


# ─── The race the row lock exists for ────────────────────────────────────────
@pytest.mark.asyncio
async def test_concurrent_redeems_of_the_last_unit_yield_exactly_one_voucher(db_session: AsyncSession) -> None:
    """Two drivers, one unit, two real connections.

    Without `FOR UPDATE` on the reward row both count 1 remaining before either
    inserts, and both get a voucher — the reward goes to −1 and one driver turns
    up at a counter with nothing to collect. With the lock the loser blocks until
    the winner commits, re-counts, and is refused.
    """
    business, reward = await _make_reward(db_session, stock=1)
    first = await _make_driver(db_session)
    second = await _make_driver(db_session)
    business_id = business.id
    first_id, second_id = first.id, second.id
    try:
        async with _rival_session() as rival:
            # Each racer loads its own User instance before the race, so neither
            # can be saved by the other's session state.
            mine = await db_session.get(User, first.id)
            theirs = await rival.get(User, second.id)
            assert mine is not None and theirs is not None

            results = await asyncio.gather(
                rewards_service.redeem(db_session, mine, reward.id),
                rewards_service.redeem(rival, theirs, reward.id),
                return_exceptions=True,
            )

        issued = [r for r in results if not isinstance(r, BaseException)]
        refused = [r for r in results if isinstance(r, HTTPException)]
        unexpected = [r for r in results if isinstance(r, BaseException) and not isinstance(r, HTTPException)]

        assert not unexpected, f"the race must fail cleanly, not blow up: {unexpected}"
        assert len(issued) == 1, f"exactly one voucher for one unit, got {len(issued)}"
        assert len(refused) == 1, "the loser must be refused, not silently served"
        assert refused[0].status_code == 409
        assert refused[0].detail["code"] == REWARD_OUT_OF_STOCK

        live = await db_session.scalar(
            select(func.count())
            .select_from(Redemption)
            .where(Redemption.reward_id == reward.id, Redemption.status == RedemptionStatus.PENDING)
        )
        assert live == 1, "the database must hold one voucher, whatever the callers were told"
    finally:
        await db_session.execute(delete(Redemption).where(Redemption.reward_id == reward.id))
        await db_session.commit()
        await _cleanup(db_session, business_id, first_id, second_id)

"""Cap a driver at 2 live vouchers per reward (CAR-71).

"Live" is the same predicate `claimed_by_reward` already uses: PENDING and
inside its TTL. USED, EXPIRED and CANCELLED never count, and a voucher whose
TTL lapsed frees its slot immediately, with no expiry job needed. The cap is
per (driver, reward) — nothing here limits how many *different* rewards a
driver can hold live vouchers for at once.
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
from app.services.rewards import (
    MAX_LIVE_VOUCHERS_PER_REWARD,
    VOUCHER_LIMIT_REACHED,
    _nearest_slot_opens_at,
    _retry_after_seconds,
)


# ─── retryAfterSeconds arithmetic (no DB) ────────────────────────────────────
def test_retry_after_seconds_rounds_up_not_down() -> None:
    now = datetime.now(UTC)
    # 0.4s left truncates to 0 under int() — that would tell a refused caller
    # the slot is already free, when redeeming again immediately still refuses.
    assert _retry_after_seconds(now + timedelta(milliseconds=400), now) == 1
    assert _retry_after_seconds(now + timedelta(seconds=9, milliseconds=1), now) == 10
    assert _retry_after_seconds(now + timedelta(seconds=10), now) == 10


def test_retry_after_seconds_floors_at_zero_for_a_non_positive_gap() -> None:
    now = datetime.now(UTC)
    assert _retry_after_seconds(now, now) == 0
    assert _retry_after_seconds(now - timedelta(seconds=1), now) == 0


def test_nearest_slot_opens_at_the_earliest_expiry_when_exactly_at_the_cap() -> None:
    # 2 live, cap 2 — unchanged from before pre-existing over-cap state was considered.
    e1, e2 = datetime(2030, 1, 1, tzinfo=UTC), datetime(2030, 1, 2, tzinfo=UTC)
    assert _nearest_slot_opens_at([e1, e2], cap=2) is e1


def test_nearest_slot_opens_at_skips_expiries_that_do_not_drop_below_the_cap() -> None:
    """The CAR-71 rollout case: a driver already over the new cap.

    3 live vouchers against a cap of 2 — the earliest expiring only brings the
    count to 2, still at the cap. A slot opens on the *second* expiry, which
    brings the count to 1.
    """
    e1 = datetime(2030, 1, 1, tzinfo=UTC)
    e2 = datetime(2030, 1, 2, tzinfo=UTC)
    e3 = datetime(2030, 1, 3, tzinfo=UTC)
    assert _nearest_slot_opens_at([e1, e2, e3], cap=2) is e2


@asynccontextmanager
async def _rival_session() -> AsyncIterator[AsyncSession]:
    """A second session on its own engine — see `test_reward_stock._rival_session`."""
    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    try:
        async with factory() as session:
            yield session
    finally:
        await engine.dispose()


async def _make_reward(db: AsyncSession, *, stock: int | None = None) -> tuple[Business, Reward]:
    business = Business(
        name=f"Cap Biz {uuid.uuid4().hex[:6]}",
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
        email=f"_cap_{uuid.uuid4().hex[:10]}@carmatest.co.il",
        password_hash="x",
        name="Cap Driver",
        points=points,
    )
    db.add(driver)
    await db.commit()
    await db.refresh(driver)
    return driver


def _voucher(
    reward: Reward, driver: User, *, status: RedemptionStatus = RedemptionStatus.PENDING, expires_in: timedelta
) -> Redemption:
    code = uuid.uuid4().hex[:12].upper()
    return Redemption(
        user_id=driver.id,
        reward_id=reward.id,
        points_cost=reward.cost_points,
        qr_code=code,
        qr_data=code,
        status=status,
        expires_at=datetime.now(UTC) + expires_in,
    )


async def _redemption_row_count(db: AsyncSession, user_id: str, reward_id: str) -> int:
    """Every row for this (driver, reward), any status — not just the live ones.

    A refused redeem must add none, so this is the count that proves "creates
    no redemption row" directly, rather than inferring it from the live count
    staying at 2.
    """
    count = await db.scalar(
        select(func.count())
        .select_from(Redemption)
        .where(Redemption.user_id == user_id, Redemption.reward_id == reward_id)
    )
    return count or 0


async def _cleanup(db: AsyncSession, business_id: str, *driver_ids: str) -> None:
    """Takes ids, not instances — see `test_reward_stock._cleanup` for why."""
    for driver_id in driver_ids:
        driver = await db.get(User, driver_id)
        if driver is not None:
            await db.delete(driver)
    await db.commit()

    business = await db.get(Business, business_id)
    if business is not None:
        await db.delete(business)
    await db.commit()


# ─── The cap itself ──────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_first_and_second_redeem_of_a_reward_both_succeed(db_session: AsyncSession) -> None:
    business, reward = await _make_reward(db_session)
    driver = await _make_driver(db_session)
    business_id, driver_id = business.id, driver.id
    try:
        first = await rewards_service.redeem(db_session, driver, reward.id)
        second = await rewards_service.redeem(db_session, driver, reward.id)
        assert first.status == "pending"
        assert second.status == "pending"
        assert first.id != second.id
    finally:
        await _cleanup(db_session, business_id, driver_id)


@pytest.mark.asyncio
async def test_third_live_redeem_of_the_same_reward_is_refused(db_session: AsyncSession) -> None:
    """The headline of CAR-71: a 3rd live voucher for one reward is refused."""
    business, reward = await _make_reward(db_session)
    driver = await _make_driver(db_session)
    business_id, reward_id, driver_id = business.id, reward.id, driver.id
    try:
        await rewards_service.redeem(db_session, driver, reward.id)
        await rewards_service.redeem(db_session, driver, reward.id)

        before = await db_session.get(User, driver_id)
        assert before is not None
        points_before = before.points
        rows_before = await _redemption_row_count(db_session, driver_id, reward_id)

        with pytest.raises(HTTPException) as exc:
            await rewards_service.redeem(db_session, driver, reward_id)
        assert exc.value.status_code == 409
        assert exc.value.detail["code"] == VOUCHER_LIMIT_REACHED, "the client needs a code, not a message to parse"
        assert exc.value.detail["retryAfterSeconds"] >= 0

        after = await db_session.get(User, driver_id)
        assert after is not None
        assert after.points == points_before, "a refused redeem must not debit the driver"
        # Exactly the two that succeeded — the refused attempt wrote nothing.
        assert await rewards_service.count_live_vouchers(db_session, reward_id) == 2
        assert (
            await _redemption_row_count(db_session, driver_id, reward_id) == rows_before
        ), "the refused attempt must create no redemption row at all, not merely leave the live count unchanged"
    finally:
        await _cleanup(db_session, business_id, driver_id)


@pytest.mark.asyncio
async def test_used_expired_and_cancelled_vouchers_do_not_count(db_session: AsyncSession) -> None:
    business, reward = await _make_reward(db_session)
    driver = await _make_driver(db_session)
    business_id, driver_id = business.id, driver.id
    try:
        db_session.add_all(
            [
                _voucher(reward, driver, status=RedemptionStatus.USED, expires_in=timedelta(days=-1)),
                _voucher(reward, driver, status=RedemptionStatus.EXPIRED, expires_in=timedelta(days=-1)),
                _voucher(reward, driver, status=RedemptionStatus.CANCELLED, expires_in=timedelta(days=5)),
            ]
        )
        await db_session.commit()

        first = await rewards_service.redeem(db_session, driver, reward.id)
        second = await rewards_service.redeem(db_session, driver, reward.id)
        assert first.status == "pending"
        assert second.status == "pending"
    finally:
        await _cleanup(db_session, business_id, driver_id)


@pytest.mark.asyncio
async def test_lapsed_voucher_frees_its_slot_immediately(db_session: AsyncSession) -> None:
    """No expiry job needed — the predicate is `expires_at`, not the stored status."""
    business, reward = await _make_reward(db_session)
    driver = await _make_driver(db_session)
    business_id, driver_id = business.id, driver.id
    try:
        db_session.add_all(
            [
                _voucher(reward, driver, expires_in=timedelta(minutes=5)),
                # Still stored PENDING — lazy expiry has not touched this row yet.
                _voucher(reward, driver, expires_in=timedelta(minutes=-5)),
            ]
        )
        await db_session.commit()

        voucher = await rewards_service.redeem(db_session, driver, reward.id)
        assert voucher.status == "pending", "the lapsed row must not count against the cap"
    finally:
        await _cleanup(db_session, business_id, driver_id)


@pytest.mark.asyncio
async def test_pre_cap_over_limit_state_reports_when_the_count_actually_drops(db_session: AsyncSession) -> None:
    """CAR-71 rollout: a driver who redeemed 3 times before this cap existed.

    Nothing before CAR-71 ever refused a redeem for holding too many live
    vouchers on one reward, and VOUCHER_TTL_DAYS gives such a row up to a week
    to still be live when this ships — so 3+ live vouchers for one (driver,
    reward) is state the cap must handle correctly, not assume away.

    `retryAfterSeconds` must not be the earliest expiry here: once it lapses
    the driver still holds 2 live vouchers, which is still the cap. The right
    answer is the *second* earliest — the one that actually drops the count
    to 1.
    """
    business, reward = await _make_reward(db_session)
    driver = await _make_driver(db_session)
    business_id, reward_id, driver_id = business.id, reward.id, driver.id
    try:
        db_session.add_all(
            [
                _voucher(reward, driver, expires_in=timedelta(minutes=5)),
                _voucher(reward, driver, expires_in=timedelta(minutes=20)),
                _voucher(reward, driver, expires_in=timedelta(minutes=45)),
            ]
        )
        await db_session.commit()

        assert (
            await rewards_service.count_live_vouchers(db_session, reward_id) == 3
        ), "the fixture must actually be over the cap, or this test proves nothing"

        with pytest.raises(HTTPException) as exc:
            await rewards_service.redeem(db_session, driver, reward_id)
        assert exc.value.detail["code"] == VOUCHER_LIMIT_REACHED

        retry_after = exc.value.detail["retryAfterSeconds"]
        assert 19 * 60 <= retry_after <= 20 * 60, (
            "must report the expiry that drops the count to 1 (~20min), not the "
            "one that only drops it to 2 (~5min) — still at the cap either way"
        )
    finally:
        await _cleanup(db_session, business_id, driver_id)


@pytest.mark.asyncio
async def test_cap_is_scoped_per_reward_not_per_driver(db_session: AsyncSession) -> None:
    """No global cap: 2 live vouchers on reward A must not block reward B."""
    business_a, reward_a = await _make_reward(db_session)
    business_b, reward_b = await _make_reward(db_session)
    driver = await _make_driver(db_session)
    driver_id = driver.id
    try:
        await rewards_service.redeem(db_session, driver, reward_a.id)
        await rewards_service.redeem(db_session, driver, reward_a.id)

        voucher = await rewards_service.redeem(db_session, driver, reward_b.id)
        assert voucher.status == "pending", "a driver at the cap on one reward must still redeem another"
    finally:
        await _cleanup(db_session, business_a.id, driver_id)
        await _cleanup(db_session, business_b.id)


@pytest.mark.asyncio
async def test_retry_after_seconds_matches_the_nearer_of_the_two_expiries(db_session: AsyncSession) -> None:
    business, reward = await _make_reward(db_session)
    driver = await _make_driver(db_session)
    business_id, reward_id, driver_id = business.id, reward.id, driver.id
    try:
        db_session.add_all(
            [
                _voucher(reward, driver, expires_in=timedelta(minutes=30)),
                _voucher(reward, driver, expires_in=timedelta(minutes=10)),
            ]
        )
        await db_session.commit()

        with pytest.raises(HTTPException) as exc:
            await rewards_service.redeem(db_session, driver, reward_id)

        retry_after = exc.value.detail["retryAfterSeconds"]
        assert 9 * 60 <= retry_after <= 10 * 60, "must report the nearer slot, not the farther one"
    finally:
        await _cleanup(db_session, business_id, driver_id)


@pytest.mark.asyncio
async def test_redeem_wires_the_rounding_policy_through_to_the_response(db_session: AsyncSession) -> None:
    """End-to-end sanity that `redeem` actually calls `_retry_after_seconds`.

    The rounding edge cases themselves are covered without a DB above — this
    only proves the wiring, so it uses a margin wide enough not to flake on
    scheduler jitter between the commit and the query.
    """
    business, reward = await _make_reward(db_session)
    driver = await _make_driver(db_session)
    business_id, reward_id, driver_id = business.id, reward.id, driver.id
    try:
        db_session.add_all(
            [
                _voucher(reward, driver, expires_in=timedelta(minutes=5)),
                _voucher(reward, driver, expires_in=timedelta(seconds=3)),
            ]
        )
        await db_session.commit()

        with pytest.raises(HTTPException) as exc:
            await rewards_service.redeem(db_session, driver, reward_id)

        assert 1 <= exc.value.detail["retryAfterSeconds"] <= 3, "must round up, never floor to 0 while still live"
    finally:
        await _cleanup(db_session, business_id, driver_id)


# ─── The race the reward's row lock also serialises ──────────────────────────
@pytest.mark.asyncio
async def test_one_existing_plus_two_concurrent_yields_exactly_two_live_vouchers(db_session: AsyncSession) -> None:
    """CAR-71 acceptance case: one live voucher already exists, two requests race
    for the one remaining slot on two real connections — exactly one must
    succeed and the database must end at exactly the cap.

    `redeem` already takes `FOR UPDATE` on the reward row for the stock race
    (CAR-47); that lock is per-reward, not per-caller, so it serialises this
    race too. Without it both requests could read "1 live" and both issue,
    landing the driver at 3.
    """
    business, reward = await _make_reward(db_session)
    driver = await _make_driver(db_session)
    business_id, reward_id, driver_id = business.id, reward.id, driver.id
    try:
        await rewards_service.redeem(db_session, driver, reward.id)

        async with _rival_session() as rival:
            mine = await db_session.get(User, driver.id)
            theirs = await rival.get(User, driver.id)
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
        assert len(issued) == 1, f"exactly one more voucher for one remaining slot, got {len(issued)}"
        assert len(refused) == 1
        assert refused[0].status_code == 409
        assert refused[0].detail["code"] == VOUCHER_LIMIT_REACHED

        live = await rewards_service.count_live_vouchers(db_session, reward_id)
        assert live == MAX_LIVE_VOUCHERS_PER_REWARD, "the database must hold exactly the cap, whatever callers saw"
    finally:
        await db_session.execute(delete(Redemption).where(Redemption.reward_id == reward_id))
        await db_session.commit()
        await _cleanup(db_session, business_id, driver_id)


@pytest.mark.asyncio
async def test_three_concurrent_first_time_redeems_yield_exactly_two_live_vouchers(db_session: AsyncSession) -> None:
    """CAR-71 acceptance case: no vouchers exist yet, three requests for the
    same (driver, reward) race on three real connections — exactly two must
    succeed and the database must end at exactly the cap, not three.
    """
    business, reward = await _make_reward(db_session)
    driver = await _make_driver(db_session)
    business_id, reward_id, driver_id = business.id, reward.id, driver.id
    try:
        async with _rival_session() as second, _rival_session() as third:
            mine = await db_session.get(User, driver.id)
            hers = await second.get(User, driver.id)
            theirs = await third.get(User, driver.id)
            assert mine is not None and hers is not None and theirs is not None

            results = await asyncio.gather(
                rewards_service.redeem(db_session, mine, reward.id),
                rewards_service.redeem(second, hers, reward.id),
                rewards_service.redeem(third, theirs, reward.id),
                return_exceptions=True,
            )

        issued = [r for r in results if not isinstance(r, BaseException)]
        refused = [r for r in results if isinstance(r, HTTPException)]
        unexpected = [r for r in results if isinstance(r, BaseException) and not isinstance(r, HTTPException)]

        assert not unexpected, f"the race must fail cleanly, not blow up: {unexpected}"
        assert (
            len(issued) == MAX_LIVE_VOUCHERS_PER_REWARD
        ), f"exactly 2 of 3 first-time redeems must land, got {len(issued)}"
        assert len(refused) == 1
        assert refused[0].status_code == 409
        assert refused[0].detail["code"] == VOUCHER_LIMIT_REACHED

        live = await rewards_service.count_live_vouchers(db_session, reward_id)
        assert live == MAX_LIVE_VOUCHERS_PER_REWARD, "the database must hold exactly the cap, whatever callers saw"
    finally:
        await db_session.execute(delete(Redemption).where(Redemption.reward_id == reward_id))
        await db_session.commit()
        await _cleanup(db_session, business_id, driver_id)

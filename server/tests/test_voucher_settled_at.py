"""settled_at — one timestamp for every terminal voucher state (CAR-120).

Before this, only `used_at` existed and only consume wrote it, so EXPIRED rows
had no settle time to order or page by. These cover the three write paths that
set it and the ordering property CAR-79's history pagination depends on.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Business, BusinessCategory, Redemption, RedemptionStatus, Reward, User, UserRole
from app.services import business as business_service
from app.services import rewards as rewards_service

# ─── Fixtures ────────────────────────────────────────────────────────────────


async def _make_business(db: AsyncSession) -> Business:
    owner = User(
        email=f"_setbiz_{uuid.uuid4().hex[:10]}@carmatest.co.il",
        password_hash="x",
        role=UserRole.BUSINESS,
        name="Settled Biz",
    )
    db.add(owner)
    await db.flush()

    business = Business(
        owner_user_id=owner.id,
        name=f"Settled Biz {uuid.uuid4().hex[:6]}",
        category=BusinessCategory.FOOD,
        location_lat=32.07,
        location_lng=34.78,
    )
    db.add(business)
    await db.commit()
    await db.refresh(business)
    return business


async def _make_driver(db: AsyncSession) -> User:
    driver = User(
        email=f"_setdrv_{uuid.uuid4().hex[:10]}@carmatest.co.il",
        password_hash="x",
        name="Settled Driver",
        points=1000,
    )
    db.add(driver)
    await db.commit()
    await db.refresh(driver)
    return driver


async def _make_reward(db: AsyncSession, business: Business) -> Reward:
    reward = Reward(
        business_id=business.id,
        title_he="שובר בדיקה",
        description_he="תיאור",
        category=business.category,
        cost_points=10,
        stock=50,
    )
    db.add(reward)
    await db.commit()
    await db.refresh(reward)
    return reward


def _voucher(
    reward: Reward,
    driver: User,
    *,
    status: RedemptionStatus = RedemptionStatus.PENDING,
    expires_in: timedelta = timedelta(days=1),
    used_at: datetime | None = None,
    settled_at: datetime | None = None,
) -> Redemption:
    code = uuid.uuid4().hex[:12].upper()
    return Redemption(
        user_id=driver.id,
        reward_id=reward.id,
        business_id=reward.business_id,
        points_cost=reward.cost_points,
        qr_code=code,
        qr_data=code,
        status=status,
        expires_at=datetime.now(UTC) + expires_in,
        used_at=used_at,
        settled_at=settled_at,
    )


async def _cleanup(db: AsyncSession, business: Business, *drivers: User) -> None:
    for driver in drivers:
        await db.delete(driver)
    await db.commit()
    await db.refresh(business)
    owner_id = business.owner_user_id
    await db.delete(business)  # reward cascades with the business
    await db.commit()
    if owner_id:
        owner = await db.get(User, owner_id)
        if owner is not None:
            await db.delete(owner)
            await db.commit()


# ─── Consume ─────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_consume_sets_settled_at_equal_to_used_at(db_session: AsyncSession) -> None:
    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    try:
        reward = await _make_reward(db_session, business)
        voucher = _voucher(reward, driver)
        db_session.add(voucher)
        await db_session.commit()
        await db_session.refresh(voucher)

        await business_service.consume_voucher(db_session, business, voucher.qr_code)

        row = await db_session.get(Redemption, voucher.id)
        assert row is not None
        assert row.status == RedemptionStatus.USED
        assert row.used_at is not None
        assert row.settled_at == row.used_at
    finally:
        await _cleanup(db_session, business, driver)


# ─── Expiry ──────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_expire_sets_settled_at_and_leaves_used_at_null(db_session: AsyncSession) -> None:
    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    try:
        reward = await _make_reward(db_session, business)
        voucher = _voucher(reward, driver, expires_in=timedelta(minutes=-5))
        db_session.add(voucher)
        await db_session.commit()
        await db_session.refresh(voucher)

        await rewards_service.expire_overdue(db_session, Redemption.id == voucher.id)
        await db_session.commit()

        row = await db_session.get(Redemption, voucher.id)
        assert row is not None
        assert row.status == RedemptionStatus.EXPIRED
        assert row.used_at is None
        assert row.settled_at is not None
    finally:
        await _cleanup(db_session, business, driver)


# ─── Live voucher ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_live_pending_voucher_has_null_settled_at(db_session: AsyncSession) -> None:
    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    try:
        reward = await _make_reward(db_session, business)
        voucher = _voucher(reward, driver)
        db_session.add(voucher)
        await db_session.commit()
        await db_session.refresh(voucher)

        assert voucher.status == RedemptionStatus.PENDING
        assert voucher.settled_at is None
    finally:
        await _cleanup(db_session, business, driver)


# ─── Ordering — the property CAR-79's keyset cursor depends on ──────────────


@pytest.mark.asyncio
async def test_mixed_statuses_order_stably_by_settled_at_and_id(db_session: AsyncSession) -> None:
    """A total, stable order over USED/EXPIRED/CANCELLED, including ties.

    Several rows share the same `settled_at` on purpose — `id` is the tiebreaker
    that keeps a keyset cursor from skipping or repeating rows within a tie.
    """
    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    try:
        reward = await _make_reward(db_session, business)
        tie = datetime(2026, 1, 1, tzinfo=UTC)
        rows = [
            _voucher(reward, driver, status=RedemptionStatus.USED, used_at=tie, settled_at=tie),
            _voucher(reward, driver, status=RedemptionStatus.USED, used_at=tie, settled_at=tie),
            _voucher(reward, driver, status=RedemptionStatus.EXPIRED, settled_at=tie),
            _voucher(reward, driver, status=RedemptionStatus.CANCELLED, settled_at=tie + timedelta(seconds=1)),
            _voucher(reward, driver, status=RedemptionStatus.PENDING),  # live — must never appear
        ]
        for row in rows:
            db_session.add(row)
        await db_session.commit()
        for row in rows:
            await db_session.refresh(row)

        terminal_ids = {row.id for row in rows if row.status != RedemptionStatus.PENDING}

        ordered = (
            await db_session.scalars(
                select(Redemption)
                .where(Redemption.reward_id == reward.id, Redemption.settled_at.is_not(None))
                .order_by(Redemption.settled_at.asc(), Redemption.id.asc())
            )
        ).all()

        assert {row.id for row in ordered} == terminal_ids, "every terminal row exactly once, live vouchers excluded"
        settled_ats = [row.settled_at for row in ordered]
        assert settled_ats == sorted(settled_ats), "settled_at is non-decreasing"
        # Rows tied on settled_at must themselves be sorted by id — otherwise a
        # keyset cursor resuming mid-tie could skip or repeat one of them.
        tied = [row.id for row in ordered if row.settled_at == tie]
        assert tied == sorted(tied)
    finally:
        await _cleanup(db_session, business, driver)


# ─── Data-integrity backstop ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_no_terminal_row_can_have_a_null_settled_at(db_session: AsyncSession) -> None:
    """The check constraint, not just application code, guarantees the invariant.

    Every write path today already sets settled_at correctly; this proves the
    database itself refuses the illegal state, so a future write path (a cancel
    endpoint, a manual fixup) cannot silently reintroduce it.
    """
    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    try:
        reward = await _make_reward(db_session, business)
        bad = _voucher(reward, driver, status=RedemptionStatus.EXPIRED, settled_at=None)
        db_session.add(bad)
        with pytest.raises(Exception, match="ck_redemptions_settled_at_matches_status"):
            await db_session.commit()
        await db_session.rollback()
    finally:
        await _cleanup(db_session, business, driver)

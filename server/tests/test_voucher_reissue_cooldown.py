"""One-minute reissue cooldown per (driver, reward) after expire/cancel (CAR-72).

Derived entirely from the redemptions table, no separate cooldown state. The
two terminal reasons read different columns on purpose:

* EXPIRED (flipped or not) anchors to `expires_at` — the real "became EXPIRED"
  instant, set once at issue time and never touched again. `settled_at` for an
  EXPIRED row is when the lazy `expire_overdue` job happened to next scan it,
  which is an unrelated read endpoint's timing, not this event's — using it
  would let two vouchers with the identical TTL end up with different cooldown
  windows purely because one got read sooner than the other.
* CANCELLED anchors to `settled_at`, since cancellation is never lazy: a
  future cancel path writes status and settled_at together in one statement
  (CAR-120), so settled_at *is* the real event time there.

USED never contributes — consuming a voucher starts no cooldown at all.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Business, BusinessCategory, Redemption, RedemptionStatus, Reward, User
from app.services import rewards as rewards_service
from app.services.rewards import VOUCHER_REISSUE_COOLDOWN


async def _make_reward(db: AsyncSession, *, stock: int | None = None) -> tuple[Business, Reward]:
    business = Business(
        name=f"Cooldown Biz {uuid.uuid4().hex[:6]}",
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
        email=f"_cool_{uuid.uuid4().hex[:10]}@carmatest.co.il",
        password_hash="x",
        name="Cooldown Driver",
        points=points,
    )
    db.add(driver)
    await db.commit()
    await db.refresh(driver)
    return driver


def _voucher(
    reward: Reward,
    driver: User,
    *,
    status: RedemptionStatus,
    expires_at: datetime,
    settled_at: datetime | None,
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
        expires_at=expires_at,
        settled_at=settled_at,
    )


async def _redemption_row_count(db: AsyncSession, user_id: str, reward_id: str) -> int:
    count = await db.scalar(
        select(func.count())
        .select_from(Redemption)
        .where(Redemption.user_id == user_id, Redemption.reward_id == reward_id)
    )
    return count or 0


async def _cleanup(db: AsyncSession, *business_ids_and_driver_ids: tuple[str, str | None]) -> None:
    for business_id, driver_id in business_ids_and_driver_ids:
        if driver_id is not None:
            driver = await db.get(User, driver_id)
            if driver is not None:
                await db.delete(driver)
            await db.commit()
        business = await db.get(Business, business_id)
        if business is not None:
            await db.delete(business)
        await db.commit()


# ─── The cooldown itself ──────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_settled_expired_voucher_blocks_reissue_for_the_window(db_session: AsyncSession) -> None:
    business, reward = await _make_reward(db_session)
    driver = await _make_driver(db_session)
    business_id, reward_id, driver_id = business.id, reward.id, driver.id
    try:
        now = datetime.now(UTC)
        # expires_at recent (inside the window) is what makes this cooldown
        # active — settled_at is set to the same moment here only because a
        # prompt flip is the common case, not because settled_at drives it.
        db_session.add(
            _voucher(
                reward, driver, status=RedemptionStatus.EXPIRED, expires_at=now - timedelta(seconds=10), settled_at=now
            )
        )
        await db_session.commit()

        with pytest.raises(HTTPException) as exc:
            await rewards_service.redeem(db_session, driver, reward_id)
        assert exc.value.status_code == 409
        assert exc.value.detail["code"] == VOUCHER_REISSUE_COOLDOWN
        retry_after = exc.value.detail["retryAfterSeconds"]
        assert 1 <= retry_after <= settings.reward_reissue_cooldown_seconds
    finally:
        await _cleanup(db_session, (business_id, driver_id))


@pytest.mark.asyncio
async def test_cancelled_voucher_triggers_the_same_cooldown(db_session: AsyncSession) -> None:
    business, reward = await _make_reward(db_session)
    driver = await _make_driver(db_session)
    business_id, reward_id, driver_id = business.id, reward.id, driver.id
    try:
        now = datetime.now(UTC)
        # expires_at deliberately far in the future — CANCELLED must anchor to
        # settled_at (the real cancel time), never to expires_at.
        db_session.add(
            _voucher(
                reward, driver, status=RedemptionStatus.CANCELLED, expires_at=now + timedelta(days=6), settled_at=now
            )
        )
        await db_session.commit()

        with pytest.raises(HTTPException) as exc:
            await rewards_service.redeem(db_session, driver, reward_id)
        assert exc.value.detail["code"] == VOUCHER_REISSUE_COOLDOWN
    finally:
        await _cleanup(db_session, (business_id, driver_id))


@pytest.mark.asyncio
async def test_reissue_succeeds_once_the_cooldown_window_has_elapsed(db_session: AsyncSession) -> None:
    business, reward = await _make_reward(db_session)
    driver = await _make_driver(db_session)
    business_id, reward_id, driver_id = business.id, reward.id, driver.id
    try:
        now = datetime.now(UTC)
        long_ago = now - timedelta(seconds=settings.reward_reissue_cooldown_seconds + 5)
        db_session.add(_voucher(reward, driver, status=RedemptionStatus.EXPIRED, expires_at=long_ago, settled_at=now))
        await db_session.commit()

        voucher = await rewards_service.redeem(db_session, driver, reward_id)
        assert voucher.status == "pending"
    finally:
        await _cleanup(db_session, (business_id, driver_id))


@pytest.mark.asyncio
async def test_a_still_pending_row_past_its_ttl_triggers_cooldown_before_expire_overdue_runs(
    db_session: AsyncSession,
) -> None:
    """The lazy-expiry case: no read path has flipped the status yet.

    `expire_overdue` only runs on `list_rewards`/`list_my_vouchers`, so a row
    can be functionally expired — past `expires_at` — while still stored
    PENDING with `settled_at` NULL. The cooldown must not wait for that flip.
    """
    business, reward = await _make_reward(db_session)
    driver = await _make_driver(db_session)
    business_id, reward_id, driver_id = business.id, reward.id, driver.id
    try:
        db_session.add(
            _voucher(
                reward,
                driver,
                status=RedemptionStatus.PENDING,
                expires_at=datetime.now(UTC) - timedelta(seconds=5),
                settled_at=None,
            )
        )
        await db_session.commit()

        with pytest.raises(HTTPException) as exc:
            await rewards_service.redeem(db_session, driver, reward_id)
        assert exc.value.detail["code"] == VOUCHER_REISSUE_COOLDOWN
        retry_after = exc.value.detail["retryAfterSeconds"]
        assert settings.reward_reissue_cooldown_seconds - 10 <= retry_after <= settings.reward_reissue_cooldown_seconds
    finally:
        await _cleanup(db_session, (business_id, driver_id))


@pytest.mark.asyncio
async def test_late_expire_overdue_does_not_restart_or_extend_the_cooldown(db_session: AsyncSession) -> None:
    """Regression: the cooldown must be a pure function of `expires_at`.

    A voucher lapses at a fixed instant. Whether `expire_overdue` happens to
    settle it a second later or ten minutes later — because some unrelated
    request touched `list_rewards`/`list_my_vouchers` in between — must not
    move the cooldown at all. Before this fix, the EXPIRED branch read
    `settled_at`, so a late flip re-anchored (and effectively extended) the
    cooldown to whenever that unrelated read happened to run.
    """
    business, reward = await _make_reward(db_session)
    driver = await _make_driver(db_session)
    business_id, reward_id, driver_id = business.id, reward.id, driver.id
    try:
        now = datetime.now(UTC)
        expires_at = now - timedelta(seconds=30)
        db_session.add(
            _voucher(reward, driver, status=RedemptionStatus.PENDING, expires_at=expires_at, settled_at=None)
        )
        await db_session.commit()

        with pytest.raises(HTTPException) as exc_before:
            await rewards_service.redeem(db_session, driver, reward_id)
        retry_before = exc_before.value.detail["retryAfterSeconds"]

        # Simulate expire_overdue only getting to this row long after the TTL
        # actually lapsed — settled_at lands ten minutes in the future relative
        # to `now`, far outside the cooldown window a naive settled_at-based
        # read would report.
        await db_session.execute(
            update(Redemption)
            .where(Redemption.reward_id == reward_id, Redemption.user_id == driver_id)
            .values(status=RedemptionStatus.EXPIRED, settled_at=now + timedelta(minutes=10))
        )
        await db_session.commit()

        # Re-fetch rather than reuse `driver` — the raw Core UPDATE above left
        # its attributes expired, and reloading them lazily mid-coroutine is
        # an unrelated SQLAlchemy async footgun, not something this test is about.
        driver = await db_session.get(User, driver_id)
        assert driver is not None

        with pytest.raises(HTTPException) as exc_after:
            await rewards_service.redeem(db_session, driver, reward_id)
        retry_after = exc_after.value.detail["retryAfterSeconds"]

        assert retry_after <= retry_before, "a later settlement must never push the cooldown further out"
        assert (
            abs(retry_after - retry_before) <= 2
        ), "the cooldown must stay anchored to expires_at, not drift with when the row was flipped"
    finally:
        await _cleanup(db_session, (business_id, driver_id))


@pytest.mark.asyncio
async def test_cooldown_blocks_the_freed_slot_even_with_one_other_live_voucher(db_session: AsyncSession) -> None:
    """Acceptance: with one other live voucher still active, the freed slot stays
    blocked by the cooldown, not just by the (unreached) 2-live-voucher cap.
    """
    business, reward = await _make_reward(db_session)
    driver = await _make_driver(db_session)
    business_id, reward_id, driver_id = business.id, reward.id, driver.id
    try:
        now = datetime.now(UTC)
        db_session.add_all(
            [
                _voucher(
                    reward, driver, status=RedemptionStatus.PENDING, expires_at=now + timedelta(days=5), settled_at=None
                ),
                _voucher(
                    reward,
                    driver,
                    status=RedemptionStatus.EXPIRED,
                    expires_at=now - timedelta(seconds=10),
                    settled_at=now,
                ),
            ]
        )
        await db_session.commit()

        assert (
            await rewards_service.count_live_vouchers(db_session, reward_id) == 1
        ), "only one live, well under the cap"

        with pytest.raises(HTTPException) as exc:
            await rewards_service.redeem(db_session, driver, reward_id)
        assert exc.value.detail["code"] == VOUCHER_REISSUE_COOLDOWN, "must be the cooldown refusing, not the cap"
    finally:
        await _cleanup(db_session, (business_id, driver_id))


# ─── The asymmetry: redeeming triggers nothing ────────────────────────────────
@pytest.mark.asyncio
async def test_consuming_a_voucher_imposes_no_cooldown(db_session: AsyncSession) -> None:
    business, reward = await _make_reward(db_session)
    driver = await _make_driver(db_session)
    business_id, reward_id, driver_id = business.id, reward.id, driver.id
    try:
        now = datetime.now(UTC)
        db_session.add(
            _voucher(reward, driver, status=RedemptionStatus.USED, expires_at=now - timedelta(days=1), settled_at=now)
        )
        await db_session.commit()

        voucher = await rewards_service.redeem(db_session, driver, reward_id)
        assert voucher.status == "pending", "a USED row must never gate a new redeem"
    finally:
        await _cleanup(db_session, (business_id, driver_id))


# ─── Scoping and side-effect-free refusal ─────────────────────────────────────
@pytest.mark.asyncio
async def test_cooldown_on_one_reward_does_not_block_another(db_session: AsyncSession) -> None:
    business_a, reward_a = await _make_reward(db_session)
    business_b, reward_b = await _make_reward(db_session)
    driver = await _make_driver(db_session)
    driver_id = driver.id
    try:
        now = datetime.now(UTC)
        db_session.add(
            _voucher(
                reward_a,
                driver,
                status=RedemptionStatus.EXPIRED,
                expires_at=now - timedelta(seconds=10),
                settled_at=now,
            )
        )
        await db_session.commit()

        voucher = await rewards_service.redeem(db_session, driver, reward_b.id)
        assert voucher.status == "pending", "a cooldown on reward A must not touch reward B"
    finally:
        await _cleanup(db_session, (business_a.id, driver_id), (business_b.id, None))


@pytest.mark.asyncio
async def test_cooldown_refusal_creates_no_voucher_and_touches_no_points_or_rows(db_session: AsyncSession) -> None:
    business, reward = await _make_reward(db_session)
    driver = await _make_driver(db_session)
    business_id, reward_id, driver_id = business.id, reward.id, driver.id
    try:
        now = datetime.now(UTC)
        db_session.add(
            _voucher(
                reward, driver, status=RedemptionStatus.EXPIRED, expires_at=now - timedelta(seconds=10), settled_at=now
            )
        )
        await db_session.commit()

        before = await db_session.get(User, driver_id)
        assert before is not None
        points_before = before.points
        rows_before = await _redemption_row_count(db_session, driver_id, reward_id)

        with pytest.raises(HTTPException):
            await rewards_service.redeem(db_session, driver, reward_id)

        after = await db_session.get(User, driver_id)
        assert after is not None
        assert after.points == points_before, "a cooldown refusal must not debit the driver"
        assert (
            await _redemption_row_count(db_session, driver_id, reward_id) == rows_before
        ), "a cooldown refusal must create no redemption row"
    finally:
        await _cleanup(db_session, (business_id, driver_id))

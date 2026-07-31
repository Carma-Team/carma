"""How long an issued voucher lives (CAR-24).

The window used to be five minutes, inherited from spec 4.3.6.2 which treats the
QR as an anti-fraud token. It is not one — `business.consume_voucher` is what
makes a voucher single-use, and it does that whatever the expiry says. All the
short window achieved was taking points off a driver who did not reach the till
inside five minutes, because nothing refunds a lapsed voucher.

Three properties, each easy to undo by someone who reads the expiry as a security
control and shortens it again:

  1. A freshly issued voucher lives for days, not minutes.
  2. It outlives the end of the reward's own campaign.
  3. Being long-lived does not make it reusable, and does not stop it expiring.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Business, BusinessCategory, Redemption, RedemptionStatus, Reward, User
from app.services import business as business_service
from app.services import rewards as rewards_service
from app.services.rewards import VOUCHER_TTL_DAYS

# The window the old five-minute constant could not have cleared. Asserting
# against this rather than the constant itself keeps the test meaningful if the
# number is ever tuned: it pins the property (days, not minutes), not the value.
_LONG_ENOUGH_TO_REACH_A_SHOP = timedelta(days=1)


# ─── The window itself (no DB) ───────────────────────────────────────────────
def test_the_window_is_measured_in_days() -> None:
    """Guards the unit as much as the number.

    `timedelta(minutes=VOUCHER_TTL_DAYS)` is a one-word slip that type checking
    cannot see and that would put the window back under a quarter of an hour.
    """
    assert timedelta(days=VOUCHER_TTL_DAYS) >= _LONG_ENOUGH_TO_REACH_A_SHOP


# ─── Fixtures ────────────────────────────────────────────────────────────────
async def _make_reward(db: AsyncSession, *, campaign_ends: datetime | None = None) -> tuple[Business, Reward]:
    business = Business(
        name=f"TTL Biz {uuid.uuid4().hex[:6]}",
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
        stock=5,
        expires_at=campaign_ends,
    )
    db.add(reward)
    await db.commit()
    await db.refresh(reward)
    await db.refresh(business)
    return business, reward


async def _make_driver(db: AsyncSession) -> User:
    driver = User(
        email=f"_ttl_{uuid.uuid4().hex[:10]}@carmatest.co.il",
        password_hash="x",
        name="TTL Driver",
        points=1000,
    )
    db.add(driver)
    await db.commit()
    await db.refresh(driver)
    return driver


async def _cleanup(db: AsyncSession, business_id: str, driver_id: str) -> None:
    # Drivers first: redemptions cascade with the user, and Redemption.reward_id
    # has no cascade, so a reward cannot be dropped while a voucher still cites
    # it. Ids rather than instances — a rolled-back test expired every instance
    # in the session, and reading an attribute back would attempt sync IO.
    driver = await db.get(User, driver_id)
    if driver is not None:
        await db.delete(driver)
    await db.commit()

    business = await db.get(Business, business_id)
    if business is not None:
        await db.delete(business)  # rewards cascade with the business
    await db.commit()


# ─── Issuing ─────────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_a_fresh_voucher_survives_the_drive_to_the_shop(db_session: AsyncSession) -> None:
    """CAR-24. Under the old window this voucher was dead before the engine started."""
    business, reward = await _make_reward(db_session)
    driver = await _make_driver(db_session)
    business_id, driver_id = business.id, driver.id
    try:
        voucher = await rewards_service.redeem(db_session, driver, reward.id)

        assert voucher.expires_at - datetime.now(UTC) > _LONG_ENOUGH_TO_REACH_A_SHOP
    finally:
        await _cleanup(db_session, business_id, driver_id)


@pytest.mark.asyncio
async def test_a_voucher_outlives_the_campaign_it_was_claimed_from(db_session: AsyncSession) -> None:
    """A claim granted while the offer was live is honoured after it closes.

    `Reward.expires_at` governs who may still *start* a redemption. Clamping the
    voucher to it would take back something the driver already paid for, which is
    not what anyone means by a coupon they clipped in time.
    """
    campaign_ends = datetime.now(UTC) + timedelta(hours=1)
    business, reward = await _make_reward(db_session, campaign_ends=campaign_ends)
    driver = await _make_driver(db_session)
    business_id, driver_id = business.id, driver.id
    try:
        voucher = await rewards_service.redeem(db_session, driver, reward.id)

        assert voucher.expires_at > campaign_ends, "the claim is the driver's, not the campaign's"
    finally:
        await _cleanup(db_session, business_id, driver_id)


# ─── What the long window must not cost ──────────────────────────────────────
@pytest.mark.asyncio
async def test_a_long_lived_voucher_is_still_single_use(db_session: AsyncSession) -> None:
    """The property that makes the extension safe.

    A shared or screenshotted code is worthless once someone has used it, which
    is why the expiry never had to be the control. That has to keep holding when
    the code is valid for a fortnight rather than five minutes.
    """
    business, reward = await _make_reward(db_session)
    driver = await _make_driver(db_session)
    business_id, driver_id = business.id, driver.id
    try:
        voucher = await rewards_service.redeem(db_session, driver, reward.id)
        await db_session.refresh(business)

        consumed = await business_service.consume_voucher(db_session, business, voucher.code)
        assert consumed.status == "used"

        with pytest.raises(HTTPException) as second:
            await business_service.consume_voucher(db_session, business, voucher.code)
        assert second.value.status_code == 409
    finally:
        await _cleanup(db_session, business_id, driver_id)


@pytest.mark.asyncio
async def test_a_voucher_past_the_long_window_is_still_refused(db_session: AsyncSession) -> None:
    """Lengthening the window must not amount to switching expiry off."""
    business, reward = await _make_reward(db_session)
    driver = await _make_driver(db_session)
    business_id, driver_id = business.id, driver.id
    try:
        voucher = await rewards_service.redeem(db_session, driver, reward.id)
        # Back-dated rather than waited out: the row is the only thing under test,
        # and no fixture in this suite can move the clock forward a fortnight.
        stale = await db_session.get(Redemption, voucher.id)
        assert stale is not None
        stale.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        await db_session.commit()
        await db_session.refresh(business)

        with pytest.raises(HTTPException) as refused:
            await business_service.consume_voucher(db_session, business, voucher.code)
        assert refused.value.status_code == 409

        # `_owned_voucher` settles the TTL before reading, so the row lands on
        # EXPIRED — the one thing it must never be is USED.
        settled = await db_session.get(Redemption, voucher.id)
        assert settled is not None
        assert settled.status is RedemptionStatus.EXPIRED
    finally:
        await _cleanup(db_session, business_id, driver_id)

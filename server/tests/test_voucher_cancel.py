"""A driver cancelling one of their own live vouchers (CAR-110).

`RedemptionStatus.CANCELLED` existed in the enum and the initial migration
since before this issue; nothing ever wrote it. `cancel()` is the only new
code — everything it releases (the reward's unit, CAR-73's reserved points,
CAR-71's per-reward slot, CAR-72's cooldown) is derived from `live_voucher_where`
or `_cooldown_ends_at`, both already written for those features, so cancelling
does not touch stock/reservation/cap/cooldown logic itself, only the status
transition those already read.

Route tests use `db_api_client` so the auth guard, the 404-not-403 ownership
check and the wire-level `code` field are all exercised for real, the same
convention `test_profile_drive_mode.py` uses. The concurrency test goes through
the service directly with two independent engines — same shape as
`test_points_atomicity.py`'s `test_concurrent_consumes_of_one_voucher_charge_exactly_once` —
because two coroutines sharing one connection would queue instead of contending.

Every test captures `business.id` / `driver.id` into a plain string right after
creation, before any call that might roll back the session. A conflict path
(`cancel`'s own, or `redeem`'s cooldown check) leaves every ORM instance on the
session expired — `test_business_vouchers.py`'s `_cleanup` carries the same
note — so reading `.id` off the object itself in a `finally` block after that
is a synchronous attribute access needing IO outside of a greenlet context,
and crashes with `MissingGreenlet`. Passing already-captured id strings into
`_cleanup` sidesteps it entirely.
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings
from app.core.security import create_access_token
from app.models import Business, BusinessCategory, Redemption, RedemptionStatus, Reward, User, UserRole
from app.services import rewards as rewards_service


async def _make_business(db: AsyncSession) -> Business:
    business = Business(
        name=f"Cancel Biz {uuid.uuid4().hex[:6]}",
        category=BusinessCategory.FOOD,
        location_lat=32.07,
        location_lng=34.78,
    )
    db.add(business)
    await db.commit()
    await db.refresh(business)
    return business


async def _make_reward(db: AsyncSession, business: Business, *, cost_points: int = 50) -> Reward:
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


async def _make_driver(db: AsyncSession, *, points: int = 200) -> User:
    driver = User(
        email=f"_cancel_{uuid.uuid4().hex[:10]}@carmatest.co.il",
        password_hash="x",
        role=UserRole.DRIVER,
        name="Cancel Driver",
        points=points,
        total_points=points,
    )
    db.add(driver)
    await db.commit()
    await db.refresh(driver)
    return driver


def _auth(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, email=user.email, phone=None, role=UserRole.DRIVER)
    return {"Authorization": f"Bearer {token}"}


async def _cleanup(db: AsyncSession, *, business_id: str, driver_ids: list[str]) -> None:
    for driver_id in driver_ids:
        driver = await db.get(User, driver_id)
        if driver is not None:
            await db.delete(driver)
    await db.commit()

    business = await db.get(Business, business_id)
    if business is not None:
        await db.delete(business)  # rewards cascade with the business
    await db.commit()


@asynccontextmanager
async def _rival_session() -> AsyncIterator[AsyncSession]:
    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    try:
        async with factory() as session:
            yield session
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_owner_cancels_their_own_live_voucher(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    business_id, driver_id = business.id, driver.id
    try:
        reward = await _make_reward(db_session, business)
        voucher = await rewards_service.redeem(db_session, driver, reward.id)

        r = await db_api_client.post(f"/api/vouchers/{voucher.id}/cancel", headers=_auth(driver))

        assert r.status_code == 200
        assert r.json()["voucher"]["status"] == "cancelled"

        stored = await db_session.get(Redemption, voucher.id)
        assert stored is not None
        assert stored.status is RedemptionStatus.CANCELLED
        assert stored.settled_at is not None
    finally:
        await _cleanup(db_session, business_id=business_id, driver_ids=[driver_id])


@pytest.mark.asyncio
async def test_another_driver_gets_404_not_403(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    business = await _make_business(db_session)
    owner = await _make_driver(db_session)
    stranger = await _make_driver(db_session)
    business_id, owner_id, stranger_id = business.id, owner.id, stranger.id
    try:
        reward = await _make_reward(db_session, business)
        voucher = await rewards_service.redeem(db_session, owner, reward.id)

        r = await db_api_client.post(f"/api/vouchers/{voucher.id}/cancel", headers=_auth(stranger))

        assert r.status_code == 404

        stored = await db_session.get(Redemption, voucher.id)
        assert stored is not None and stored.status is RedemptionStatus.PENDING
    finally:
        await _cleanup(db_session, business_id=business_id, driver_ids=[owner_id, stranger_id])


@pytest.mark.asyncio
async def test_cancelling_one_of_two_live_vouchers_leaves_the_other_untouched(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    business_id, driver_id = business.id, driver.id
    try:
        reward = await _make_reward(db_session, business)
        first = await rewards_service.redeem(db_session, driver, reward.id)
        second = await rewards_service.redeem(db_session, driver, reward.id)

        r = await db_api_client.post(f"/api/vouchers/{first.id}/cancel", headers=_auth(driver))
        assert r.status_code == 200

        untouched = await db_session.get(Redemption, second.id)
        assert untouched is not None and untouched.status is RedemptionStatus.PENDING
    finally:
        await _cleanup(db_session, business_id=business_id, driver_ids=[driver_id])


@pytest.mark.asyncio
async def test_cancelling_a_used_voucher_is_409_and_leaves_it_used(db_session: AsyncSession) -> None:
    """Service-level, like `test_business_vouchers.py`'s `test_expired_voucher_cannot_be_consumed`."""
    from app.services import business as business_service

    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    member = await _make_driver(db_session)
    business_id, driver_id, member_id = business.id, driver.id, member.id
    try:
        reward = await _make_reward(db_session, business)
        voucher = await rewards_service.redeem(db_session, driver, reward.id)
        await business_service.consume_voucher(db_session, business, voucher.code, consumed_by_user_id=member_id)

        with pytest.raises(HTTPException) as exc:
            await rewards_service.cancel(db_session, driver, voucher.id)
        assert exc.value.status_code == 409
        assert exc.value.detail["code"] == rewards_service.VOUCHER_ALREADY_USED

        stored = await db_session.get(Redemption, voucher.id)
        assert stored is not None and stored.status is RedemptionStatus.USED
    finally:
        await _cleanup(db_session, business_id=business_id, driver_ids=[driver_id, member_id])


@pytest.mark.asyncio
async def test_cancelling_an_expired_voucher_is_409(db_session: AsyncSession) -> None:
    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    business_id, driver_id = business.id, driver.id
    try:
        reward = await _make_reward(db_session, business)
        voucher = await rewards_service.redeem(db_session, driver, reward.id)

        stale = await db_session.get(Redemption, voucher.id)
        assert stale is not None
        stale.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        await db_session.commit()

        with pytest.raises(HTTPException) as exc:
            await rewards_service.cancel(db_session, driver, voucher.id)
        assert exc.value.status_code == 409
        assert exc.value.detail["code"] == rewards_service.VOUCHER_EXPIRED
    finally:
        await _cleanup(db_session, business_id=business_id, driver_ids=[driver_id])


@pytest.mark.asyncio
async def test_wire_level_conflict_code_for_a_used_voucher(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    """The route-level sibling: only the response body is inspected afterward.

    Same convention as `test_business_vouchers.py`'s
    `test_expired_conflict_reaches_the_wire_as_a_machine_readable_code` — one
    conflict-causing request per test, matching the only shape this codebase's
    suite has proven safe for a session that a routed request rolled back.
    """
    from app.services import business as business_service

    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    member = await _make_driver(db_session)
    business_id, driver_id, member_id = business.id, driver.id, member.id
    try:
        reward = await _make_reward(db_session, business)
        voucher = await rewards_service.redeem(db_session, driver, reward.id)
        await business_service.consume_voucher(db_session, business, voucher.code, consumed_by_user_id=member_id)

        resp = await db_api_client.post(f"/api/vouchers/{voucher.id}/cancel", headers=_auth(driver))
        assert resp.status_code == 409
        assert resp.json()["detail"] == {"code": "VOUCHER_ALREADY_USED", "message": "Voucher already used"}
    finally:
        await _cleanup(db_session, business_id=business_id, driver_ids=[driver_id, member_id])


@pytest.mark.asyncio
async def test_wire_level_conflict_code_for_an_expired_voucher(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    business_id, driver_id = business.id, driver.id
    try:
        reward = await _make_reward(db_session, business)
        voucher = await rewards_service.redeem(db_session, driver, reward.id)

        stale = await db_session.get(Redemption, voucher.id)
        assert stale is not None
        stale.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        await db_session.commit()

        resp = await db_api_client.post(f"/api/vouchers/{voucher.id}/cancel", headers=_auth(driver))
        assert resp.status_code == 409
        assert resp.json()["detail"] == {"code": "VOUCHER_EXPIRED", "message": "Voucher expired"}
    finally:
        await _cleanup(db_session, business_id=business_id, driver_ids=[driver_id])


@pytest.mark.asyncio
async def test_cancel_releases_stock_reservation_slot_and_starts_cooldown(db_session: AsyncSession) -> None:
    """DB-level proof of every AC in one place: unit, reserved points, CAR-71 slot, CAR-72 cooldown."""
    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    business_id, driver_id = business.id, driver.id
    try:
        reward = await _make_reward(db_session, business, cost_points=50)
        voucher = await rewards_service.redeem(db_session, driver, reward.id)

        claimed_before = await rewards_service.claimed_by_reward(db_session, [reward.id])
        assert claimed_before.get(reward.id, 0) == 1
        assert await rewards_service.reserved_points(db_session, driver_id) == 50
        assert await rewards_service.count_live_vouchers(db_session, reward.id) == 1

        cancelled = await rewards_service.cancel(db_session, driver, voucher.id)
        assert cancelled.status == "cancelled"

        claimed_after = await rewards_service.claimed_by_reward(db_session, [reward.id])
        assert claimed_after.get(reward.id, 0) == 0, "the reward's unit must be available again"
        assert await rewards_service.reserved_points(db_session, driver_id) == 0, "points must be un-reserved"
        assert await rewards_service.count_live_vouchers(db_session, reward.id) == 0, "the CAR-71 slot must be freed"

        balance = await db_session.scalar(select(User.points).where(User.id == driver_id))
        assert balance == 200, "User.points must be untouched by a cancellation"

        now = datetime.now(UTC)
        cooldown_ends = await rewards_service._cooldown_ends_at(db_session, driver_id, reward.id, now)
        assert cooldown_ends is not None, "cancelling must start the CAR-72 reissue cooldown"

        with pytest.raises(HTTPException) as exc:
            await rewards_service.redeem(db_session, driver, reward.id)
        assert exc.value.status_code == 409
        assert exc.value.detail["code"] == rewards_service.VOUCHER_REISSUE_COOLDOWN
    finally:
        await _cleanup(db_session, business_id=business_id, driver_ids=[driver_id])


@pytest.mark.asyncio
async def test_concurrent_cancels_of_one_voucher_release_exactly_once(db_session: AsyncSession) -> None:
    """Two taps cancelling the same voucher at once: exactly one state change, one release, one cooldown."""
    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    business_id, driver_id = business.id, driver.id
    try:
        reward = await _make_reward(db_session, business, cost_points=50)
        voucher = await rewards_service.redeem(db_session, driver, reward.id)

        async with _rival_session() as rival_db:
            rival_driver = await rival_db.get(User, driver_id)
            assert rival_driver is not None

            results = await asyncio.gather(
                rewards_service.cancel(db_session, driver, voucher.id),
                rewards_service.cancel(rival_db, rival_driver, voucher.id),
                return_exceptions=True,
            )

        failures = [r for r in results if isinstance(r, BaseException)]
        assert len(failures) == 1, f"exactly one cancel must be refused, got {results}"
        refused = failures[0]
        assert isinstance(refused, HTTPException)
        assert refused.status_code == 409

        stored = await db_session.get(Redemption, voucher.id)
        assert stored is not None
        assert stored.status is RedemptionStatus.CANCELLED, "the row must have settled to CANCELLED exactly once"

        # The release happened exactly once, not twice — a double-release could
        # only be observed as a negative claimed count or reserved balance, but
        # asserting the actual values proves it landed at the single correct state.
        claimed = await rewards_service.claimed_by_reward(db_session, [reward.id])
        assert claimed.get(reward.id, 0) == 0
        assert await rewards_service.reserved_points(db_session, driver_id) == 0
        assert await rewards_service.count_live_vouchers(db_session, reward.id) == 0

        now = datetime.now(UTC)
        cooldown_ends = await rewards_service._cooldown_ends_at(db_session, driver_id, reward.id, now)
        assert cooldown_ends is not None, "the winning cancel must have started the cooldown"
    finally:
        await _cleanup(db_session, business_id=business_id, driver_ids=[driver_id])

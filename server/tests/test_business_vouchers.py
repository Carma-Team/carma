"""Business-side voucher validation — the far end of the redemption loop.

Vouchers are issued with a TTL and, until now, nothing ever moved them off
PENDING. These cover the three ways that must not go wrong:

  1. A voucher can be consumed exactly once, and the second attempt is refused.
  2. A lapsed voucher settles to EXPIRED and cannot be consumed afterwards.
  3. A business can only see and consume vouchers issued against its own rewards.

Guards run in-process (no DB); the state machine needs real rows and skips when
no Postgres is reachable.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.config import settings
from app.core.security import create_access_token
from app.main import app
from app.models import Business, BusinessCategory, Redemption, RedemptionStatus, Reward, User, UserRole
from app.services import business as business_service
from app.services import rewards as rewards_service

# ─── Auth guards (no DB) ─────────────────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/api/business/vouchers/ABC123"),
        ("POST", "/api/business/vouchers/ABC123/redeem"),
    ],
)
async def test_voucher_endpoints_require_auth(method: str, path: str) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.request(method, path)
    assert r.status_code == 401, f"{method} {path} must reject anonymous callers"


# ─── Fixtures ────────────────────────────────────────────────────────────────


async def _make_business(db: AsyncSession) -> Business:
    owner = User(
        email=f"_vbiz_{uuid.uuid4().hex[:10]}@carmatest.co.il",
        password_hash="x",
        role=UserRole.BUSINESS,
        name="Voucher Biz",
    )
    db.add(owner)
    await db.flush()

    business = Business(
        owner_user_id=owner.id,
        name=f"Voucher Biz {uuid.uuid4().hex[:6]}",
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
        email=f"_vdrv_{uuid.uuid4().hex[:10]}@carmatest.co.il",
        password_hash="x",
        name="Voucher Driver",
        points=1000,
    )
    db.add(driver)
    await db.commit()
    await db.refresh(driver)
    return driver


async def _issue(
    db: AsyncSession, business: Business, driver: User, *, ttl: timedelta = timedelta(minutes=5)
) -> Redemption:
    reward = Reward(
        business_id=business.id,
        title_he="שובר בדיקה",
        description_he="תיאור",
        category=business.category,
        cost_points=10,
        stock=5,
    )
    db.add(reward)
    await db.flush()

    code = uuid.uuid4().hex[:12].upper()
    voucher = Redemption(
        user_id=driver.id,
        reward_id=reward.id,
        qr_code=code,
        qr_data=code,
        status=RedemptionStatus.PENDING,
        expires_at=datetime.now(UTC) + ttl,
    )
    db.add(voucher)
    await db.commit()
    await db.refresh(voucher)
    return voucher


async def _cleanup(db: AsyncSession, *businesses: Business, drivers: tuple[User, ...] = ()) -> None:
    # Drivers first: redemptions cascade with the user, and Redemption.reward_id
    # has no cascade, so a reward cannot be dropped while a voucher still cites it.
    for driver in drivers:
        await db.delete(driver)
    await db.commit()

    for business in businesses:
        # A test that ended in a rollback left every instance expired; reload
        # before reading attributes, or the read itself attempts sync IO.
        await db.refresh(business)
        owner_id = business.owner_user_id
        await db.delete(business)  # rewards cascade with the business
        await db.commit()
        if owner_id:
            owner = await db.get(User, owner_id)
            if owner is not None:
                await db.delete(owner)
                await db.commit()


# ─── Peek ────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_peek_reports_a_valid_voucher_without_consuming_it(db_session: AsyncSession) -> None:
    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    try:
        voucher = await _issue(db_session, business, driver)

        out = await business_service.peek_voucher(db_session, business, voucher.qr_code)
        assert out.status == "pending" and out.is_used is False

        # The whole point of a separate peek: the row must be untouched.
        await db_session.refresh(voucher)
        assert voucher.status == RedemptionStatus.PENDING
        assert voucher.used_at is None
    finally:
        await _cleanup(db_session, business, drivers=(driver,))


@pytest.mark.asyncio
async def test_unknown_code_is_not_found(db_session: AsyncSession) -> None:
    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    try:
        with pytest.raises(HTTPException) as exc:
            await business_service.peek_voucher(db_session, business, "NOSUCHCODE")
        assert exc.value.status_code == 404
    finally:
        await _cleanup(db_session, business, drivers=(driver,))


@pytest.mark.asyncio
async def test_another_businesss_voucher_is_not_found(db_session: AsyncSession) -> None:
    issuer = await _make_business(db_session)
    other = await _make_business(db_session)
    driver = await _make_driver(db_session)
    try:
        voucher = await _issue(db_session, issuer, driver)

        # 404, not 403 — a distinct error would let one business probe another's codes.
        with pytest.raises(HTTPException) as peek_exc:
            await business_service.peek_voucher(db_session, other, voucher.qr_code)
        assert peek_exc.value.status_code == 404

        with pytest.raises(HTTPException) as use_exc:
            await business_service.consume_voucher(db_session, other, voucher.qr_code)
        assert use_exc.value.status_code == 404

        # And the attempt left it usable for the business that actually issued it.
        await db_session.refresh(voucher)
        assert voucher.status == RedemptionStatus.PENDING
    finally:
        await _cleanup(db_session, issuer, other, drivers=(driver,))


# ─── Consume ─────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_consume_marks_it_used_once_and_refuses_the_second_time(db_session: AsyncSession) -> None:
    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    try:
        voucher = await _issue(db_session, business, driver)

        out = await business_service.consume_voucher(db_session, business, voucher.qr_code)
        assert out.status == "used" and out.is_used is True
        assert out.redeemed_at is not None, "the client shows when it was redeemed"

        await db_session.refresh(voucher)
        assert voucher.status == RedemptionStatus.USED and voucher.used_at is not None

        # Same QR presented at a second till.
        with pytest.raises(HTTPException) as exc:
            await business_service.consume_voucher(db_session, business, voucher.qr_code)
        assert exc.value.status_code == 409
        assert (
            exc.value.detail["code"] == business_service.VOUCHER_ALREADY_USED
        ), "the client needs a code, not a message to parse"
    finally:
        await _cleanup(db_session, business, drivers=(driver,))


@pytest.mark.asyncio
async def test_already_used_conflict_reaches_the_wire_as_a_machine_readable_code(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    """What `lib/api/vouchers.ts` actually receives over HTTP, not just what the service raises.

    FastAPI serializes an `HTTPException.detail` verbatim into the response
    body's `detail` field — this pins that the dict survives the round trip
    rather than collapsing back to a bare string somewhere in between (CAR-67).
    """
    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    token = create_access_token(user_id=business.owner_user_id, email=None, phone=None, role=UserRole.BUSINESS)
    headers = {"Authorization": f"Bearer {token}"}
    try:
        voucher = await _issue(db_session, business, driver)

        first = await db_api_client.post(f"/api/business/vouchers/{voucher.qr_code}/redeem", headers=headers)
        assert first.status_code == 200

        second = await db_api_client.post(f"/api/business/vouchers/{voucher.qr_code}/redeem", headers=headers)
        assert second.status_code == 409
        assert second.json()["detail"] == {"code": "VOUCHER_ALREADY_USED", "message": "Voucher already used"}
    finally:
        await _cleanup(db_session, business, drivers=(driver,))


# ─── Expiry ──────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_peek_settles_a_lapsed_voucher_to_expired(db_session: AsyncSession) -> None:
    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    try:
        voucher = await _issue(db_session, business, driver, ttl=timedelta(minutes=-1))

        out = await business_service.peek_voucher(db_session, business, voucher.qr_code)
        assert out.status == "expired", "a lapsed voucher must not still read as pending"

        # Settled in the database, not just in the response.
        await db_session.refresh(voucher)
        assert voucher.status == RedemptionStatus.EXPIRED
    finally:
        await _cleanup(db_session, business, drivers=(driver,))


@pytest.mark.asyncio
async def test_expired_voucher_cannot_be_consumed(db_session: AsyncSession) -> None:
    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    try:
        voucher = await _issue(db_session, business, driver, ttl=timedelta(seconds=-1))

        with pytest.raises(HTTPException) as exc:
            await business_service.consume_voucher(db_session, business, voucher.qr_code)
        assert exc.value.status_code == 409
        assert exc.value.detail["code"] == business_service.VOUCHER_EXPIRED

        await db_session.refresh(voucher)
        assert voucher.status == RedemptionStatus.EXPIRED
        assert voucher.used_at is None, "a refused redemption must not stamp used_at"
    finally:
        await _cleanup(db_session, business, drivers=(driver,))


@pytest.mark.asyncio
async def test_expired_conflict_reaches_the_wire_as_a_machine_readable_code(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    """The expired sibling of `test_already_used_conflict_reaches_the_wire_as_a_machine_readable_code`.

    Both 409s share a status code; only the wire-level `detail.code` is what
    lets `lib/api/vouchers.ts` tell them apart, so both need this same proof.
    """
    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    token = create_access_token(user_id=business.owner_user_id, email=None, phone=None, role=UserRole.BUSINESS)
    headers = {"Authorization": f"Bearer {token}"}
    try:
        voucher = await _issue(db_session, business, driver, ttl=timedelta(seconds=-1))

        redeem = await db_api_client.post(f"/api/business/vouchers/{voucher.qr_code}/redeem", headers=headers)
        assert redeem.status_code == 409
        assert redeem.json()["detail"] == {"code": "VOUCHER_EXPIRED", "message": "Voucher expired"}
    finally:
        await _cleanup(db_session, business, drivers=(driver,))


@pytest.mark.asyncio
async def test_driver_listing_settles_their_own_stale_vouchers(db_session: AsyncSession) -> None:
    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    try:
        stale = await _issue(db_session, business, driver, ttl=timedelta(minutes=-10))
        live = await _issue(db_session, business, driver, ttl=timedelta(minutes=5))

        result = await rewards_service.list_my_vouchers(db_session, driver.id)
        by_code = {v.code: v.status for v in result["vouchers"]}  # type: ignore[union-attr]
        assert by_code[stale.qr_code] == "expired"
        assert by_code[live.qr_code] == "pending", "a voucher inside its TTL must be left alone"
    finally:
        await _cleanup(db_session, business, drivers=(driver,))


@pytest.mark.asyncio
async def test_expire_overdue_only_touches_the_rows_it_is_scoped_to(db_session: AsyncSession) -> None:
    business = await _make_business(db_session)
    mine = await _make_driver(db_session)
    someone_else = await _make_driver(db_session)
    try:
        my_stale = await _issue(db_session, business, mine, ttl=timedelta(minutes=-10))
        their_stale = await _issue(db_session, business, someone_else, ttl=timedelta(minutes=-10))

        await rewards_service.expire_overdue(db_session, Redemption.user_id == mine.id)

        await db_session.refresh(my_stale)
        await db_session.refresh(their_stale)
        assert my_stale.status == RedemptionStatus.EXPIRED
        assert their_stale.status == RedemptionStatus.PENDING, "one driver's read must not sweep another's rows"
    finally:
        await _cleanup(db_session, business, drivers=(mine, someone_else))


# ─── Transaction neutrality (CAR-63) ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_expire_overdue_leaves_the_callers_transaction_open(db_session: AsyncSession) -> None:
    """expire_overdue must not commit — it runs inside whatever the caller started.

    Stock enforcement holds a `FOR UPDATE` lock on the reward row across the
    availability check, and settling expiry happens inside that same transaction.
    A commit in expire_overdue would end the transaction and release the lock
    mid-check, letting a second redeem slip past the stock cap.

    Proven from a second connection: while the first still holds the lock, a
    `FOR UPDATE NOWAIT` on the same row must fail.
    """
    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    try:
        stale = await _issue(db_session, business, driver, ttl=timedelta(minutes=-10))
        # Held as plain values: the rollback below expires every instance in the
        # session, and reading an attribute afterwards attempts sync IO.
        reward_id = stale.reward_id
        voucher_id = stale.id

        # Open a transaction and take the lock the stock check will rely on.
        await db_session.execute(select(Reward).where(Reward.id == reward_id).with_for_update())
        await rewards_service.expire_overdue(db_session, Redemption.user_id == driver.id)

        assert db_session.in_transaction(), "expire_overdue must leave the caller's transaction open"

        async with engine.connect() as other:
            with pytest.raises(DBAPIError):
                await other.execute(select(Reward.id).where(Reward.id == reward_id).with_for_update(nowait=True))

        # Rolling back must take the settle with it — the flip was never a
        # separate transaction of its own.
        await db_session.rollback()
        still_pending = await db_session.scalar(select(Redemption.status).where(Redemption.id == voucher_id))
        assert still_pending == RedemptionStatus.PENDING, "a rolled-back caller must discard the settle too"
    finally:
        await engine.dispose()
        await _cleanup(db_session, business, drivers=(driver,))


@pytest.mark.asyncio
async def test_expire_overdue_issues_no_commit_of_its_own(db_session: AsyncSession) -> None:
    """The narrow version of the above, without needing a second connection."""
    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    try:
        stale = await _issue(db_session, business, driver, ttl=timedelta(minutes=-10))
        voucher_id = stale.id  # plain value — the rollback expires the instance

        await rewards_service.expire_overdue(db_session, Redemption.user_id == driver.id)
        await db_session.rollback()

        status_now = await db_session.scalar(select(Redemption.status).where(Redemption.id == voucher_id))
        assert status_now == RedemptionStatus.PENDING, "expire_overdue committed on its own — it must not"
    finally:
        await _cleanup(db_session, business, drivers=(driver,))

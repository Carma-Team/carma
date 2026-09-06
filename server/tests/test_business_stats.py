"""Business redemption statistics — CAR-81.

Covers every field of `BusinessStatsOut` against controlled fixtures: today /
last-30-days boundaries (Asia/Jerusalem "today", matching `services.trips`),
live vouchers, top rewards, sold-out rewards (CAR-47's own availability
derivation), total points charged (CAR-70's issuance-time snapshot),
issued-to-redeemed ratio, cross-business isolation, and role enforcement.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token
from app.main import app
from app.models import (
    Business,
    BusinessCategory,
    BusinessMembership,
    BusinessMembershipRole,
    Redemption,
    RedemptionStatus,
    Reward,
    User,
    UserRole,
)
from app.services import business as business_service

_TZ_IL = ZoneInfo("Asia/Jerusalem")

# ─── Fixtures ────────────────────────────────────────────────────────────────


async def _make_business(db: AsyncSession) -> Business:
    owner = User(
        email=f"_sbiz_{uuid.uuid4().hex[:10]}@carmatest.co.il",
        password_hash="x",
        role=UserRole.BUSINESS,
        name="Stats Biz",
    )
    db.add(owner)
    await db.flush()

    business = Business(
        owner_user_id=owner.id,
        name=f"Stats Biz {uuid.uuid4().hex[:6]}",
        category=BusinessCategory.FOOD,
        location_lat=32.07,
        location_lng=34.78,
    )
    db.add(business)
    await db.flush()
    db.add(BusinessMembership(user_id=owner.id, business_id=business.id, role=BusinessMembershipRole.OWNER))
    await db.commit()
    await db.refresh(business)
    return business


async def _owner_of(db: AsyncSession, business: Business) -> User:
    owner = await db.get(User, business.owner_user_id)
    assert owner is not None
    return owner


async def _add_member(db: AsyncSession, business: Business, role: BusinessMembershipRole) -> User:
    member = User(
        email=f"_smem_{uuid.uuid4().hex[:10]}@carmatest.co.il",
        password_hash="x",
        role=UserRole.BUSINESS,
        name=f"{role.value.title()} Member",
    )
    db.add(member)
    await db.flush()
    db.add(BusinessMembership(user_id=member.id, business_id=business.id, role=role))
    await db.commit()
    await db.refresh(member)
    return member


async def _make_driver(db: AsyncSession) -> User:
    driver = User(
        email=f"_sdrv_{uuid.uuid4().hex[:10]}@carmatest.co.il",
        password_hash="x",
        name="Stats Driver",
        points=1000,
    )
    db.add(driver)
    await db.commit()
    await db.refresh(driver)
    return driver


async def _make_reward(
    db: AsyncSession, business: Business, *, cost_points: int = 10, stock: int | None = None
) -> Reward:
    reward = Reward(
        business_id=business.id,
        title_he="שובר בדיקה",
        title_en="Test reward",
        description_he="תיאור",
        category=business.category,
        cost_points=cost_points,
        stock=stock,
    )
    db.add(reward)
    await db.commit()
    await db.refresh(reward)
    return reward


async def _seed_redemption(
    db: AsyncSession,
    business: Business,
    driver: User,
    reward: Reward,
    *,
    status: RedemptionStatus,
    settled_at: datetime | None,
    points_cost: int | None = None,
    ttl: timedelta = timedelta(hours=1),
) -> Redemption:
    now = datetime.now(UTC)
    redemption = Redemption(
        user_id=driver.id,
        reward_id=reward.id,
        business_id=business.id,
        points_cost=points_cost if points_cost is not None else reward.cost_points,
        qr_code=uuid.uuid4().hex[:12].upper(),
        status=status,
        expires_at=now + ttl,
        used_at=settled_at if status == RedemptionStatus.USED else None,
        settled_at=settled_at,
    )
    db.add(redemption)
    await db.commit()
    await db.refresh(redemption)
    return redemption


async def _cleanup(db: AsyncSession, *businesses: Business, drivers: tuple[User, ...] = ()) -> None:
    for driver in drivers:
        await db.delete(driver)
    await db.commit()

    for business in businesses:
        await db.refresh(business)
        owner_id = business.owner_user_id
        await db.delete(business)  # rewards + memberships + redemptions cascade with the business
        await db.commit()
        if owner_id:
            owner = await db.get(User, owner_id)
            if owner is not None:
                await db.delete(owner)
                await db.commit()


async def _headers(user: User) -> dict[str, str]:
    token = create_access_token(user_id=user.id, email=user.email, phone=None, role=UserRole.BUSINESS)
    return {"Authorization": f"Bearer {token}"}


# ─── Auth guard (no DB) ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_stats_endpoint_requires_auth() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/business/stats")
    assert r.status_code == 401


# ─── Role enforcement ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_cashier_cannot_read_stats(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    business = await _make_business(db_session)
    cashier = await _add_member(db_session, business, BusinessMembershipRole.CASHIER)
    try:
        r = await db_api_client.get("/api/business/stats", headers=await _headers(cashier))
        assert r.status_code == 403
    finally:
        await _cleanup(db_session, business, drivers=(cashier,))


@pytest.mark.asyncio
async def test_manager_and_owner_can_read_stats(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    business = await _make_business(db_session)
    manager = await _add_member(db_session, business, BusinessMembershipRole.MANAGER)
    owner = await _owner_of(db_session, business)
    try:
        for user in (manager, owner):
            r = await db_api_client.get("/api/business/stats", headers=await _headers(user))
            assert r.status_code == 200
    finally:
        await _cleanup(db_session, business, drivers=(manager,))


# ─── Today / last-30-days boundaries ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_redemptions_today_uses_israel_local_midnight(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    reward = await _make_reward(db_session, business)
    owner = await _owner_of(db_session, business)
    now = datetime.now(UTC)
    local_midnight_utc = now.astimezone(_TZ_IL).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(UTC)
    try:
        inside_today = await _seed_redemption(
            db_session, business, driver, reward, status=RedemptionStatus.USED, settled_at=local_midnight_utc
        )
        await _seed_redemption(
            db_session,
            business,
            driver,
            reward,
            status=RedemptionStatus.USED,
            settled_at=local_midnight_utc - timedelta(seconds=1),
        )

        r = await db_api_client.get("/api/business/stats", headers=await _headers(owner))
        assert r.status_code == 200
        body = r.json()
        assert body["redemptionsToday"] == 1
        assert inside_today.id  # sanity: the seeded row is the one inside the window
    finally:
        await _cleanup(db_session, business, drivers=(driver,))


@pytest.mark.asyncio
async def test_redemptions_last_30_days_boundary(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    """A rolling 30-day window, not a calendar-aligned one — `now - 30d` and past it.

    A few minutes of margin either side of the boundary, rather than the exact
    instant: the seed's `now` and the endpoint's own `now` are two separate
    clock reads a request apart, so asserting the boundary to the second would
    be asserting clock drift, not the window's correctness.
    """
    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    reward = await _make_reward(db_session, business)
    owner = await _owner_of(db_session, business)
    now = datetime.now(UTC)
    try:
        inside = await _seed_redemption(
            db_session,
            business,
            driver,
            reward,
            status=RedemptionStatus.USED,
            settled_at=now - timedelta(days=29, hours=23, minutes=55),
        )
        await _seed_redemption(
            db_session,
            business,
            driver,
            reward,
            status=RedemptionStatus.USED,
            settled_at=now - timedelta(days=30, minutes=5),
        )

        r = await db_api_client.get("/api/business/stats", headers=await _headers(owner))
        body = r.json()
        assert body["redemptionsLast30Days"] == 1
        assert inside.id  # sanity: the seeded row inside the window is the one counted
    finally:
        await _cleanup(db_session, business, drivers=(driver,))


@pytest.mark.asyncio
async def test_non_used_statuses_do_not_count_as_redemptions(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    reward = await _make_reward(db_session, business)
    owner = await _owner_of(db_session, business)
    now = datetime.now(UTC)
    try:
        await _seed_redemption(db_session, business, driver, reward, status=RedemptionStatus.EXPIRED, settled_at=now)
        await _seed_redemption(db_session, business, driver, reward, status=RedemptionStatus.CANCELLED, settled_at=now)

        r = await db_api_client.get("/api/business/stats", headers=await _headers(owner))
        body = r.json()
        assert body["redemptionsToday"] == 0
        assert body["redemptionsLast30Days"] == 0
        assert body["vouchersRedeemed"] == 0
        # Still counted as issued — an expired/cancelled voucher was still issued.
        assert body["vouchersIssued"] == 2
    finally:
        await _cleanup(db_session, business, drivers=(driver,))


# ─── Live vouchers ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_live_vouchers_counts_only_pending_inside_ttl(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    reward = await _make_reward(db_session, business)
    owner = await _owner_of(db_session, business)
    try:
        await _seed_redemption(
            db_session,
            business,
            driver,
            reward,
            status=RedemptionStatus.PENDING,
            settled_at=None,
            ttl=timedelta(days=1),
        )
        # Overdue but not yet lazily flipped to EXPIRED — must not count as live.
        await _seed_redemption(
            db_session,
            business,
            driver,
            reward,
            status=RedemptionStatus.PENDING,
            settled_at=None,
            ttl=-timedelta(hours=1),
        )

        r = await db_api_client.get("/api/business/stats", headers=await _headers(owner))
        body = r.json()
        assert body["liveVouchers"] == 1
    finally:
        await _cleanup(db_session, business, drivers=(driver,))


# ─── Total points charged (CAR-70) ───────────────────────────────────────────


@pytest.mark.asyncio
async def test_total_points_charged_uses_issuance_time_snapshot(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    reward = await _make_reward(db_session, business, cost_points=10)
    owner = await _owner_of(db_session, business)
    now = datetime.now(UTC)
    try:
        # Issued at 10 points; the reward's price has since changed to 99 — the
        # snapshot on the redemption row must win, not the reward's current price.
        await _seed_redemption(
            db_session, business, driver, reward, status=RedemptionStatus.USED, settled_at=now, points_cost=10
        )
        reward.cost_points = 99
        await db_session.commit()

        # A live (PENDING) voucher must not contribute — only settled USED ones.
        await _seed_redemption(
            db_session, business, driver, reward, status=RedemptionStatus.PENDING, settled_at=None, points_cost=500
        )

        r = await db_api_client.get("/api/business/stats", headers=await _headers(owner))
        body = r.json()
        assert body["totalPointsCharged"] == 10
    finally:
        await _cleanup(db_session, business, drivers=(driver,))


# ─── Issued-to-redeemed ratio ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_issued_to_redeemed_ratio_counts_unsettled_issued_vouchers(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    reward = await _make_reward(db_session, business)
    owner = await _owner_of(db_session, business)
    now = datetime.now(UTC)
    try:
        await _seed_redemption(db_session, business, driver, reward, status=RedemptionStatus.USED, settled_at=now)
        # A live voucher — never settled, but still issued and must count in the denominator.
        await _seed_redemption(db_session, business, driver, reward, status=RedemptionStatus.PENDING, settled_at=None)

        r = await db_api_client.get("/api/business/stats", headers=await _headers(owner))
        body = r.json()
        assert body["vouchersIssued"] == 2
        assert body["vouchersRedeemed"] == 1
        assert body["issuedToRedeemedRatio"] == pytest.approx(0.5)
    finally:
        await _cleanup(db_session, business, drivers=(driver,))


@pytest.mark.asyncio
async def test_issued_to_redeemed_ratio_is_null_when_nothing_issued(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    business = await _make_business(db_session)
    owner = await _owner_of(db_session, business)
    try:
        r = await db_api_client.get("/api/business/stats", headers=await _headers(owner))
        body = r.json()
        assert body["vouchersIssued"] == 0
        assert body["issuedToRedeemedRatio"] is None
    finally:
        await _cleanup(db_session, business)


# ─── Most-redeemed rewards ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_top_rewards_ranked_by_used_count(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    popular = await _make_reward(db_session, business)
    unpopular = await _make_reward(db_session, business)
    owner = await _owner_of(db_session, business)
    now = datetime.now(UTC)
    try:
        for _ in range(3):
            await _seed_redemption(db_session, business, driver, popular, status=RedemptionStatus.USED, settled_at=now)
        await _seed_redemption(db_session, business, driver, unpopular, status=RedemptionStatus.USED, settled_at=now)
        # A PENDING voucher on the popular reward must not inflate its count.
        await _seed_redemption(db_session, business, driver, popular, status=RedemptionStatus.PENDING, settled_at=None)

        r = await db_api_client.get("/api/business/stats", headers=await _headers(owner))
        body = r.json()
        top = body["topRewards"]
        assert top[0]["rewardId"] == popular.id
        assert top[0]["redemptionCount"] == 3
        assert top[1]["rewardId"] == unpopular.id
        assert top[1]["redemptionCount"] == 1
    finally:
        await _cleanup(db_session, business, drivers=(driver,))


@pytest.mark.asyncio
async def test_top_rewards_is_capped_at_the_configured_limit(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    """Response size must not grow with catalog size — `topRewards` is a top-N, not a full ranking.

    Seeds more distinct redeemed-against rewards than the limit, each with a
    distinct count so the ranking is unambiguous, and asserts both that the
    page is truncated to the limit and that only the highest-ranked rewards
    survive the cut.
    """
    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    owner = await _owner_of(db_session, business)
    now = datetime.now(UTC)
    reward_count = business_service.TOP_REWARDS_LIMIT + 3
    try:
        rewards = [await _make_reward(db_session, business) for _ in range(reward_count)]
        # Reward i gets (i + 1) redemptions, so ranking and the cut are unambiguous:
        # the last TOP_REWARDS_LIMIT rewards created are the highest-ranked ones.
        for i, reward in enumerate(rewards):
            for _ in range(i + 1):
                await _seed_redemption(
                    db_session, business, driver, reward, status=RedemptionStatus.USED, settled_at=now
                )

        r = await db_api_client.get("/api/business/stats", headers=await _headers(owner))
        body = r.json()
        top = body["topRewards"]

        assert len(top) == business_service.TOP_REWARDS_LIMIT
        expected_top_ids = {reward.id for reward in rewards[-business_service.TOP_REWARDS_LIMIT :]}
        assert {row["rewardId"] for row in top} == expected_top_ids
        # Strictly descending by count, so the cut kept the highest counts, not an arbitrary slice.
        counts = [row["redemptionCount"] for row in top]
        assert counts == sorted(counts, reverse=True)
    finally:
        await _cleanup(db_session, business, drivers=(driver,))


# ─── Sold-out rewards (CAR-47 availability) ──────────────────────────────────


@pytest.mark.asyncio
async def test_sold_out_reward_appears_when_stock_is_fully_claimed(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    limited = await _make_reward(db_session, business, stock=1)
    unlimited = await _make_reward(db_session, business, stock=None)
    owner = await _owner_of(db_session, business)
    try:
        # A live PENDING voucher already claims the one unit (CAR-47's own rule).
        await _seed_redemption(db_session, business, driver, limited, status=RedemptionStatus.PENDING, settled_at=None)

        r = await db_api_client.get("/api/business/stats", headers=await _headers(owner))
        body = r.json()
        sold_out_ids = {row["rewardId"] for row in body["soldOutRewards"]}
        assert sold_out_ids == {limited.id}
        assert unlimited.id not in sold_out_ids
    finally:
        await _cleanup(db_session, business, drivers=(driver,))


@pytest.mark.asyncio
async def test_expired_voucher_frees_stock_and_reward_is_not_sold_out(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    reward = await _make_reward(db_session, business, stock=1)
    owner = await _owner_of(db_session, business)
    now = datetime.now(UTC)
    try:
        await _seed_redemption(db_session, business, driver, reward, status=RedemptionStatus.EXPIRED, settled_at=now)

        r = await db_api_client.get("/api/business/stats", headers=await _headers(owner))
        body = r.json()
        assert reward.id not in {row["rewardId"] for row in body["soldOutRewards"]}
    finally:
        await _cleanup(db_session, business, drivers=(driver,))


@pytest.mark.asyncio
async def test_archived_reward_is_never_reported_sold_out(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    reward = await _make_reward(db_session, business, stock=1)
    owner = await _owner_of(db_session, business)
    try:
        now = datetime.now(UTC)
        await _seed_redemption(db_session, business, driver, reward, status=RedemptionStatus.USED, settled_at=now)
        reward.archived_at = now
        await db_session.commit()

        r = await db_api_client.get("/api/business/stats", headers=await _headers(owner))
        body = r.json()
        assert reward.id not in {row["rewardId"] for row in body["soldOutRewards"]}
    finally:
        await _cleanup(db_session, business, drivers=(driver,))


# ─── Cross-business isolation ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_stats_are_scoped_to_the_caller_business(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    mine = await _make_business(db_session)
    theirs = await _make_business(db_session)
    driver = await _make_driver(db_session)
    my_reward = await _make_reward(db_session, mine, stock=1)
    their_reward = await _make_reward(db_session, theirs, stock=1)
    owner = await _owner_of(db_session, mine)
    now = datetime.now(UTC)
    try:
        await _seed_redemption(db_session, mine, driver, my_reward, status=RedemptionStatus.USED, settled_at=now)
        for _ in range(5):
            await _seed_redemption(
                db_session, theirs, driver, their_reward, status=RedemptionStatus.USED, settled_at=now
            )

        r = await db_api_client.get("/api/business/stats", headers=await _headers(owner))
        body = r.json()
        assert body["redemptionsToday"] == 1
        assert body["vouchersIssued"] == 1
        assert body["totalPointsCharged"] == my_reward.cost_points
        assert {row["rewardId"] for row in body["topRewards"]} == {my_reward.id}
    finally:
        await _cleanup(db_session, mine, theirs, drivers=(driver,))

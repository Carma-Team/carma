"""Business redemption history — CAR-79.

Covers the acceptance criteria directly: business scoping, the USED-only
default view, combined status/reward/date filtering, the live-voucher split,
role enforcement, driver-privacy, and the keyset pagination contract (no
skips or repeats across duplicate `settled_at` values, mixed statuses, or a
voucher settling mid-page).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.pagination import decode_cursor, encode_cursor
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

# ─── Fixtures ────────────────────────────────────────────────────────────────


async def _make_business(db: AsyncSession) -> Business:
    owner = User(
        email=f"_hbiz_{uuid.uuid4().hex[:10]}@carmatest.co.il",
        password_hash="x",
        role=UserRole.BUSINESS,
        name="History Biz",
    )
    db.add(owner)
    await db.flush()

    business = Business(
        owner_user_id=owner.id,
        name=f"History Biz {uuid.uuid4().hex[:6]}",
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
        email=f"_hmem_{uuid.uuid4().hex[:10]}@carmatest.co.il",
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
        email=f"_hdrv_{uuid.uuid4().hex[:10]}@carmatest.co.il",
        password_hash="x",
        name="History Driver",
        points=1000,
    )
    db.add(driver)
    await db.commit()
    await db.refresh(driver)
    return driver


async def _make_reward(db: AsyncSession, business: Business, *, cost_points: int = 10) -> Reward:
    reward = Reward(
        business_id=business.id,
        title_he="שובר בדיקה",
        description_he="תיאור",
        category=business.category,
        cost_points=cost_points,
        stock=None,
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
    consumed_by_user_id: str | None = None,
    points_cost: int | None = None,
    ttl: timedelta = timedelta(hours=1),
) -> Redemption:
    """A redemption row with a controlled status/settled_at, bypassing consume_voucher.

    History pagination tests need exact, sometimes-duplicate `settled_at`
    values and EXPIRED/CANCELLED rows — states `consume_voucher` alone cannot
    produce on demand.
    """
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
        consumed_by_user_id=consumed_by_user_id,
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
async def test_redemptions_endpoint_requires_auth() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/business/redemptions")
    assert r.status_code == 401


# ─── Role enforcement ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_cashier_cannot_read_history(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    business = await _make_business(db_session)
    cashier = await _add_member(db_session, business, BusinessMembershipRole.CASHIER)
    try:
        r = await db_api_client.get("/api/business/redemptions", headers=await _headers(cashier))
        assert r.status_code == 403
    finally:
        await _cleanup(db_session, business, drivers=(cashier,))


@pytest.mark.asyncio
async def test_manager_and_owner_can_read_history(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    business = await _make_business(db_session)
    manager = await _add_member(db_session, business, BusinessMembershipRole.MANAGER)
    owner = await _owner_of(db_session, business)
    try:
        for user in (manager, owner):
            r = await db_api_client.get("/api/business/redemptions", headers=await _headers(user))
            assert r.status_code == 200
    finally:
        await _cleanup(db_session, business, drivers=(manager,))


# ─── Default view and status filtering ──────────────────────────────────────


@pytest.mark.asyncio
async def test_default_view_is_used_only_and_excludes_live_vouchers(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    reward = await _make_reward(db_session, business)
    owner = await _owner_of(db_session, business)
    now = datetime.now(UTC)
    try:
        used = await _seed_redemption(
            db_session, business, driver, reward, status=RedemptionStatus.USED, settled_at=now
        )
        await _seed_redemption(
            db_session, business, driver, reward, status=RedemptionStatus.EXPIRED, settled_at=now - timedelta(hours=1)
        )
        await _seed_redemption(
            db_session, business, driver, reward, status=RedemptionStatus.CANCELLED, settled_at=now - timedelta(hours=2)
        )
        # A live voucher: PENDING, settled_at NULL, still inside its TTL.
        await _seed_redemption(db_session, business, driver, reward, status=RedemptionStatus.PENDING, settled_at=None)

        r = await db_api_client.get("/api/business/redemptions", headers=await _headers(owner))
        assert r.status_code == 200
        body = r.json()
        assert {row["id"] for row in body["redemptions"]} == {used.id}
        assert body["liveVoucherCount"] == 1
    finally:
        await _cleanup(db_session, business, drivers=(driver,))


@pytest.mark.asyncio
async def test_status_filter_alone_and_combined(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    reward = await _make_reward(db_session, business)
    owner = await _owner_of(db_session, business)
    now = datetime.now(UTC)
    try:
        used = await _seed_redemption(
            db_session, business, driver, reward, status=RedemptionStatus.USED, settled_at=now
        )
        expired = await _seed_redemption(
            db_session, business, driver, reward, status=RedemptionStatus.EXPIRED, settled_at=now - timedelta(minutes=1)
        )
        cancelled = await _seed_redemption(
            db_session,
            business,
            driver,
            reward,
            status=RedemptionStatus.CANCELLED,
            settled_at=now - timedelta(minutes=2),
        )
        headers = await _headers(owner)

        r = await db_api_client.get("/api/business/redemptions", params={"status": "expired"}, headers=headers)
        assert {row["id"] for row in r.json()["redemptions"]} == {expired.id}

        r = await db_api_client.get(
            "/api/business/redemptions", params={"status": "used,expired,cancelled"}, headers=headers
        )
        assert {row["id"] for row in r.json()["redemptions"]} == {used.id, expired.id, cancelled.id}

        r = await db_api_client.get("/api/business/redemptions", params={"status": "pending"}, headers=headers)
        assert r.status_code == 400
    finally:
        await _cleanup(db_session, business, drivers=(driver,))


# ─── Reward and date filters ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_reward_filter(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    reward_a = await _make_reward(db_session, business)
    reward_b = await _make_reward(db_session, business)
    owner = await _owner_of(db_session, business)
    now = datetime.now(UTC)
    try:
        row_a = await _seed_redemption(
            db_session, business, driver, reward_a, status=RedemptionStatus.USED, settled_at=now
        )
        await _seed_redemption(
            db_session, business, driver, reward_b, status=RedemptionStatus.USED, settled_at=now - timedelta(minutes=1)
        )

        r = await db_api_client.get(
            "/api/business/redemptions", params={"rewardId": reward_a.id}, headers=await _headers(owner)
        )
        assert {row["id"] for row in r.json()["redemptions"]} == {row_a.id}
    finally:
        await _cleanup(db_session, business, drivers=(driver,))


@pytest.mark.asyncio
async def test_date_range_filter(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    reward = await _make_reward(db_session, business)
    owner = await _owner_of(db_session, business)
    now = datetime.now(UTC)
    try:
        old = await _seed_redemption(
            db_session, business, driver, reward, status=RedemptionStatus.USED, settled_at=now - timedelta(days=10)
        )
        recent = await _seed_redemption(
            db_session, business, driver, reward, status=RedemptionStatus.USED, settled_at=now - timedelta(hours=1)
        )

        r = await db_api_client.get(
            "/api/business/redemptions",
            params={"from": (now - timedelta(days=1)).isoformat()},
            headers=await _headers(owner),
        )
        ids = {row["id"] for row in r.json()["redemptions"]}
        assert ids == {recent.id}
        assert old.id not in ids

        r = await db_api_client.get(
            "/api/business/redemptions",
            params={"to": (now - timedelta(days=1)).isoformat()},
            headers=await _headers(owner),
        )
        ids = {row["id"] for row in r.json()["redemptions"]}
        assert ids == {old.id}
        assert recent.id not in ids
    finally:
        await _cleanup(db_session, business, drivers=(driver,))


# ─── Cross-business isolation ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_another_businesss_redemptions_are_absent(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    mine = await _make_business(db_session)
    theirs = await _make_business(db_session)
    driver = await _make_driver(db_session)
    my_reward = await _make_reward(db_session, mine)
    their_reward = await _make_reward(db_session, theirs)
    owner = await _owner_of(db_session, mine)
    now = datetime.now(UTC)
    try:
        mine_row = await _seed_redemption(
            db_session, mine, driver, my_reward, status=RedemptionStatus.USED, settled_at=now
        )
        await _seed_redemption(db_session, theirs, driver, their_reward, status=RedemptionStatus.USED, settled_at=now)

        r = await db_api_client.get("/api/business/redemptions", headers=await _headers(owner))
        body = r.json()
        assert {row["id"] for row in body["redemptions"]} == {mine_row.id}
        assert body["liveVoucherCount"] == 0
    finally:
        await _cleanup(db_session, mine, theirs, drivers=(driver,))


# ─── Driver privacy (CAR-78) ─────────────────────────────────────────────────

_DRIVER_IDENTITY_KEYS = {"userId", "driverId", "driverName", "phone", "email"}


def _find_forbidden_keys(payload: object) -> set[str]:
    found: set[str] = set()
    if isinstance(payload, dict):
        for key, value in payload.items():
            if key in _DRIVER_IDENTITY_KEYS:
                found.add(key)
            found |= _find_forbidden_keys(value)
    elif isinstance(payload, list):
        for item in payload:
            found |= _find_forbidden_keys(item)
    return found


@pytest.mark.asyncio
async def test_response_never_carries_a_driver_identifier(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    reward = await _make_reward(db_session, business)
    owner = await _owner_of(db_session, business)
    now = datetime.now(UTC)
    try:
        await _seed_redemption(
            db_session,
            business,
            driver,
            reward,
            status=RedemptionStatus.USED,
            settled_at=now,
            consumed_by_user_id=owner.id,
        )

        r = await db_api_client.get("/api/business/redemptions", headers=await _headers(owner))
        assert r.status_code == 200
        body = r.json()
        assert _find_forbidden_keys(body) == set()
        # The business-staff attribution CAR-75 asked for is still present.
        assert body["redemptions"][0]["consumedByUserId"] == owner.id
        assert body["redemptions"][0]["consumedByName"] == owner.name
    finally:
        await _cleanup(db_session, business, drivers=(driver,))


# ─── Pagination (the core of CAR-79) ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_page_through_duplicate_settled_at_values_visits_every_row_once(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    """The test the `id` tiebreaker exists for."""
    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    reward = await _make_reward(db_session, business)
    owner = await _owner_of(db_session, business)
    same_instant = datetime.now(UTC)
    try:
        seeded = [
            await _seed_redemption(
                db_session, business, driver, reward, status=RedemptionStatus.USED, settled_at=same_instant
            )
            for _ in range(7)
        ]
        seeded_ids = {r.id for r in seeded}

        seen: set[str] = set()
        cursor: str | None = None
        headers = await _headers(owner)
        for _ in range(20):  # generous upper bound on page count; loop breaks itself
            params = {"limit": "2"}
            if cursor is not None:
                params["cursor"] = cursor
            r = await db_api_client.get("/api/business/redemptions", params=params, headers=headers)
            assert r.status_code == 200
            body = r.json()
            page_ids = [row["id"] for row in body["redemptions"]]
            assert seen.isdisjoint(page_ids), "a row reappeared on a later page"
            seen.update(page_ids)
            cursor = body["nextCursor"]
            if cursor is None:
                break
        else:
            pytest.fail("pagination never terminated")

        assert seen == seeded_ids
    finally:
        await _cleanup(db_session, business, drivers=(driver,))


@pytest.mark.asyncio
async def test_page_through_mixed_statuses_skips_nothing(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    """The case the old `used_at`-keyed cursor got wrong (CAR-120's replacement)."""
    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    reward = await _make_reward(db_session, business)
    owner = await _owner_of(db_session, business)
    now = datetime.now(UTC)
    try:
        statuses = [RedemptionStatus.USED, RedemptionStatus.EXPIRED, RedemptionStatus.CANCELLED]
        seeded = [
            await _seed_redemption(
                db_session,
                business,
                driver,
                reward,
                status=statuses[i % 3],
                settled_at=now - timedelta(seconds=i),
            )
            for i in range(9)
        ]
        seeded_ids = {r.id for r in seeded}

        seen: set[str] = set()
        cursor: str | None = None
        headers = await _headers(owner)
        params_base = {"status": "used,expired,cancelled", "limit": "4"}
        for _ in range(20):
            params = dict(params_base)
            if cursor is not None:
                params["cursor"] = cursor
            r = await db_api_client.get("/api/business/redemptions", params=params, headers=headers)
            assert r.status_code == 200
            body = r.json()
            page_ids = [row["id"] for row in body["redemptions"]]
            assert seen.isdisjoint(page_ids)
            seen.update(page_ids)
            cursor = body["nextCursor"]
            if cursor is None:
                break
        else:
            pytest.fail("pagination never terminated")

        assert seen == seeded_ids
    finally:
        await _cleanup(db_session, business, drivers=(driver,))


@pytest.mark.asyncio
async def test_a_settlement_mid_pagination_causes_no_skip_or_repeat(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    reward = await _make_reward(db_session, business)
    owner = await _owner_of(db_session, business)
    now = datetime.now(UTC)
    try:
        older = [
            await _seed_redemption(
                db_session,
                business,
                driver,
                reward,
                status=RedemptionStatus.USED,
                settled_at=now - timedelta(minutes=i),
            )
            for i in range(1, 5)
        ]
        headers = await _headers(owner)

        first = await db_api_client.get("/api/business/redemptions", params={"limit": "2"}, headers=headers)
        first_body = first.json()
        first_ids = {row["id"] for row in first_body["redemptions"]}
        cursor = first_body["nextCursor"]
        assert cursor is not None

        # A new voucher settles right now — newer than everything already paged.
        just_settled = await _seed_redemption(
            db_session, business, driver, reward, status=RedemptionStatus.USED, settled_at=now + timedelta(seconds=1)
        )

        second = await db_api_client.get(
            "/api/business/redemptions", params={"limit": "10", "cursor": cursor}, headers=headers
        )
        second_ids = {row["id"] for row in second.json()["redemptions"]}

        assert first_ids.isdisjoint(second_ids), "the new settlement must not duplicate a row already returned"
        assert just_settled.id not in second_ids, "a row newer than the cursor must not leak into an older page"
        assert second_ids == {r.id for r in older} - first_ids
    finally:
        await _cleanup(db_session, business, drivers=(driver,))


@pytest.mark.asyncio
async def test_next_cursor_is_null_at_the_end_of_the_list(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    reward = await _make_reward(db_session, business)
    owner = await _owner_of(db_session, business)
    now = datetime.now(UTC)
    try:
        await _seed_redemption(db_session, business, driver, reward, status=RedemptionStatus.USED, settled_at=now)

        r = await db_api_client.get("/api/business/redemptions", params={"limit": "50"}, headers=await _headers(owner))
        assert r.json()["nextCursor"] is None
    finally:
        await _cleanup(db_session, business, drivers=(driver,))


@pytest.mark.asyncio
async def test_page_size_is_capped_server_side(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    business = await _make_business(db_session)
    owner = await _owner_of(db_session, business)
    try:
        over_the_cap = business_service.REDEMPTION_HISTORY_MAX_LIMIT + 1
        r = await db_api_client.get(
            "/api/business/redemptions", params={"limit": str(over_the_cap)}, headers=await _headers(owner)
        )
        assert r.status_code == 422
    finally:
        await _cleanup(db_session, business)


@pytest.mark.asyncio
async def test_malformed_cursor_is_a_400(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    business = await _make_business(db_session)
    owner = await _owner_of(db_session, business)
    try:
        r = await db_api_client.get(
            "/api/business/redemptions", params={"cursor": "not-a-real-cursor"}, headers=await _headers(owner)
        )
        assert r.status_code == 400
    finally:
        await _cleanup(db_session, business)


# ─── Timezone-aware datetimes ────────────────────────────────────────────────

# `Redemption.settled_at` is `DateTime(timezone=True)` — every datetime that
# reaches a comparison against it must carry a UTC offset, whether it comes in
# as a `from`/`to` filter or decoded off a pagination cursor.


@pytest.mark.asyncio
async def test_naive_from_is_rejected(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    business = await _make_business(db_session)
    owner = await _owner_of(db_session, business)
    try:
        r = await db_api_client.get(
            "/api/business/redemptions",
            params={"from": "2026-01-01T00:00:00"},
            headers=await _headers(owner),
        )
        assert r.status_code == 400
    finally:
        await _cleanup(db_session, business)


@pytest.mark.asyncio
async def test_naive_to_is_rejected(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    business = await _make_business(db_session)
    owner = await _owner_of(db_session, business)
    try:
        r = await db_api_client.get(
            "/api/business/redemptions",
            params={"to": "2026-01-01T00:00:00"},
            headers=await _headers(owner),
        )
        assert r.status_code == 400
    finally:
        await _cleanup(db_session, business)


@pytest.mark.asyncio
async def test_aware_from_and_to_are_accepted(db_session: AsyncSession, db_api_client: AsyncClient) -> None:
    """A UTC offset must not be mistaken for the naive case it exists to rule out."""
    business = await _make_business(db_session)
    owner = await _owner_of(db_session, business)
    try:
        r = await db_api_client.get(
            "/api/business/redemptions",
            params={"from": "2026-01-01T00:00:00+02:00", "to": "2026-12-31T00:00:00Z"},
            headers=await _headers(owner),
        )
        assert r.status_code == 200
    finally:
        await _cleanup(db_session, business)


@pytest.mark.asyncio
async def test_a_syntactically_valid_cursor_with_a_naive_timestamp_is_rejected(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    """A well-formed cursor is not the same thing as a usable one.

    `encode_cursor` itself does not validate — only ever fed an aware
    `settled_at` in production — so this crafts what a tampered or
    hand-built cursor would look like: base64 of `naive-iso|id`, parseable,
    wrong.
    """
    business = await _make_business(db_session)
    owner = await _owner_of(db_session, business)
    try:
        naive_cursor = encode_cursor(datetime(2026, 1, 1, 0, 0, 0), uuid.uuid4().hex)  # noqa: DTZ001 - deliberately naive
        r = await db_api_client.get(
            "/api/business/redemptions",
            params={"cursor": naive_cursor},
            headers=await _headers(owner),
        )
        assert r.status_code == 400
    finally:
        await _cleanup(db_session, business)


def test_decode_cursor_rejects_a_naive_timestamp() -> None:
    naive_cursor = encode_cursor(datetime(2026, 1, 1, 0, 0, 0), uuid.uuid4().hex)  # noqa: DTZ001 - deliberately naive
    with pytest.raises(HTTPException) as exc:
        decode_cursor(naive_cursor)
    assert exc.value.status_code == 400


def test_decode_cursor_round_trips_an_aware_timestamp_unchanged() -> None:
    """Ordinary generated cursors — the vast majority of real traffic — must keep working."""
    aware = datetime(2026, 1, 1, 0, 0, 0, tzinfo=UTC)
    row_id = uuid.uuid4().hex
    decoded_at, decoded_id = decode_cursor(encode_cursor(aware, row_id))
    assert decoded_at == aware
    assert decoded_id == row_id


@pytest.mark.asyncio
async def test_a_real_generated_next_cursor_keeps_working_end_to_end(
    db_session: AsyncSession, db_api_client: AsyncClient
) -> None:
    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    reward = await _make_reward(db_session, business)
    owner = await _owner_of(db_session, business)
    now = datetime.now(UTC)
    try:
        older = await _seed_redemption(
            db_session, business, driver, reward, status=RedemptionStatus.USED, settled_at=now - timedelta(minutes=1)
        )
        await _seed_redemption(db_session, business, driver, reward, status=RedemptionStatus.USED, settled_at=now)
        headers = await _headers(owner)

        first = await db_api_client.get("/api/business/redemptions", params={"limit": "1"}, headers=headers)
        cursor = first.json()["nextCursor"]
        assert cursor is not None

        second = await db_api_client.get(
            "/api/business/redemptions", params={"limit": "1", "cursor": cursor}, headers=headers
        )
        assert second.status_code == 200
        assert {row["id"] for row in second.json()["redemptions"]} == {older.id}
    finally:
        await _cleanup(db_session, business, drivers=(driver,))


# ─── Unit-level: status filter parsing ───────────────────────────────────────


def test_parse_redemption_status_filter_defaults_to_used_only() -> None:
    assert business_service.parse_redemption_status_filter(None) == {RedemptionStatus.USED}


def test_parse_redemption_status_filter_rejects_pending() -> None:
    with pytest.raises(Exception) as exc:  # noqa: PT011 - HTTPException, checked below
        business_service.parse_redemption_status_filter("pending")
    assert getattr(exc.value, "status_code", None) == 400


def test_parse_redemption_status_filter_combines_values() -> None:
    assert business_service.parse_redemption_status_filter("used, expired") == {
        RedemptionStatus.USED,
        RedemptionStatus.EXPIRED,
    }

"""The level discount, at the till.

`LevelDef.discount_pct` existed from the first migration. It was seeded, served
to the client, and printed on the roadmap screen as "25% הנחה" — and the store
charged every driver the full list price at every level, because no code read
it. This suite is what keeps that from being true again.

The unit tests pin the arithmetic; the database tests prove the charge.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token
from app.database import get_db
from app.main import app
from app.models import Business, BusinessCategory, Redemption, Reward, User
from app.models.enums import UserRole
from app.services import levels
from app.services import rewards as rewards_service

# ─── the arithmetic ───────────────────────────────────────────────────────────


class TestEffectiveCost:
    def test_the_bottom_of_the_ladder_pays_list_price(self):
        assert levels.by_number(1).discount_pct == 0
        assert rewards_service.effective_cost(1_000, 1) == 1_000

    def test_the_top_of_the_ladder_pays_the_advertised_share(self):
        assert rewards_service.effective_cost(1_000, 10) == 750  # 25% off

    def test_every_level_charges_exactly_what_its_discount_says(self):
        for lv in levels.LEVELS:
            assert rewards_service.effective_cost(1_000, lv.number) == 1_000 - lv.discount_pct * 10

    def test_the_price_never_rises_with_the_level(self):
        prices = [rewards_service.effective_cost(999, lv.number) for lv in levels.LEVELS]
        assert prices == sorted(prices, reverse=True)

    def test_rounding_falls_the_drivers_way(self):
        # 999 at 25% is 749.25. The driver pays 749, never 750.
        assert rewards_service.effective_cost(999, 10) == 749

    def test_an_out_of_range_level_is_clamped_not_crashed(self):
        # `by_number` clamps, so a corrupt level column cannot 500 the store.
        assert rewards_service.effective_cost(1_000, 0) == 1_000
        assert rewards_service.effective_cost(1_000, 99) == rewards_service.effective_cost(1_000, levels.MAX_LEVEL)

    def test_the_price_is_never_negative(self):
        assert rewards_service.effective_cost(1, levels.MAX_LEVEL) >= 0


# ─── the charge ───────────────────────────────────────────────────────────────


async def _driver(db: AsyncSession, *, level: int, points: int) -> User:
    user = User(
        id=uuid.uuid4().hex,
        phone=f"+9725{uuid.uuid4().int % 10**8:08d}",
        name="Discount Test",
        role=UserRole.DRIVER,
        points=points,
        total_points=points,
        level=level,
    )
    db.add(user)
    await db.commit()
    return user


async def _reward(db: AsyncSession, *, cost_points: int) -> Reward:
    business = Business(
        id=uuid.uuid4().hex,
        name="Test Fuel Co",
        name_he="דלק לבדיקה",
        category=BusinessCategory.FUEL,
        location_lat=32.08,
        location_lng=34.78,
    )
    db.add(business)
    await db.flush()
    reward = Reward(
        id=uuid.uuid4().hex,
        business_id=business.id,
        title_he="הנחה בתדלוק",
        title_en="Fuel discount",
        description_he="תיאור",
        category=BusinessCategory.FUEL,
        cost_points=cost_points,
        stock=10,
    )
    db.add(reward)
    await db.commit()
    return reward


async def _cleanup(db: AsyncSession, user: User, reward: Reward) -> None:
    await db.execute(delete(Redemption).where(Redemption.user_id == user.id))
    await db.execute(delete(Reward).where(Reward.id == reward.id))
    await db.execute(delete(Business).where(Business.id == reward.business_id))
    await db.execute(delete(User).where(User.id == user.id))
    await db.commit()


@pytest.mark.asyncio
async def test_the_balance_falls_by_the_discounted_price(db_session: AsyncSession) -> None:
    user = await _driver(db_session, level=10, points=2_000)
    reward = await _reward(db_session, cost_points=1_000)
    try:
        await rewards_service.redeem(db_session, user, reward.id)

        remaining = await db_session.scalar(select(User.points).where(User.id == user.id))
        assert remaining == 1_250, "a level 10 driver must be charged 750, not the 1,000 list price"
    finally:
        await _cleanup(db_session, user, reward)


@pytest.mark.asyncio
async def test_a_driver_who_can_only_afford_the_discount_can_still_buy(db_session: AsyncSession) -> None:
    """The test that would have failed for every driver before this change.

    800 points, a 1,000-point reward, 25% off. Level 10 pays 750 and walks out
    with the voucher; the old code refused the sale as "Insufficient points".
    """
    user = await _driver(db_session, level=10, points=800)
    reward = await _reward(db_session, cost_points=1_000)
    try:
        voucher = await rewards_service.redeem(db_session, user, reward.id)
        assert voucher.code

        remaining = await db_session.scalar(select(User.points).where(User.id == user.id))
        assert remaining == 50
    finally:
        await _cleanup(db_session, user, reward)


@pytest.mark.asyncio
async def test_a_beginner_gets_no_discount_and_is_refused(db_session: AsyncSession) -> None:
    # The discount must be a real gate, not a rounding error applied to everyone.
    user = await _driver(db_session, level=1, points=800)
    reward = await _reward(db_session, cost_points=1_000)
    try:
        with pytest.raises(Exception) as exc:
            await rewards_service.redeem(db_session, user, reward.id)
        assert "Insufficient" in str(exc.value)

        remaining = await db_session.scalar(select(User.points).where(User.id == user.id))
        assert remaining == 800, "a refused redemption must not touch the balance"
    finally:
        await _cleanup(db_session, user, reward)


@pytest.mark.asyncio
async def test_the_catalogue_shows_the_price_it_will_charge(db_session: AsyncSession) -> None:
    """What the driver is quoted and what they are charged come from one function.

    Two prices for one purchase is the shape of #29, and it is the reason the
    client is not allowed to compute the discount itself.
    """
    user = await _driver(db_session, level=7, points=5_000)
    reward = await _reward(db_session, cost_points=1_000)
    try:
        listing = await rewards_service.list_rewards(db_session, user, None)
        quoted = next(r for r in listing["rewards"] if r.id == reward.id)  # type: ignore[attr-defined]

        assert quoted.cost_points == 1_000, "the list price stays visible — it is the business's number"
        assert quoted.effective_cost_points == 850

        before = await db_session.scalar(select(User.points).where(User.id == user.id))
        await rewards_service.redeem(db_session, user, reward.id)
        after = await db_session.scalar(select(User.points).where(User.id == user.id))
        assert before - after == quoted.effective_cost_points
    finally:
        await _cleanup(db_session, user, reward)


@pytest.mark.asyncio
async def test_the_catalogue_endpoint_prices_for_the_caller(db_session: AsyncSession) -> None:
    """Through the router, with a real token — the service tests bypass it.

    `list_rewards` now takes the whole user rather than an id, because it needs
    the level. That signature change lives in the router, so it needs a test
    that actually goes through one.

    `get_db` is overridden with the fixture's session rather than left to the
    app's module-level engine: asyncpg connections belong to the loop that
    opened them, and pytest-asyncio gives every test its own loop (see
    conftest). Without the override this test poisons the pool for later ones.
    """
    user = await _driver(db_session, level=10, points=2_000)
    reward = await _reward(db_session, cost_points=1_000)
    token = create_access_token(user_id=user.id, email=None, phone=user.phone, role=UserRole.DRIVER)

    async def _use_the_fixture_session() -> AsyncIterator[AsyncSession]:
        yield db_session

    app.dependency_overrides[get_db] = _use_the_fixture_session
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            r = await client.get("/api/rewards", headers={"Authorization": f"Bearer {token}"})

        assert r.status_code == 200
        row = next(x for x in r.json()["rewards"] if x["id"] == reward.id)
        assert row["costPoints"] == 1_000
        assert row["effectiveCostPoints"] == 750
    finally:
        app.dependency_overrides.pop(get_db, None)
        await _cleanup(db_session, user, reward)


@pytest.mark.asyncio
async def test_the_voucher_carries_no_viewer_price(db_session: AsyncSession) -> None:
    # The reward embedded in a voucher is the catalogue entry, not the receipt.
    # Leaving it None is honest; filling it with today's price would not be.
    user = await _driver(db_session, level=10, points=2_000)
    reward = await _reward(db_session, cost_points=1_000)
    try:
        voucher = await rewards_service.redeem(db_session, user, reward.id)
        assert voucher.reward.effective_cost_points is None
    finally:
        await _cleanup(db_session, user, reward)

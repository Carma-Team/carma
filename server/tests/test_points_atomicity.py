"""Points-balance atomicity — the regression guard CAR-12 §4 never got.

`user.points` is written in exactly two places in the whole server: the credit in
`services/trips.py` and the conditional debit in `services/rewards.py`. Both do
their arithmetic inside an UPDATE, so Postgres serialises them on the row lock.
Both are correct today, and until now neither had a single test — a refactor back
to a Python-side `user.points += n` would have passed the entire suite while
silently losing points in production, with no error anywhere to notice.

**Why these catch that without riding on a lucky interleaving.** Each racer gets
its own session *and its own `User` instance*, both loaded before the race starts,
so both hold the same balance in memory. A Python-side read-modify-write reads
that stale attribute and writes an absolute value, so whichever transaction
commits last erases the other — every run. The SQL-side expression re-reads the
committed row under the lock, and both land.

The first two tests race with `asyncio.gather` and assert only what holds
whichever racer wins. The last two pin the commit order outright, because each
order is what exposes a different one of the two writers — left to `gather`,
redeem reliably commits first and the other ordering never runs.

Two engines rather than one, because two coroutines sharing a connection would
queue instead of contending. Needs Postgres — two real connections is the whole
point — and skips without it via the `db_session` fixture.
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import pytest
from fastapi import HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings
from app.models import Business, BusinessCategory, Redemption, Reward, Trip, User
from app.models.enums import UserRole
from app.schemas.trip import SaveTripIn
from app.services import rewards as rewards_service
from app.services import trips as trips_service


@asynccontextmanager
async def _rival_session() -> AsyncIterator[AsyncSession]:
    """A second session on its own engine — the other half of the race.

    Built the same way `db_session` builds its own (see conftest for why the
    engine is per-test rather than shared). Local to this file: one file needing
    a second connection does not justify a fixture everyone else has to read past.
    """
    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    try:
        async with factory() as session:
            yield session
    finally:
        await engine.dispose()


async def _make_driver(db: AsyncSession, *, points: int) -> User:
    user = User(
        email=f"_atomic_{uuid.uuid4().hex[:10]}@carma.test",
        password_hash="x",
        role=UserRole.DRIVER,
        name="Atomicity Test",
        points=points,
        total_points=points,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _make_reward(db: AsyncSession, *, cost_points: int) -> Reward:
    """A redeemable reward, with stock far above anything these tests consume.

    The stock check in `redeem` is deliberately *not* atomic — over-issuing a
    voucher is documented as acceptable. Leaving stock tight here would make it
    the thing that fails and prove nothing about the points balance.
    """
    owner = User(
        email=f"_atomic_biz_{uuid.uuid4().hex[:10]}@carma.test",
        password_hash="x",
        role=UserRole.BUSINESS,
        name="Atomicity Biz",
    )
    db.add(owner)
    await db.flush()

    business = Business(
        owner_user_id=owner.id,
        name=f"Atomicity Biz {uuid.uuid4().hex[:6]}",
        category=BusinessCategory.FOOD,
        location_lat=32.07,
        location_lng=34.78,
    )
    db.add(business)
    await db.flush()

    reward = Reward(
        business_id=business.id,
        title_he="קפה חינם",
        description_he="כוס קפה על חשבון הבית",
        category=BusinessCategory.FOOD,
        cost_points=cost_points,
        stock=1000,
        is_active=True,
    )
    db.add(reward)
    await db.commit()
    await db.refresh(reward)
    return reward


async def _cleanup(db: AsyncSession, user: User, reward: Reward | None = None) -> None:
    await db.execute(delete(Redemption).where(Redemption.user_id == user.id))
    await db.execute(delete(Trip).where(Trip.user_id == user.id))
    await db.execute(delete(User).where(User.id == user.id))
    await db.commit()
    if reward is not None:
        business = await db.get(Business, reward.business_id)
        if business is not None:
            owner_id = business.owner_user_id
            await db.delete(business)  # rewards cascade with the business
            await db.commit()
            if owner_id:
                await db.execute(delete(User).where(User.id == owner_id))
                await db.commit()


def _scoring_trip() -> SaveTripIn:
    """A clean 8km trip — enough distance and quality to be worth points."""
    return SaveTripIn(
        distanceKm=8.0,
        durationSeconds=1200,
        hardBrakes=0,
        aggressiveAccels=0,
        sharpTurns=0,
        touchEpochs=0,
        screenInteractionSeconds=0,
    )


async def _balance(db: AsyncSession, user_id: str) -> int:
    """Read the balance from the row, never from a session's cached object.

    The sessionmaker sets `expire_on_commit=False` and `trips_service.save` does
    not refresh the user, so an in-memory `user.points` can be arbitrarily stale —
    asserting on it would test the ORM cache instead of the database.
    """
    balance = await db.scalar(select(User.points).where(User.id == user_id))
    assert balance is not None
    return balance


@pytest.mark.asyncio
async def test_concurrent_trip_saves_both_credit_their_points(db_session: AsyncSession) -> None:
    """Two trips finishing at once must both land. A lost update drops one."""
    user = await _make_driver(db_session, points=0)
    try:
        async with _rival_session() as rival_db:
            rival_user = await rival_db.get(User, user.id)
            assert rival_user is not None, "both racers must hold the same starting balance"

            first, second = await asyncio.gather(
                trips_service.save(db_session, user, _scoring_trip(), idempotency_key=uuid.uuid4().hex),
                trips_service.save(rival_db, rival_user, _scoring_trip(), idempotency_key=uuid.uuid4().hex),
            )

        # Setup precondition, not the thing under test: a scoring change that
        # zeroed these would make the assertion below hold vacuously.
        assert first.points > 0 and second.points > 0, "both trips must be worth points for this to prove anything"

        # Asserted against what the server actually awarded rather than a
        # hardcoded number — the daily cap and the rolling score both move.
        assert await _balance(db_session, user.id) == first.points + second.points
    finally:
        await _cleanup(db_session, user)


@pytest.mark.asyncio
async def test_concurrent_redeems_cannot_spend_the_same_points_twice(db_session: AsyncSession) -> None:
    """One reward's worth of points, two simultaneous redeems: exactly one wins."""
    cost = 500
    reward = await _make_reward(db_session, cost_points=cost)
    user = await _make_driver(db_session, points=cost)
    try:
        async with _rival_session() as rival_db:
            rival_user = await rival_db.get(User, user.id)
            assert rival_user is not None

            # Both racers pass the Python pre-check in `redeem` — they each see a
            # balance of `cost`. Only the conditional UPDATE can separate them.
            results = await asyncio.gather(
                rewards_service.redeem(db_session, user, reward.id),
                rewards_service.redeem(rival_db, rival_user, reward.id),
                return_exceptions=True,
            )

        failures = [r for r in results if isinstance(r, BaseException)]
        assert len(failures) == 1, f"exactly one redeem must be refused, got {results}"
        refused = failures[0]
        assert isinstance(refused, HTTPException)
        assert refused.status_code == 400
        assert refused.detail == "Insufficient points"

        assert await _balance(db_session, user.id) == 0, "the balance must not go negative"

        # The assertion that bites hardest: without the WHERE guard both debits
        # compute cost - cost = 0 from their stale objects, the balance still
        # reads 0, and the business has quietly handed out two vouchers.
        vouchers = await db_session.scalar(
            select(func.count()).select_from(Redemption).where(Redemption.user_id == user.id)
        )
        assert vouchers == 1, "one reward's worth of points must issue exactly one voucher"
    finally:
        await _cleanup(db_session, user, reward)


# ─── CAR-12 §4 as written: a trip save racing a redeem, in both orderings ────
#
# The overlap is real in both: the second actor loaded its `User` before the
# first committed, which is exactly the state two overlapping API requests are
# in. Only the commit order is pinned — `gather` would always give the same one,
# because redeem awaits far less than a trip save, which queries scoring history.


@pytest.mark.asyncio
async def test_a_redeem_cannot_erase_a_trip_credit_that_landed_first(db_session: AsyncSession) -> None:
    """Trip commits, then a redeem holding a pre-trip view of the balance spends.

    The debit must apply to the balance in the row — starting points plus the
    trip's — not to the `cost` its own stale object still reports. A debit that
    wrote an absolute figure would take the balance to zero and swallow the trip.
    """
    cost = 500
    reward = await _make_reward(db_session, cost_points=cost)
    user = await _make_driver(db_session, points=cost)
    try:
        async with _rival_session() as rival_db:
            # Loaded before the trip lands: from here on this object is stale.
            rival_user = await rival_db.get(User, user.id)
            assert rival_user is not None

            trip = await trips_service.save(db_session, user, _scoring_trip(), idempotency_key=uuid.uuid4().hex)
            assert trip.points > 0, "the trip must be worth points for this to prove anything"

            await rewards_service.redeem(rival_db, rival_user, reward.id)

        assert await _balance(db_session, user.id) == trip.points
    finally:
        await _cleanup(db_session, user, reward)


@pytest.mark.asyncio
async def test_a_trip_credit_cannot_erase_a_redeem_that_landed_first(db_session: AsyncSession) -> None:
    """Redeem commits, then a trip save holding a pre-redeem view of the balance credits.

    The mirror image: the credit must add to the debited row, not to the `cost`
    its own stale object still reports, which would refund the redemption.
    """
    cost = 500
    reward = await _make_reward(db_session, cost_points=cost)
    user = await _make_driver(db_session, points=cost)
    try:
        async with _rival_session() as rival_db:
            rival_user = await rival_db.get(User, user.id)
            assert rival_user is not None

            await rewards_service.redeem(rival_db, rival_user, reward.id)

            # `user` in this session still reports the pre-redeem balance.
            trip = await trips_service.save(db_session, user, _scoring_trip(), idempotency_key=uuid.uuid4().hex)
            assert trip.points > 0, "the trip must be worth points for this to prove anything"

        assert await _balance(db_session, user.id) == trip.points
    finally:
        await _cleanup(db_session, user, reward)

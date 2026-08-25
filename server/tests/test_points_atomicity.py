"""Points-balance atomicity — the regression guard CAR-12 §4 never got.

`user.points` is written in exactly one place in the whole server: the credit in
`services/trips.py`, an atomic SQL-side `points = points + n`. Issuing a voucher
no longer debits it (CAR-73) — it reserves instead, holding `points_cost` against
the driver's *available* balance (`points - reserved`, `reserved` the sum over
their live vouchers) without ever writing `User.points`. A refactor back to a
Python-side `user.points += n` in the trip credit would still pass the suite
while silently losing points in production, with no error anywhere to notice —
that is what the first test below still guards.

The next three no longer guard a debit — there is none to race — they guard the
available-balance check itself: the reserved-points sum and the voucher INSERT
that follows it must be one indivisible step under `redeem`'s user-row lock, so
concurrent redeems (or a redeem racing a trip credit) can never jointly reserve
more than the row actually holds.

**Why these catch that without riding on a lucky interleaving.** Each racer gets
its own session *and its own `User` instance*, both loaded before the race
starts, so both hold the same stale balance in memory. Code that read that
stale attribute instead of a freshly locked row would let both racers see the
same headroom and both reserve against it. `redeem`'s `SELECT ... FOR UPDATE`
on the user row is what forces the loser to re-read the committed balance
instead.

The first, second and fourth tests race with `asyncio.gather` and assert only
what holds whichever racer wins (or, for the fourth, whichever order the
database picks). The third pins the commit order outright: it is testing which
of two orderings redeem's balance check reads, and `gather` would always
resolve the same one — redeem awaits far less than a trip save, which queries
scoring history — so the other ordering would never run.

Two engines rather than one, because two coroutines sharing a connection would
queue instead of contending. Needs Postgres — two real connections is the whole
point — and skips without it via the `db_session` fixture.

**The last two tests guard a different layer (CAR-98).** The balance arithmetic
being safe says nothing about the *daily anti-grind caps*, whose inputs are read
from committed trips before any lock is held. Those live here rather than in
`test_scoring.py` because what they prove is concurrency, not arithmetic.
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
from app.models import Business, BusinessCategory, Redemption, Reward, Trip, User
from app.models.enums import RedemptionStatus, UserRole
from app.schemas.trip import SaveTripIn
from app.services import business as business_service
from app.services import rewards as rewards_service
from app.services import scoring
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


async def _cleanup(db: AsyncSession, user: User, *rewards: Reward) -> None:
    await db.execute(delete(Redemption).where(Redemption.user_id == user.id))
    await db.execute(delete(Trip).where(Trip.user_id == user.id))
    await db.execute(delete(User).where(User.id == user.id))
    await db.commit()
    for reward in rewards:
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
    """Two *different* rewards, each affordable alone, together exceed the balance.

    Deliberately not the same reward for both racers: `redeem` also takes
    `FOR UPDATE` on the reward row (for the stock/voucher-cap checks, unrelated
    to CAR-73), and racing one reward would serialise the two redeems on that
    lock alone — passing even with CAR-73's user-row lock deleted entirely.
    Two separate reward rows mean the *only* thing that can still serialise
    them is the lock on the shared `User` row.
    """
    balance = 600
    cost_a, cost_b = 400, 400  # each fits alone; together they don't.
    reward_a = await _make_reward(db_session, cost_points=cost_a)
    reward_b = await _make_reward(db_session, cost_points=cost_b)
    user = await _make_driver(db_session, points=balance)
    try:
        async with _rival_session() as rival_db:
            rival_user = await rival_db.get(User, user.id)
            assert rival_user is not None

            # Both racers pass the Python pre-check in `redeem` — they each see a
            # balance of `balance` and no reservations yet, against different
            # reward rows. Only the user-row lock around the reserved-points
            # check can separate them.
            results = await asyncio.gather(
                rewards_service.redeem(db_session, user, reward_a.id),
                rewards_service.redeem(rival_db, rival_user, reward_b.id),
                return_exceptions=True,
            )

        failures = [r for r in results if isinstance(r, BaseException)]
        assert len(failures) == 1, f"exactly one redeem must be refused, got {results}"
        refused = failures[0]
        assert isinstance(refused, HTTPException)
        assert refused.status_code == 400
        assert refused.detail == "Insufficient points"

        assert await _balance(db_session, user.id) == balance, "issuing a voucher must never touch User.points"

        # The assertion that bites hardest: without the user-row lock, both
        # racers sum the same (empty) reserved total against their own,
        # independently-locked reward row, both see `balance` of headroom, and
        # the business has quietly handed out two vouchers this driver's balance
        # cannot jointly cover.
        vouchers = await db_session.scalar(
            select(func.count()).select_from(Redemption).where(Redemption.user_id == user.id)
        )
        assert vouchers == 1, "the available balance must issue exactly one of the two vouchers"
        # Costs are equal, so whichever racer won, reserved must reflect only that one.
        assert await rewards_service.reserved_points(db_session, user.id) == cost_a
    finally:
        await _cleanup(db_session, user, reward_a, reward_b)


@pytest.mark.asyncio
async def test_concurrent_consumes_of_one_voucher_charge_exactly_once(db_session: AsyncSession) -> None:
    """Two tills scan the same QR at once. Exactly one wins, and the debit lands exactly once.

    CAR-109's debit joins the existing conditional UPDATE on `Redemption`
    (`status=PENDING AND expires_at>now`) rather than taking a lock of its own —
    that UPDATE's row lock is what already serialises the two tills. This proves
    the debit inherits that guarantee: the loser's UPDATE affects zero rows and
    never reaches the debit at all, so the winner's `points_cost` is taken from
    the balance exactly once, not twice and not zero times.
    """
    cost = 300
    balance = 1000
    reward = await _make_reward(db_session, cost_points=cost)
    user = await _make_driver(db_session, points=balance)
    try:
        business = await db_session.get(Business, reward.business_id)
        assert business is not None

        code = uuid.uuid4().hex[:12].upper()
        voucher = Redemption(
            user_id=user.id,
            reward_id=reward.id,
            business_id=reward.business_id,
            points_cost=cost,
            qr_code=code,
            qr_data=code,
            status=RedemptionStatus.PENDING,
            expires_at=datetime.now(UTC) + timedelta(minutes=5),
        )
        db_session.add(voucher)
        await db_session.commit()

        async with _rival_session() as rival_db:
            rival_business = await rival_db.get(Business, reward.business_id)
            assert rival_business is not None

            results = await asyncio.gather(
                business_service.consume_voucher(db_session, business, code),
                business_service.consume_voucher(rival_db, rival_business, code),
                return_exceptions=True,
            )

        failures = [r for r in results if isinstance(r, BaseException)]
        assert len(failures) == 1, f"exactly one consume must be refused, got {results}"
        refused = failures[0]
        assert isinstance(refused, HTTPException)
        assert refused.status_code == 409

        # The assertion that bites hardest: a debit racing the conditional UPDATE
        # instead of joining its transaction could run twice (double charge) or,
        # gated on balance, zero times (voucher USED but never paid for).
        assert await _balance(db_session, user.id) == balance - cost, "the debit must land exactly once"
    finally:
        await _cleanup(db_session, user, reward)


# ─── CAR-12 §4 as written: a trip save racing a redeem ───────────────────────
#
# The overlap in the first is real: the second actor loaded its `User` before
# the first committed, which is exactly the state two overlapping API requests
# are in. The commit order is pinned rather than left to `gather` — redeem
# awaits far less than a trip save, which queries scoring history, so `gather`
# would always resolve the same order and the other one would never run.
#
# The second used to be that test's mirror: a redeem committing first, then a
# trip credit racing a stale view of the balance. Post-CAR-73 that pairing
# cannot expose an unsafe interleaving under any implementation — the credit is
# an unconditional `points + n` that never reads anything redeem wrote, so
# whichever order the two land in, both effects always survive; there is no
# stale absolute-write path left for either side to erase the other's work.
# What CAR-73 actually put at risk here is different: `redeem` now holds a
# `FOR UPDATE` lock on the user row for the length of its whole transaction —
# a lock a credit landing on the very same row must wait behind. Run for real
# with `gather` rather than sequential awaits, this proves that overlap
# resolves cleanly rather than stalling or losing either side's effect.


@pytest.mark.asyncio
async def test_a_redeem_cannot_erase_a_trip_credit_that_landed_first(db_session: AsyncSession) -> None:
    """Trip commits, then a redeem holding a pre-trip view of the balance reserves.

    The driver starts with nothing, so the redeem can only succeed at all if its
    available-balance check reads the committed row — points plus the trip's —
    rather than the `0` its own stale object still reports. Code that trusted the
    stale attribute would wrongly refuse a redeem the real balance can afford.
    """
    reward = await _make_reward(db_session, cost_points=1)
    user = await _make_driver(db_session, points=0)
    try:
        async with _rival_session() as rival_db:
            # Loaded before the trip lands: from here on this object is stale.
            rival_user = await rival_db.get(User, user.id)
            assert rival_user is not None

            trip = await trips_service.save(db_session, user, _scoring_trip(), idempotency_key=uuid.uuid4().hex)
            assert trip.points > 0, "the trip must be worth points for this to prove anything"

            await rewards_service.redeem(rival_db, rival_user, reward.id)

        assert await _balance(db_session, user.id) == trip.points, "issuing a voucher must never touch User.points"
        assert await rewards_service.reserved_points(db_session, user.id) == 1
    finally:
        await _cleanup(db_session, user, reward)


@pytest.mark.asyncio
async def test_a_trip_credit_does_not_stall_or_lose_a_concurrent_redeems_reservation(
    db_session: AsyncSession,
) -> None:
    """A redeem and a trip credit land on the same user row at the same time.

    `redeem` holds `FOR UPDATE` on that row for its whole transaction — reward
    lock, cooldown check, live-voucher check, the reserved-points check, the
    voucher INSERT, then commit. The trip's credit is an independent UPDATE on
    the same row, so real overlap (`gather`, not sequential awaits) forces one
    to queue behind the other. Whichever order the database picks, both effects
    must land: the credit must not be lost, and the lock must not stall it
    indefinitely or let its read miss the reservation.
    """
    cost = 500
    reward = await _make_reward(db_session, cost_points=cost)
    user = await _make_driver(db_session, points=cost)
    try:
        async with _rival_session() as rival_db:
            rival_user = await rival_db.get(User, user.id)
            assert rival_user is not None

            _, trip = await asyncio.gather(
                rewards_service.redeem(rival_db, rival_user, reward.id),
                trips_service.save(db_session, user, _scoring_trip(), idempotency_key=uuid.uuid4().hex),
            )
            assert trip.points > 0, "the trip must be worth points for this to prove anything"

        assert (
            await _balance(db_session, user.id) == cost + trip.points
        ), "the credit must add to the row, and the reservation must not have debited it"
        assert await rewards_service.reserved_points(db_session, user.id) == cost
    finally:
        await _cleanup(db_session, user, reward)


# ─── CAR-98: the daily anti-grind caps under concurrency ─────────────────────
#
# Both seed the day's history directly and leave the driver at level 1, so the
# level bonus stays 1.0 and the only thing shaping the award is the cap.


async def _seed_todays_trip(db: AsyncSession, user: User, *, points: int, distance_km: float) -> None:
    """A trip already committed today — the daily total the caps are read from.

    Inserted directly rather than through `save`, which would also move
    `total_points` and with it the driver's level, and the level bonus scales
    the award. Keeping it out means a failure can only be the cap.
    """
    db.add(
        Trip(
            user_id=user.id,
            start_time=datetime.now(UTC),
            duration_seconds=1200,
            distance_km=distance_km,
            avg_score=85.0,
            score_v2=85.0,
            points=points,
        )
    )
    await db.commit()


@pytest.mark.asyncio
async def test_concurrent_saves_cannot_exceed_the_daily_points_cap(db_session: AsyncSession) -> None:
    """A driver near the daily cap fires two saves at once. They share the remainder.

    Without the lock both read the same `points_today`, both compute the same
    headroom, and both award it in full — the day ends over the cap by exactly
    the number of racers minus one. This is the bypass CAR-98 describes.
    """
    headroom = 5
    cap = int(scoring.CONFIG.daily_points_cap)
    user = await _make_driver(db_session, points=0)
    try:
        await _seed_todays_trip(db_session, user, points=cap - headroom, distance_km=5.0)

        async with _rival_session() as rival_db:
            rival_user = await rival_db.get(User, user.id)
            assert rival_user is not None

            first, second = await asyncio.gather(
                trips_service.save(db_session, user, _scoring_trip(), idempotency_key=uuid.uuid4().hex),
                trips_service.save(rival_db, rival_user, _scoring_trip(), idempotency_key=uuid.uuid4().hex),
            )

        # Setup precondition: an uncapped trip here is worth far more than the
        # headroom, so whatever lands must have been cut down by the cap.
        assert headroom < 50, "the headroom must be small enough that the cap, not the score, is what binds"

        awarded_today = await db_session.scalar(
            select(func.coalesce(func.sum(Trip.points), 0)).where(Trip.user_id == user.id)
        )
        assert awarded_today <= cap, f"the day totalled {awarded_today} against a cap of {cap}"

        # Sharper than the sum alone: it pins *how* the cap held. One racer takes
        # the remainder, the other arrives to none left. A sum that passed with
        # both racers awarded 2 or 3 would be the bug rounding in our favour.
        assert sorted((first.points, second.points)) == [0, headroom]
        assert first.points_capped and second.points_capped, "both saves were cut by the cap and must say so"
    finally:
        await _cleanup(db_session, user)


@pytest.mark.asyncio
async def test_concurrent_saves_cannot_exceed_the_daily_distance_cap(db_session: AsyncSession) -> None:
    """The same read, the other cap: distance counted toward points.

    Seeded just under the distance cap with no points spent, so the points cap
    has room and only the distance limit can bite. With the kilometres used up,
    the second racer's trip earns nothing however clean it was.
    """
    user = await _make_driver(db_session, points=0)
    try:
        await _seed_todays_trip(
            db_session,
            user,
            points=0,
            distance_km=scoring.CONFIG.daily_distance_cap_km - 1.0,
        )

        async with _rival_session() as rival_db:
            rival_user = await rival_db.get(User, user.id)
            assert rival_user is not None

            first, second = await asyncio.gather(
                trips_service.save(db_session, user, _scoring_trip(), idempotency_key=uuid.uuid4().hex),
                trips_service.save(rival_db, rival_user, _scoring_trip(), idempotency_key=uuid.uuid4().hex),
            )

        earned = sorted((first.points, second.points))
        assert earned[0] == 0, "the racer that arrives second finds no kilometres left"
        assert earned[1] > 0, "the racer that arrives first must still be paid for the last kilometre"
    finally:
        await _cleanup(db_session, user)

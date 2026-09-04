"""settled_at — one timestamp for every terminal voucher state (CAR-120).

Before this, only `used_at` existed and only consume wrote it, so EXPIRED rows
had no settle time to order or page by. These cover the three write paths that
set it and the ordering property CAR-79's history pagination depends on.
"""

from __future__ import annotations

import importlib.util
import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import ModuleType

import pytest
from sqlalchemy import select, text
from sqlalchemy.engine import Connection
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession

from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
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
    member_id = business.owner_user_id
    assert member_id is not None
    try:
        reward = await _make_reward(db_session, business)
        voucher = _voucher(reward, driver)
        db_session.add(voucher)
        await db_session.commit()
        await db_session.refresh(voucher)

        await business_service.consume_voucher(db_session, business, voucher.qr_code, consumed_by_user_id=member_id)

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


# ─── Contract-phase guarantees restored (CAR-287) ────────────────────────────
#
# 0019 backfilled business_id/settled_at then immediately tightened business_id
# to NOT NULL and added a CHECK tying settled_at to status, in the same
# migration deploy.yml applies before the rollout. For the length of that
# rollout the *previous* image — which predates CAR-120 and writes neither
# column — was still serving against the tightened schema and would 500 on
# every voucher write, so 0029 relaxed both back for the release. 0031
# restores them once every write path sets both columns unconditionally
# (true since CAR-120 shipped). Head is 0031, so the ambient `db_session`
# here is the restored schema — these prove the guarantee it restores is
# actually enforced, the mirror image of what this section tested while 0029
# was head. The relaxed-window behavior itself is still covered directly,
# against real migration DDL, in the 0029 and 0031 round-trip tests below.


@pytest.mark.asyncio
async def test_insert_without_business_id_is_rejected_at_head(db_session: AsyncSession) -> None:
    """The write the pre-CAR-120 issue path made (rewards.py:219 in CAR-283)
    is exactly what 0031's restored NOT NULL must now reject."""
    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    try:
        reward = await _make_reward(db_session, business)
        with pytest.raises(IntegrityError):
            async with db_session.begin_nested():
                voucher = _voucher(reward, driver)
                voucher.business_id = None
                db_session.add(voucher)
                await db_session.flush()
    finally:
        await _cleanup(db_session, business, driver)


@pytest.mark.asyncio
async def test_terminal_status_without_settled_at_is_rejected_at_head(db_session: AsyncSession) -> None:
    """The write the pre-CAR-120 consume/expire paths made (business.py:188
    and rewards.py:121 in CAR-283) is exactly what 0031's restored CHECK must
    now reject."""
    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    try:
        reward = await _make_reward(db_session, business)
        voucher = _voucher(reward, driver)
        db_session.add(voucher)
        await db_session.commit()
        await db_session.refresh(voucher)

        with pytest.raises(IntegrityError):
            async with db_session.begin_nested():
                voucher.status = RedemptionStatus.EXPIRED
                await db_session.flush()
    finally:
        await _cleanup(db_session, business, driver)


# ─── Migration 0029 downgrade — backfill coverage ────────────────────────────


def _load_migration_module(filename: str) -> ModuleType:
    """Import an alembic version file itself, so tests that need its SQL or
    its real `upgrade()`/`downgrade()` can't drift silently out of sync with
    a hand-copied version — same reasoning as
    `test_business_memberships._load_backfill_sql`."""
    path = Path(__file__).resolve().parent.parent / "alembic" / "versions" / filename
    spec = importlib.util.spec_from_file_location(f"_{path.stem}_migration", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _load_0029_module() -> ModuleType:
    return _load_migration_module("0029_redemption_settled_relax.py")


def _load_0031_module() -> ModuleType:
    return _load_migration_module("0031_redemption_settled_restore.py")


def _load_0029_backfill_sql() -> tuple[str, tuple[str, ...]]:
    """The exact SQL `0029_redemption_settled_relax.downgrade()` runs."""
    module = _load_0029_module()
    business_sql: str = module.BUSINESS_ID_BACKFILL_SQL
    settled_sql: tuple[str, ...] = module.SETTLED_AT_BACKFILL_SQL
    return business_sql, settled_sql


@pytest.mark.asyncio
async def test_downgrade_backfill_leaves_no_row_that_would_block_restoring_constraints(
    db_session: AsyncSession,
) -> None:
    """Rows the expand-window write paths above leave incomplete are exactly
    what downgrade's backfill must clear before NOT NULL/CHECK can be restored.

    Runs the migration's own backfill SQL, in a transaction rolled back at the
    end so nothing leaks into the shared dev database.
    """
    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    try:
        reward = await _make_reward(db_session, business)
        # Head is 0031 (restored NOT NULL/CHECK) — reach the relaxed shape
        # for real first, so the incomplete rows below can even be flushed.
        conn = await db_session.connection()
        await _run_migration_fn(conn, _load_0031_module().downgrade)

        no_business_id = _voucher(reward, driver, status=RedemptionStatus.PENDING)
        no_business_id.business_id = None
        unsettled_used = _voucher(reward, driver, status=RedemptionStatus.USED, used_at=datetime.now(UTC))
        unsettled_expired = _voucher(reward, driver, status=RedemptionStatus.EXPIRED)
        db_session.add_all([no_business_id, unsettled_used, unsettled_expired])
        # flush, not commit — the redemption rows and the backfill below stay
        # inside one open transaction that gets rolled back at the end, so
        # nothing this test writes for its own sake lands in the shared dev
        # database. business/driver/reward were already committed by the
        # helpers above and are cleaned up normally in the `finally`.
        await db_session.flush()

        business_sql, settled_sql = _load_0029_backfill_sql()
        await db_session.execute(text(business_sql))
        for statement in settled_sql:
            await db_session.execute(text(statement))

        for row in (no_business_id, unsettled_used, unsettled_expired):
            await db_session.refresh(row)
        assert no_business_id.business_id == reward.business_id
        assert unsettled_used.settled_at == unsettled_used.used_at
        assert unsettled_expired.settled_at == unsettled_expired.expires_at

        await db_session.rollback()
    finally:
        await _cleanup(db_session, business, driver)


# ─── Migration 0029 — full alembic upgrade/downgrade cycle ──────────────────
#
# The test above proves the backfill SQL in isolation. This one drives the
# migration's real `upgrade()`/`downgrade()` through Alembic's own Operations
# bridge — the same mechanism `alembic/env.py` uses — against the live
# `redemptions` table, so a broken `op.*` call would fail here even though the
# backfill SQL itself is correct.

CONSTRAINT_NAME = "ck_redemptions_settled_at_matches_status"


async def _run_migration_fn(conn: AsyncConnection, fn: Callable[[], None]) -> None:
    """Run one migration function for real against `conn`'s live transaction.

    `MigrationContext.configure` + `Operations.context` is what Alembic's own
    `env.py` sets up before calling a migration's `upgrade()`/`downgrade()` —
    those call the module-level `alembic.op` proxy, which resolves to
    whichever Operations instance is currently installed. Recreating that here
    means the migration's actual code runs, DDL included, inside a transaction
    this test controls and never commits.
    """

    def _sync(sync_conn: Connection) -> None:
        context = MigrationContext.configure(sync_conn)
        with Operations.context(context):
            fn()

    await conn.run_sync(_sync)


async def _business_id_nullable(conn: AsyncConnection) -> bool:
    result = await conn.execute(
        text(
            "SELECT is_nullable FROM information_schema.columns "
            "WHERE table_name = 'redemptions' AND column_name = 'business_id'"
        )
    )
    return bool(result.scalar_one() == "YES")


async def _settled_at_check_exists(conn: AsyncConnection) -> bool:
    result = await conn.execute(text("SELECT 1 FROM pg_constraint WHERE conname = :n"), {"n": CONSTRAINT_NAME})
    return result.first() is not None


@pytest.mark.asyncio
async def test_migration_0029_upgrade_downgrade_upgrade_against_real_ddl(db_session: AsyncSession) -> None:
    """0028 -> 0029 -> write like the outgoing image -> 0029 -> 0028 -> 0029,
    all against real Postgres DDL, inside one transaction rolled back at the
    end so nothing leaks into the shared dev database.

    Head is 0031 (CAR-287 restored NOT NULL/the CHECK), not 0029 — so unlike
    when this test was written, the ambient schema starts *contracted*. The
    0031 downgrade step below reaches the same shape 0029's own upgrade()
    produces (0031's own down_revision chain — 0030 and everything between
    it and 0027_city_reference — doesn't touch `redemptions`) without
    touching the shared `alembic_version` table, then everything from there
    exercises 0029's upgrade()/downgrade() exactly as before.
    """
    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    try:
        reward = await _make_reward(db_session, business)
        module = _load_0029_module()
        conn = await db_session.connection()

        assert not await _business_id_nullable(conn), "precondition: schema must already be at head (0031)"
        assert await _settled_at_check_exists(conn), "precondition: schema must already be at head (0031)"

        # Reach 0029's relaxed shape for real, via 0031's downgrade (every
        # revision between 0027_city_reference and 0031 is a no-op for
        # `redemptions`, so this lands exactly where 0029.upgrade() would
        # from a real 0028 base).
        await _run_migration_fn(conn, _load_0031_module().downgrade)
        assert await _business_id_nullable(conn)
        assert not await _settled_at_check_exists(conn)

        # Reach 0028 for real.
        await _run_migration_fn(conn, module.downgrade)
        assert not await _business_id_nullable(conn)
        assert await _settled_at_check_exists(conn)

        # 1. Upgrade 0028 -> 0029.
        await _run_migration_fn(conn, module.upgrade)

        # 2. Relaxed: nullable, no CHECK.
        assert await _business_id_nullable(conn)
        assert not await _settled_at_check_exists(conn)

        # 3. Writes the outgoing (pre-CAR-120) image makes during the relaxed
        # window: no business_id, and a terminal status with no settled_at.
        no_business_id = _voucher(reward, driver, status=RedemptionStatus.PENDING)
        no_business_id.business_id = None
        unsettled_used = _voucher(reward, driver, status=RedemptionStatus.USED, used_at=datetime.now(UTC))
        unsettled_expired = _voucher(reward, driver, status=RedemptionStatus.EXPIRED)
        db_session.add_all([no_business_id, unsettled_used, unsettled_expired])
        await db_session.flush()  # real INSERTs — must not raise

        # 4. Downgrade 0029 -> 0028.
        await _run_migration_fn(conn, module.downgrade)

        # 5. Backfill ran, and ran before the constraints below were
        # restored — if it hadn't, restoring them would have failed on the
        # rows just inserted.
        for row in (no_business_id, unsettled_used, unsettled_expired):
            await db_session.refresh(row)
        assert no_business_id.business_id == reward.business_id
        assert unsettled_used.settled_at == unsettled_used.used_at
        assert unsettled_expired.settled_at == unsettled_expired.expires_at

        # 6. NOT NULL and the CHECK are restored and enforced. Each probe runs
        # in its own SAVEPOINT so the expected failure doesn't abort the
        # outer transaction this test rolls back.
        assert not await _business_id_nullable(conn)
        assert await _settled_at_check_exists(conn)

        with pytest.raises(IntegrityError):
            async with db_session.begin_nested():
                bad = _voucher(reward, driver, status=RedemptionStatus.PENDING)
                bad.business_id = None
                db_session.add(bad)
                await db_session.flush()

        with pytest.raises(IntegrityError):
            async with db_session.begin_nested():
                bad = _voucher(reward, driver, status=RedemptionStatus.EXPIRED)
                db_session.add(bad)
                await db_session.flush()

        # 7. Upgrade again — the schema returns cleanly to the expand state.
        await _run_migration_fn(conn, module.upgrade)
        assert await _business_id_nullable(conn)
        assert not await _settled_at_check_exists(conn)
    finally:
        await db_session.rollback()
        await _cleanup(db_session, business, driver)


# ─── Migration 0031 — the contract phase (CAR-287) ───────────────────────────
#
# Mirror image of the 0029 tests above: 0031 restores exactly what 0029
# relaxed. These drive 0031's own upgrade()/downgrade() through the same
# Alembic Operations bridge, against real Postgres DDL, inside one
# transaction rolled back at the end.


@pytest.mark.asyncio
async def test_migration_0031_upgrade_fails_clearly_when_a_row_cannot_be_backfilled(
    db_session: AsyncSession,
) -> None:
    """A CANCELLED row with no settled_at has no honest source to backfill
    from — same reasoning CAR-120 and CAR-283 both give for excluding
    CANCELLED from the backfill entirely. 0031.upgrade() must raise a clear,
    specific error instead of fabricating a value or leaving Postgres to
    reject the ALTER with a generic constraint-violation error, and must
    leave the schema exactly as it found it — no partial state.
    """
    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    try:
        reward = await _make_reward(db_session, business)
        module = _load_0031_module()
        conn = await db_session.connection()

        # Reach the relaxed (pre-0031) shape for real.
        await _run_migration_fn(conn, module.downgrade)
        assert await _business_id_nullable(conn)
        assert not await _settled_at_check_exists(conn)

        unresolvable = _voucher(reward, driver, status=RedemptionStatus.CANCELLED)
        db_session.add(unresolvable)
        await db_session.flush()

        with pytest.raises(RuntimeError, match="CAR-287"):
            await _run_migration_fn(conn, module.upgrade)

        # No partial state: schema is untouched by the failed attempt.
        assert await _business_id_nullable(conn)
        assert not await _settled_at_check_exists(conn)
    finally:
        await db_session.rollback()
        await _cleanup(db_session, business, driver)


@pytest.mark.asyncio
async def test_migration_0031_upgrade_downgrade_upgrade_against_real_ddl(db_session: AsyncSession) -> None:
    """0027_city_reference -> 0031 (backfill + restore) -> 0027_city_reference
    (relax) -> 0031, all against real Postgres DDL, inside one transaction
    rolled back at the end.

    Head is already 0031 — true here too, and true in CI, which runs
    `alembic upgrade head` before pytest — so this downgrades first to reach
    a genuine pre-0031 starting point, the same technique the 0029 test uses.
    """
    business = await _make_business(db_session)
    driver = await _make_driver(db_session)
    try:
        reward = await _make_reward(db_session, business)
        module = _load_0031_module()
        conn = await db_session.connection()

        assert not await _business_id_nullable(conn), "precondition: schema must already be at head (0031)"
        assert await _settled_at_check_exists(conn), "precondition: schema must already be at head (0031)"

        # Reach the pre-0031 (0027_city_reference) state for real.
        await _run_migration_fn(conn, module.downgrade)
        assert await _business_id_nullable(conn)
        assert not await _settled_at_check_exists(conn)

        # Writes shaped like the CAR-283 relaxed window: no business_id, and
        # a terminal status with no settled_at. 0031.upgrade() must backfill
        # these — not reject them at insert time (that's what the CHECK does
        # once restored) — before restoring the constraints.
        no_business_id = _voucher(reward, driver, status=RedemptionStatus.PENDING)
        no_business_id.business_id = None
        unsettled_used = _voucher(reward, driver, status=RedemptionStatus.USED, used_at=datetime.now(UTC))
        unsettled_expired = _voucher(reward, driver, status=RedemptionStatus.EXPIRED)
        db_session.add_all([no_business_id, unsettled_used, unsettled_expired])
        await db_session.flush()  # real INSERTs — must not raise (schema is relaxed)

        # 1. Upgrade 0027_city_reference -> 0031: backfill runs, then NOT
        # NULL/CHECK restore.
        await _run_migration_fn(conn, module.upgrade)

        # 2. Backfill landed before the constraints were restored — if it
        # hadn't, restoring them would have failed on the rows just inserted.
        for row in (no_business_id, unsettled_used, unsettled_expired):
            await db_session.refresh(row)
        assert no_business_id.business_id == reward.business_id
        assert unsettled_used.settled_at == unsettled_used.used_at
        assert unsettled_expired.settled_at == unsettled_expired.expires_at

        # 3. NOT NULL and the CHECK are restored and enforced.
        assert not await _business_id_nullable(conn)
        assert await _settled_at_check_exists(conn)

        with pytest.raises(IntegrityError):
            async with db_session.begin_nested():
                bad = _voucher(reward, driver, status=RedemptionStatus.PENDING)
                bad.business_id = None
                db_session.add(bad)
                await db_session.flush()

        with pytest.raises(IntegrityError):
            async with db_session.begin_nested():
                bad = _voucher(reward, driver, status=RedemptionStatus.EXPIRED)
                db_session.add(bad)
                await db_session.flush()

        # 4. Downgrade 0031 -> 0027_city_reference: relaxes cleanly, no
        # backfill needed going this direction.
        await _run_migration_fn(conn, module.downgrade)
        assert await _business_id_nullable(conn)
        assert not await _settled_at_check_exists(conn)

        # 5. Upgrade again — returns cleanly to the restored (head) state.
        await _run_migration_fn(conn, module.upgrade)
        assert not await _business_id_nullable(conn)
        assert await _settled_at_check_exists(conn)
    finally:
        await db_session.rollback()
        await _cleanup(db_session, business, driver)

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import CursorResult, and_, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.sql import ColumnElement

from app.core.audit import audit
from app.core.security import random_voucher_code
from app.models import BusinessCategory, Redemption, RedemptionStatus, Reward, User
from app.schemas.reward import RewardOut, VoucherOut

VOUCHER_TTL_MINUTES = 5  # spec 5.2.5 — QR code valid for 5 minutes

REWARD_OUT_OF_STOCK = "REWARD_OUT_OF_STOCK"

# Three draws is plenty: at 31^10 the first one already almost never collides,
# and a fourth would only ever be papering over a broken generator.
VOUCHER_CODE_ATTEMPTS = 3

_CATEGORY_BY_STR = {c.value.lower(): c for c in BusinessCategory}


async def claimed_by_reward(db: AsyncSession, reward_ids: list[str]) -> dict[str, int]:
    """Units of each reward currently spoken for.

    `Reward.stock` is the total the business allocated and is never written back
    to — what is left is derived from the redemptions ledger instead. A unit is
    claimed while a voucher is live (PENDING and inside its TTL) and stays
    claimed once USED. EXPIRED and CANCELLED release theirs.

    The predicate tests `expires_at` directly rather than trusting the stored
    status, so the count is right even for rows lazy expiry has not settled yet.
    It does not depend on `expire_overdue` having run.
    """
    if not reward_ids:
        return {}

    rows = await db.execute(
        select(Redemption.reward_id, func.count())
        .where(
            Redemption.reward_id.in_(reward_ids),
            or_(
                Redemption.status == RedemptionStatus.USED,
                and_(
                    Redemption.status == RedemptionStatus.PENDING,
                    Redemption.expires_at > datetime.now(UTC),
                ),
            ),
        )
        .group_by(Redemption.reward_id)
    )
    return {reward_id: count for reward_id, count in rows.all()}


def available_units(stock: int | None, claimed: int) -> int | None:
    """Units a driver can still take. None means unlimited — no cap was set."""
    if stock is None:
        return None
    return max(stock - claimed, 0)


async def expire_overdue(db: AsyncSession, *where: ColumnElement[bool]) -> None:
    """Flip PENDING vouchers whose TTL has run out to EXPIRED.

    Nothing runs on a timer, so the transition happens lazily on the next read of
    the rows in question — the driver listing their vouchers, or a business
    scanning one. `where` narrows it to those rows so a single scan never sweeps
    the whole table.

    Transaction-neutral: issues the UPDATE and nothing else. Callers commit, so
    settling expiry can sit inside a wider transaction — holding a row lock while
    checking stock, or crediting points in the same breath as the status flip.
    A commit in here would end that transaction and drop those locks.
    """
    await db.execute(
        update(Redemption)
        .where(
            Redemption.status == RedemptionStatus.PENDING,
            Redemption.expires_at < datetime.now(UTC),
            *where,
        )
        .values(status=RedemptionStatus.EXPIRED)
    )


async def list_rewards(db: AsyncSession, user_id: str, category_str: str | None) -> dict[str, object]:
    where: list[ColumnElement[bool]] = [Reward.is_active.is_(True)]
    if category_str and category_str.lower() in _CATEGORY_BY_STR:
        where.append(Reward.category == _CATEGORY_BY_STR[category_str.lower()])

    rewards = (
        await db.scalars(
            select(Reward).where(*where).options(selectinload(Reward.business)).order_by(Reward.cost_points.asc())
        )
    ).all()

    vouchers = await _list_user_vouchers(db, user_id)
    claimed = await claimed_by_reward(db, [r.id for r in rewards] + [v.reward_id for v in vouchers])
    return {
        "rewards": [RewardOut.from_orm_reward(r, available_units(r.stock, claimed.get(r.id, 0))) for r in rewards],
        "vouchers": [_voucher_out(v, claimed) for v in vouchers],
    }


async def list_my_vouchers(db: AsyncSession, user_id: str) -> dict[str, object]:
    vouchers = await _list_user_vouchers(db, user_id)
    claimed = await claimed_by_reward(db, [v.reward_id for v in vouchers])
    return {"vouchers": [_voucher_out(v, claimed) for v in vouchers]}


def _voucher_out(v: Redemption, claimed: dict[str, int]) -> VoucherOut:
    return VoucherOut.from_orm_redemption(v, available_units(v.reward.stock, claimed.get(v.reward_id, 0)))


async def redeem(db: AsyncSession, user: User, reward_id: str) -> VoucherOut:
    # FOR UPDATE, so the availability count below and the INSERT that follows are
    # one indivisible step. Without it two drivers racing for the last unit both
    # count 1 remaining and both get a voucher. Postgres serialises them here
    # instead: the loser blocks until the winner commits, then re-counts and sees
    # 0. selectinload issues its own SELECT afterwards, so eager-loading the
    # business does not turn this into a locked join.
    reward = await db.scalar(
        select(Reward).where(Reward.id == reward_id).options(selectinload(Reward.business)).with_for_update()
    )
    if reward is None or not reward.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Reward not available")
    if user.points < reward.cost_points:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Insufficient points")

    claimed = await claimed_by_reward(db, [reward.id])
    if available_units(reward.stock, claimed.get(reward.id, 0)) == 0:
        # `is None` means unlimited and must never land here; only a real 0 does.
        await db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {"code": REWARD_OUT_OF_STOCK, "message": "This reward is out of stock"},
        )

    code = await _allocate_voucher_code(db)
    if code is None:
        # Three draws from 31^10 all landing on taken codes is not bad luck, it
        # is a broken generator. Give up here, before the debit, rather than
        # charging a driver for a voucher we cannot write.
        await db.rollback()
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Could not allocate a voucher code — please try again",
        )

    expires_at = datetime.now(UTC) + timedelta(minutes=VOUCHER_TTL_MINUTES)

    # Atomic conditional debit — two concurrent redeems cannot both pass the
    # points check above and drive the balance negative.
    # `execute` is typed as returning a plain Result, which has no rowcount.
    # A DML statement always yields a CursorResult at runtime — the annotation
    # tells mypy that, it does not change behaviour.
    debited: CursorResult[Any] = await db.execute(  # type: ignore[assignment]
        update(User)
        .where(User.id == user.id, User.points >= reward.cost_points)
        .values(points=User.points - reward.cost_points)
    )
    if debited.rowcount == 0:
        await db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Insufficient points")

    redemption = Redemption(
        user_id=user.id,
        reward_id=reward.id,
        qr_code=code,
        qr_data=code,
        status=RedemptionStatus.PENDING,
        expires_at=expires_at,
    )
    db.add(redemption)
    await db.commit()
    await db.refresh(user)
    await db.refresh(redemption)
    # eager-load reward+business for response
    await db.refresh(redemption, attribute_names=["reward"])
    audit(
        "rewards.redeemed",
        user_id=user.id,
        reward_id=reward.id,
        cost_points=reward.cost_points,
        voucher_id=redemption.id,
    )
    # Re-counted after the commit so the response reflects the unit just taken.
    claimed = await claimed_by_reward(db, [reward.id])
    return VoucherOut.from_orm_redemption(redemption, available_units(reward.stock, claimed.get(reward.id, 0)))


async def _allocate_voucher_code(db: AsyncSession) -> str | None:
    """A code no redemption is already holding, or None if every draw was taken.

    `redemptions.qr_code` is UNIQUE over every row ever written, not just the
    live ones, so the collision odds grow with the whole table rather than with
    the handful of vouchers open right now. At 31^10 that is remote, but the
    losing side of it is a driver's redeem failing on a constraint violation —
    asking first turns that into a second draw.

    The constraint is still what guarantees uniqueness; two callers can pass
    this check with the same code in the same instant. That is the collision
    this makes rare, not one it makes impossible.

    Returns None rather than raising, and never touches the transaction: the
    caller opened it, holds a row lock inside it, and is the only one that knows
    what else has to unwind. Same rule `expire_overdue` follows.
    """
    for _ in range(VOUCHER_CODE_ATTEMPTS):
        code = random_voucher_code()
        if await db.scalar(select(Redemption.id).where(Redemption.qr_code == code)) is None:
            return code
    return None


async def _list_user_vouchers(db: AsyncSession, user_id: str) -> list[Redemption]:
    # Both listing endpoints go through here, so this is the one place a driver's
    # own stale vouchers get settled before they are shown. expire_overdue leaves
    # the commit to us — this is a read path with nothing else in flight, so the
    # settle stands on its own.
    await expire_overdue(db, Redemption.user_id == user_id)
    await db.commit()
    rows = await db.scalars(
        select(Redemption)
        .where(Redemption.user_id == user_id)
        .options(selectinload(Redemption.reward).selectinload(Reward.business))
        .order_by(Redemption.created_at.desc())
        .limit(50)
    )
    return list(rows.all())

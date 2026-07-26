from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.audit import audit
from app.core.security import random_voucher_code
from app.models import BusinessCategory, Redemption, RedemptionStatus, Reward, User
from app.schemas.reward import RewardOut, VoucherOut
from app.services import levels

VOUCHER_TTL_MINUTES = 5  # spec 5.2.5 — QR code valid for 5 minutes

_CATEGORY_BY_STR = {c.value.lower(): c for c in BusinessCategory}


def effective_cost(cost_points: int, level: int) -> int:
    """What a driver at `level` actually pays for a reward listed at `cost_points`.

    This function is the level discount. Before it existed, `LevelDef.discount_pct`
    was seeded, served to the client, printed on the roadmap screen — and never
    read at the till. Every driver paid list price at every level.

    Integer arithmetic throughout, floored, so the price is exact and the
    rounding always falls the driver's way.
    """
    discount_pct = levels.by_number(level).discount_pct
    if discount_pct <= 0:
        return cost_points
    return max(0, cost_points * (100 - discount_pct) // 100)


async def list_rewards(db: AsyncSession, user: User, category_str: str | None) -> dict[str, object]:
    from sqlalchemy.sql import ColumnElement

    where: list[ColumnElement[bool]] = [Reward.is_active.is_(True)]
    if category_str and category_str.lower() in _CATEGORY_BY_STR:
        where.append(Reward.category == _CATEGORY_BY_STR[category_str.lower()])

    rewards = (
        await db.scalars(
            select(Reward).where(*where).options(selectinload(Reward.business)).order_by(Reward.cost_points.asc())
        )
    ).all()

    # The catalogue is the one place a price is shown before it is charged, so
    # it is the one place that carries the viewer's price. `redeem` recomputes
    # it from the stored level rather than trusting anything sent back.
    vouchers = await _list_user_vouchers(db, user.id)
    return {
        "rewards": [
            RewardOut.from_orm_reward(r, effective_cost_points=effective_cost(r.cost_points, user.level))
            for r in rewards
        ],
        "vouchers": [VoucherOut.from_orm_redemption(r) for r in vouchers],
    }


async def list_my_vouchers(db: AsyncSession, user_id: str) -> dict[str, object]:
    vouchers = await _list_user_vouchers(db, user_id)
    return {"vouchers": [VoucherOut.from_orm_redemption(r) for r in vouchers]}


async def redeem(db: AsyncSession, user: User, reward_id: str) -> VoucherOut:
    reward = await db.scalar(select(Reward).where(Reward.id == reward_id).options(selectinload(Reward.business)))
    if reward is None or not reward.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Reward not available")

    # Priced from the level on the stored user row — never from anything the
    # client sent, and never from the price it was shown in the catalogue.
    price = effective_cost(reward.cost_points, user.level)
    if user.points < price:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Insufficient points")

    code = random_voucher_code()
    expires_at = datetime.now(UTC) + timedelta(minutes=VOUCHER_TTL_MINUTES)

    # Atomic conditional debit — two concurrent redeems cannot both pass the
    # points check above and drive the balance negative. The guard and the
    # subtraction must use the same `price`, or that guarantee is gone.
    debited = await db.execute(
        update(User).where(User.id == user.id, User.points >= price).values(points=User.points - price)
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
    # Both prices are logged: the list price reconciles against the business's
    # catalogue, `points_charged` against the driver's balance. They differ by
    # the level discount, and only the log records which level applied.
    audit(
        "rewards.redeemed",
        user_id=user.id,
        reward_id=reward.id,
        cost_points=reward.cost_points,
        points_charged=price,
        level=user.level,
        voucher_id=redemption.id,
    )
    return VoucherOut.from_orm_redemption(redemption)


async def _list_user_vouchers(db: AsyncSession, user_id: str) -> list[Redemption]:
    rows = await db.scalars(
        select(Redemption)
        .where(Redemption.user_id == user_id)
        .options(selectinload(Redemption.reward).selectinload(Reward.business))
        .order_by(Redemption.created_at.desc())
        .limit(50)
    )
    return list(rows.all())

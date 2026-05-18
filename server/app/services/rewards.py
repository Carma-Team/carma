from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.audit import audit
from app.core.security import random_voucher_code
from app.models import BusinessCategory, Redemption, RedemptionStatus, Reward, User
from app.schemas.reward import RewardOut, VoucherOut

VOUCHER_TTL_MINUTES = 5  # spec 5.2.5 — QR code valid for 5 minutes

_CATEGORY_BY_STR = {c.value.lower(): c for c in BusinessCategory}


async def list_rewards(db: AsyncSession, user_id: str, category_str: str | None) -> dict[str, object]:
    from sqlalchemy.sql import ColumnElement

    where: list[ColumnElement[bool]] = [Reward.is_active.is_(True)]
    if category_str and category_str.lower() in _CATEGORY_BY_STR:
        where.append(Reward.category == _CATEGORY_BY_STR[category_str.lower()])

    rewards = (
        await db.scalars(
            select(Reward).where(*where).options(selectinload(Reward.business)).order_by(Reward.cost_points.asc())
        )
    ).all()

    vouchers = await _list_user_vouchers(db, user_id)
    return {
        "rewards": [RewardOut.from_orm_reward(r) for r in rewards],
        "vouchers": [VoucherOut.from_orm_redemption(r) for r in vouchers],
    }


async def list_my_vouchers(db: AsyncSession, user_id: str) -> dict[str, object]:
    vouchers = await _list_user_vouchers(db, user_id)
    return {"vouchers": [VoucherOut.from_orm_redemption(r) for r in vouchers]}


async def redeem(db: AsyncSession, user: User, reward_id: str) -> VoucherOut:
    reward = await db.scalar(select(Reward).where(Reward.id == reward_id).options(selectinload(Reward.business)))
    if reward is None or not reward.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Reward not available")
    if user.points < reward.cost_points:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Insufficient points")

    code = random_voucher_code()
    expires_at = datetime.now(UTC) + timedelta(minutes=VOUCHER_TTL_MINUTES)

    user.points -= reward.cost_points
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

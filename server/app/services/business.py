from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.audit import audit
from app.models import Business, BusinessCategory, Redemption, Reward
from app.schemas.reward import BusinessRewardIn, BusinessRewardPatchIn, RewardOut

_CATEGORY_BY_STR = {c.value.lower(): c for c in BusinessCategory}


def _parse_category(value: str) -> BusinessCategory:
    category = _CATEGORY_BY_STR.get(value.lower())
    if category is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown category '{value}'")
    return category


async def _owned_reward(db: AsyncSession, business: Business, reward_id: str) -> Reward:
    """Load a reward that belongs to this business, or 404.

    A reward owned by *another* business also yields 404 rather than 403 — a 403
    would confirm the id exists and leak the catalog of a competitor.
    """
    reward = await db.scalar(
        select(Reward)
        .where(Reward.id == reward_id, Reward.business_id == business.id)
        .options(selectinload(Reward.business))
    )
    if reward is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Reward not found")
    return reward


async def list_rewards(db: AsyncSession, business: Business) -> dict[str, object]:
    """Every reward of this business — inactive ones included, unlike the driver-facing list."""
    rewards = (
        await db.scalars(
            select(Reward)
            .where(Reward.business_id == business.id)
            .options(selectinload(Reward.business))
            .order_by(Reward.created_at.desc())
        )
    ).all()
    return {"rewards": [RewardOut.from_orm_reward(r) for r in rewards]}


async def create_reward(db: AsyncSession, business: Business, dto: BusinessRewardIn) -> RewardOut:
    category = _parse_category(dto.category) if dto.category else business.category

    reward = Reward(
        business_id=business.id,
        title_he=dto.title_he,
        title_en=dto.title_en,
        description_he=dto.description_he,
        description_en=dto.description_en,
        category=category,
        cost_points=dto.cost_points,
        image_icon=dto.image_icon,
        is_active=dto.is_active,
        stock=dto.stock,
        expires_at=dto.expires_at,
    )
    db.add(reward)
    await db.commit()
    await db.refresh(reward)
    reward.business = business  # already loaded — spares RewardOut a lazy load
    audit("business.reward.created", business_id=business.id, reward_id=reward.id, cost_points=reward.cost_points)
    return RewardOut.from_orm_reward(reward)


async def update_reward(db: AsyncSession, business: Business, reward_id: str, dto: BusinessRewardPatchIn) -> RewardOut:
    reward = await _owned_reward(db, business, reward_id)

    changes = dto.model_dump(exclude_unset=True)
    if "category" in changes and changes["category"] is not None:
        changes["category"] = _parse_category(changes["category"])
    for field, value in changes.items():
        setattr(reward, field, value)

    # No refresh(): the session is expire_on_commit=False, so `reward.business`
    # stays loaded from _owned_reward. A refresh would expire it and RewardOut
    # would trip a lazy load on the async session.
    await db.commit()
    audit("business.reward.updated", business_id=business.id, reward_id=reward.id, fields=sorted(changes))
    return RewardOut.from_orm_reward(reward)


async def delete_reward(db: AsyncSession, business: Business, reward_id: str) -> None:
    """Hard-delete a reward, but only while no voucher was ever issued for it.

    Redemption.reward_id is NOT NULL with no cascade: deleting a reward that
    drivers already redeemed would take their voucher history with it. Once a
    voucher exists the reward is history, so the caller is told to deactivate it
    instead — an inactive reward already disappears from the driver marketplace.
    """
    reward = await _owned_reward(db, business, reward_id)

    issued = await db.scalar(select(func.count()).select_from(Redemption).where(Redemption.reward_id == reward.id))
    if issued:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Reward has issued vouchers and cannot be deleted — set isActive to false instead",
        )

    await db.delete(reward)
    await db.commit()
    audit("business.reward.deleted", business_id=business.id, reward_id=reward_id)

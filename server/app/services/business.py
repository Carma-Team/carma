from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import CursorResult, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.audit import audit
from app.models import Business, BusinessCategory, Redemption, RedemptionStatus, Reward
from app.schemas.reward import BusinessRewardIn, BusinessRewardPatchIn, RewardOut, VoucherOut
from app.services import rewards as rewards_service

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


# ── Vouchers ─────────────────────────────────────────────────────────────────


async def _owned_voucher(db: AsyncSession, business: Business, code: str) -> Redemption:
    """Load a voucher issued against one of this business's rewards, or 404.

    Settles the TTL first, so a caller always sees a voucher's true current state
    rather than a PENDING row that lapsed minutes ago. A voucher belonging to
    another business is a 404 like an unknown code — a distinct error would let
    one business probe another's codes.
    """
    await rewards_service.expire_overdue(db, Redemption.qr_code == code)

    voucher = await db.scalar(
        select(Redemption)
        .where(Redemption.qr_code == code)
        .options(selectinload(Redemption.reward).selectinload(Reward.business))
    )
    if voucher is None or voucher.reward.business_id != business.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Voucher not found")
    return voucher


async def peek_voucher(db: AsyncSession, business: Business, code: str) -> VoucherOut:
    """What a scan shows before anyone commits to handing over the goods.

    Read-only on purpose: an employee scanning to check validity must not burn
    the voucher, and a scan that fails halfway must not leave it consumed.
    """
    return VoucherOut.from_orm_redemption(await _owned_voucher(db, business, code))


async def consume_voucher(db: AsyncSession, business: Business, code: str) -> VoucherOut:
    """Mark a voucher USED — the step that finally closes the redemption loop."""
    voucher = await _owned_voucher(db, business, code)

    # Conditional UPDATE rather than a read-then-write: two tills scanning the
    # same QR at once must not both come back "valid, serve the customer".
    now = datetime.now(UTC)
    # Held as a plain value: the rollback below expires every instance in the
    # session, and reading voucher.id afterwards would trigger a lazy load.
    voucher_id = voucher.id
    # See the note in rewards.py: a DML execute returns a CursorResult at
    # runtime, but `execute` is typed as returning a plain Result.
    used: CursorResult[Any] = await db.execute(  # type: ignore[assignment]
        update(Redemption)
        .where(
            Redemption.id == voucher_id,
            Redemption.status == RedemptionStatus.PENDING,
            Redemption.expires_at > now,
        )
        .values(status=RedemptionStatus.USED, used_at=now)
    )
    if used.rowcount == 0:
        await db.rollback()
        # Re-read rather than trusting the status loaded a moment ago: whoever won
        # the race is the reason this lost, and the client deserves the real one.
        current = await db.scalar(select(Redemption.status).where(Redemption.id == voucher_id))
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Voucher already used" if current == RedemptionStatus.USED else "Voucher expired",
        )

    await db.commit()
    await db.refresh(voucher, attribute_names=["status", "used_at"])
    audit(
        "business.voucher.consumed",
        business_id=business.id,
        voucher_id=voucher.id,
        reward_id=voucher.reward_id,
        user_id=voucher.user_id,
    )
    return VoucherOut.from_orm_redemption(voucher)

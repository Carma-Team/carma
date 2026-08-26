from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import CursorResult, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.audit import audit
from app.core.security import normalise_voucher_code
from app.models import Business, BusinessCategory, Redemption, RedemptionStatus, Reward, User
from app.schemas.reward import BusinessRewardIn, BusinessRewardPatchIn, BusinessVoucherOut, RewardOut
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
    claimed = await rewards_service.claimed_by_reward(db, [r.id for r in rewards])
    return {
        "rewards": [
            RewardOut.from_orm_reward(r, rewards_service.available_units(r.stock, claimed.get(r.id, 0)))
            for r in rewards
        ]
    }


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
    # Brand new, so nothing can be claimed against it yet — the whole cap is free.
    return RewardOut.from_orm_reward(reward, reward.stock)


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
    claimed = await rewards_service.claimed_by_reward(db, [reward.id])
    return RewardOut.from_orm_reward(reward, rewards_service.available_units(reward.stock, claimed.get(reward.id, 0)))


async def live_voucher_count(db: AsyncSession, business: Business, reward_id: str) -> int:
    """Outstanding vouchers a business should know about before archiving this reward."""
    reward = await _owned_reward(db, business, reward_id)
    return await rewards_service.count_live_vouchers(db, reward.id)


async def archive_reward(db: AsyncSession, business: Business, reward_id: str) -> None:
    """Archive a reward — it leaves the catalog, but the row and its vouchers stay.

    Replaces the old hard delete, which `Redemption.reward_id` (NOT NULL, no
    cascade) made unsafe the moment a voucher existed — this used to 409 instead
    of risking that. Archiving sidesteps the FK entirely: nothing is removed, so
    a voucher already issued keeps working to its own expiry (CAR-111).
    """
    reward = await _owned_reward(db, business, reward_id)
    reward.archived_at = datetime.now(UTC)
    await db.commit()
    audit("business.reward.archived", business_id=business.id, reward_id=reward_id)


# ── Vouchers ─────────────────────────────────────────────────────────────────

# Same convention as `services.rewards`'s REWARD_* codes: a client branches on
# `detail["code"]`, never on `detail["message"]` — the two 409s below share a
# status code and used to share a bare-string detail too, which left "already
# used" and "expired" distinguishable only by sniffing English text (CAR-67).
VOUCHER_ALREADY_USED = "VOUCHER_ALREADY_USED"
VOUCHER_EXPIRED = "VOUCHER_EXPIRED"


async def _owned_voucher(db: AsyncSession, business: Business, code: str) -> Redemption:
    """Load a voucher issued against one of this business's rewards, or 404.

    Settles the TTL first, so a caller always sees a voucher's true current state
    rather than a PENDING row that lapsed minutes ago. A voucher belonging to
    another business is a 404 like an unknown code — a distinct error would let
    one business probe another's codes.
    """
    # Typed in at a counter as often as scanned, so it arrives in whatever case
    # and spacing the cashier used. Fold it once, here, and both the settle below
    # and the lookup see the form the database actually stores.
    code = normalise_voucher_code(code)

    # expire_overdue leaves the commit to its caller. Nothing else is in flight
    # here, so the settle is committed on its own before the row is read back.
    await rewards_service.expire_overdue(db, Redemption.qr_code == code)
    await db.commit()

    voucher = await db.scalar(
        select(Redemption)
        .where(Redemption.qr_code == code)
        .options(selectinload(Redemption.reward).selectinload(Reward.business))
    )
    if voucher is None or voucher.reward.business_id != business.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Voucher not found")
    return voucher


async def peek_voucher(db: AsyncSession, business: Business, code: str) -> BusinessVoucherOut:
    """What a scan shows before anyone commits to handing over the goods.

    Read-only on purpose: an employee scanning to check validity must not burn
    the voucher, and a scan that fails halfway must not leave it consumed.
    """
    voucher = await _owned_voucher(db, business, code)
    return await _voucher_out(db, voucher)


async def consume_voucher(db: AsyncSession, business: Business, code: str) -> BusinessVoucherOut:
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
        .where(Redemption.id == voucher_id, *rewards_service.live_voucher_where(now))
        .values(status=RedemptionStatus.USED, used_at=now, settled_at=now)
    )
    if used.rowcount == 0:
        await db.rollback()
        # Re-read rather than trusting the status loaded a moment ago: whoever won
        # the race is the reason this lost, and the client deserves the real one.
        current = await db.scalar(select(Redemption.status).where(Redemption.id == voucher_id))
        if current == RedemptionStatus.USED:
            raise HTTPException(
                status.HTTP_409_CONFLICT, {"code": VOUCHER_ALREADY_USED, "message": "Voucher already used"}
            )
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": VOUCHER_EXPIRED, "message": "Voucher expired"})

    # CAR-109: unconditional — CAR-73's reservation invariant (available =
    # points - reserved, enforced on the issue path) guarantees the points are
    # there. Gating this on balance would strand a voucher USED-but-unpaid
    # after the goods already left the till, which is worse than a negative
    # balance. Joins the conditional UPDATE above in the same transaction, so a
    # failure here rolls back the status flip too.
    new_points = await db.scalar(
        update(User)
        .where(User.id == voucher.user_id)
        .values(points=User.points - voucher.points_cost)
        .returning(User.points)
    )
    assert new_points is not None, "the voucher's user must still exist"
    if new_points < 0:
        audit(
            "rewards.points.negative_after_debit",
            user_id=voucher.user_id,
            voucher_id=voucher.id,
            points_cost=voucher.points_cost,
            resulting_points=new_points,
        )

    await db.commit()
    await db.refresh(voucher, attribute_names=["status", "used_at", "settled_at"])
    audit(
        "business.voucher.consumed",
        business_id=business.id,
        voucher_id=voucher.id,
        reward_id=voucher.reward_id,
        user_id=voucher.user_id,
    )
    return await _voucher_out(db, voucher)


async def _voucher_out(db: AsyncSession, voucher: Redemption) -> BusinessVoucherOut:
    """BusinessVoucherOut with the reward's availability counted for it."""
    claimed = await rewards_service.claimed_by_reward(db, [voucher.reward_id])
    available = rewards_service.available_units(voucher.reward.stock, claimed.get(voucher.reward_id, 0))
    return BusinessVoucherOut.from_orm_redemption(voucher, available)

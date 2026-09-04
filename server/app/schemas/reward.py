from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import Field

from app.schemas._base import CamelModel


class RewardOut(CamelModel):
    id: str
    business_id: str
    business: str
    business_he: str | None
    title_he: str
    title_en: str | None
    description_he: str
    description_en: str | None
    category: str
    cost_points: int
    image_icon: str
    is_active: bool
    # None while the reward is still in the catalog; set once a business archives
    # it (CAR-111). Independent of is_active — see the model for why.
    archived_at: datetime | None
    # stock is the total the business allocated; available is what is left of it
    # right now. Both use None for "unlimited". `available` is passed in rather
    # than read off the model because it is derived from the redemptions ledger,
    # not stored — every caller has to decide how to count it.
    stock: int | None
    available: int | None
    expires_at: datetime | None

    @classmethod
    def from_orm_reward(cls, reward: Any, available: int | None) -> RewardOut:
        return cls.model_validate(
            {
                "id": reward.id,
                "business_id": reward.business_id,
                "business": reward.business.name,
                "business_he": reward.business.name_he,
                "title_he": reward.title_he,
                "title_en": reward.title_en,
                "description_he": reward.description_he,
                "description_en": reward.description_en,
                "category": reward.category.value.lower(),
                "cost_points": reward.cost_points,
                "image_icon": reward.image_icon,
                "is_active": reward.is_active,
                "archived_at": reward.archived_at,
                "stock": reward.stock,
                "available": available,
                "expires_at": reward.expires_at,
            }
        )


class RewardSummaryOut(CamelModel):
    """Just enough of a reward to show on a settled redemption row (CAR-79).

    Deliberately not `RewardOut`: `available`/`stock` describe live inventory,
    which a history row — possibly for an archived reward — has no business
    computing.
    """

    id: str
    title_he: str
    title_en: str | None
    image_icon: str
    category: str

    @classmethod
    def from_orm_reward(cls, reward: Any) -> RewardSummaryOut:
        return cls.model_validate(
            {
                "id": reward.id,
                "title_he": reward.title_he,
                "title_en": reward.title_en,
                "image_icon": reward.image_icon,
                "category": reward.category.value.lower(),
            }
        )


class VoucherOut(CamelModel):
    id: str
    user_id: str
    reward_id: str
    code: str
    qr_data: str
    status: str
    is_used: bool
    expires_at: datetime
    redeemed_at: datetime | None
    created_at: datetime
    # Snapshot taken at issue time (CAR-70) — independent of reward.cost_points,
    # which is the reward's current, possibly since-changed, price.
    points_cost: int
    reward: RewardOut

    @classmethod
    def from_orm_redemption(cls, r: Any, available: int | None) -> VoucherOut:
        return cls.model_validate(
            {
                "id": r.id,
                "user_id": r.user_id,
                "reward_id": r.reward_id,
                "code": r.qr_code,
                "qr_data": r.qr_data or r.qr_code,
                "status": r.status.value.lower(),
                "is_used": r.status.value == "USED",
                "expires_at": r.expires_at,
                "redeemed_at": r.used_at,
                "created_at": r.created_at,
                "points_cost": r.points_cost,
                "reward": RewardOut.from_orm_reward(r.reward, available),
            }
        )


class BusinessVoucherOut(CamelModel):
    """VoucherOut's business-facing counterpart (CAR-78).

    A business only needs to know what to hand over and whether it has already
    been redeemed — never who the driver is. `user_id` stays off the wire here
    on purpose; `Redemption.user_id` itself is untouched and still readable
    internally.
    """

    id: str
    reward_id: str
    code: str
    qr_data: str
    status: str
    is_used: bool
    expires_at: datetime
    redeemed_at: datetime | None
    created_at: datetime
    points_cost: int
    reward: RewardOut

    @classmethod
    def from_orm_redemption(cls, r: Any, available: int | None) -> BusinessVoucherOut:
        return cls.model_validate(
            {
                "id": r.id,
                "reward_id": r.reward_id,
                "code": r.qr_code,
                "qr_data": r.qr_data or r.qr_code,
                "status": r.status.value.lower(),
                "is_used": r.status.value == "USED",
                "expires_at": r.expires_at,
                "redeemed_at": r.used_at,
                "created_at": r.created_at,
                "points_cost": r.points_cost,
                "reward": RewardOut.from_orm_reward(r.reward, available),
            }
        )


class BusinessVoucherResponse(CamelModel):
    voucher: BusinessVoucherOut


class BusinessRewardIn(CamelModel):
    """Create payload for a business-owned reward.

    `business_id` is deliberately absent — the server takes it from the caller's
    own business, so a client cannot post a reward into someone else's catalog.
    `category` defaults to the business's category when omitted.
    """

    title_he: str = Field(min_length=1, max_length=120)
    title_en: str | None = Field(default=None, max_length=120)
    description_he: str = Field(min_length=1, max_length=500)
    description_en: str | None = Field(default=None, max_length=500)
    category: str | None = None
    cost_points: int = Field(ge=1)
    image_icon: str = Field(default="gift-outline", max_length=40)
    is_active: bool = True
    # Omitted means unlimited. It defaulted to 0 before stock was enforced, which
    # under the new meaning would make every reward created without an explicit
    # stock born sold out.
    stock: int | None = Field(default=None, ge=0)
    expires_at: datetime | None = None


class BusinessRewardPatchIn(CamelModel):
    """Partial update — only the fields actually sent are applied."""

    title_he: str | None = Field(default=None, min_length=1, max_length=120)
    title_en: str | None = Field(default=None, max_length=120)
    description_he: str | None = Field(default=None, min_length=1, max_length=500)
    description_en: str | None = Field(default=None, max_length=500)
    category: str | None = None
    cost_points: int | None = Field(default=None, ge=1)
    image_icon: str | None = Field(default=None, max_length=40)
    is_active: bool | None = None
    stock: int | None = Field(default=None, ge=0)
    expires_at: datetime | None = None


class BusinessRewardListOut(CamelModel):
    rewards: list[RewardOut]


class LiveVoucherCountOut(CamelModel):
    """How many outstanding vouchers a reward has right now — check before archiving it."""

    live_vouchers: int


class BusinessRewardResponse(CamelModel):
    reward: RewardOut


class RewardListOut(CamelModel):
    rewards: list[RewardOut]
    vouchers: list[VoucherOut]


class VoucherListOut(CamelModel):
    vouchers: list[VoucherOut]


class VoucherResponse(CamelModel):
    voucher: VoucherOut

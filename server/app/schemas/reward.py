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
    stock: int
    expires_at: datetime | None

    @classmethod
    def from_orm_reward(cls, reward: Any) -> RewardOut:
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
                "stock": reward.stock,
                "expires_at": reward.expires_at,
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
    reward: RewardOut

    @classmethod
    def from_orm_redemption(cls, r: Any) -> VoucherOut:
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
                "reward": RewardOut.from_orm_reward(r.reward),
            }
        )


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
    stock: int = Field(default=0, ge=0)
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


class BusinessRewardResponse(CamelModel):
    reward: RewardOut


class RewardListOut(CamelModel):
    rewards: list[RewardOut]
    vouchers: list[VoucherOut]


class VoucherListOut(CamelModel):
    vouchers: list[VoucherOut]


class VoucherResponse(CamelModel):
    voucher: VoucherOut

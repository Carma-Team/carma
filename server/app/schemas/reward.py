from __future__ import annotations

from datetime import datetime
from typing import Any

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
    #: The business's list price — the same for everyone.
    cost_points: int
    #: What the requesting driver pays after their level discount. Present only
    #: where a viewer is in scope (the rewards catalogue); absent on the reward
    #: embedded in a voucher, which is the catalogue entry rather than the
    #: transaction. The price actually charged is in the audit log.
    effective_cost_points: int | None = None
    image_icon: str
    is_active: bool
    stock: int
    expires_at: datetime | None

    @classmethod
    def from_orm_reward(cls, reward: Any, effective_cost_points: int | None = None) -> RewardOut:
        return cls.model_validate(
            {
                "effective_cost_points": effective_cost_points,
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


class RewardListOut(CamelModel):
    rewards: list[RewardOut]
    vouchers: list[VoucherOut]


class VoucherListOut(CamelModel):
    vouchers: list[VoucherOut]


class VoucherResponse(CamelModel):
    voucher: VoucherOut

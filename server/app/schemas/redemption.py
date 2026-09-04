from __future__ import annotations

from datetime import datetime
from typing import Any

from app.schemas._base import CamelModel
from app.schemas.reward import RewardSummaryOut


class BusinessRedemptionOut(CamelModel):
    """One settled row of a business's redemption history (CAR-79).

    No driver identifier anywhere here — the same boundary `BusinessVoucherOut`
    draws (CAR-78). `consumed_by_*` names the business staff member who
    scanned it (CAR-75), never the driver who redeemed it.
    """

    id: str
    reward: RewardSummaryOut
    status: str
    points_cost: int
    created_at: datetime
    settled_at: datetime
    consumed_by_user_id: str | None
    consumed_by_name: str | None

    @classmethod
    def from_orm_redemption(cls, r: Any, consumed_by_name: str | None) -> BusinessRedemptionOut:
        return cls.model_validate(
            {
                "id": r.id,
                "reward": RewardSummaryOut.from_orm_reward(r.reward),
                "status": r.status.value.lower(),
                "points_cost": r.points_cost,
                "created_at": r.created_at,
                "settled_at": r.settled_at,
                "consumed_by_user_id": r.consumed_by_user_id,
                "consumed_by_name": consumed_by_name,
            }
        )


class BusinessRedemptionListOut(CamelModel):
    redemptions: list[BusinessRedemptionOut]
    live_voucher_count: int
    next_cursor: str | None

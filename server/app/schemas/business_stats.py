from __future__ import annotations

from pydantic import Field

from app.schemas._base import CamelModel


class TopRewardOut(CamelModel):
    """One entry of the most-redeemed-rewards ranking (CAR-81)."""

    reward_id: str
    title_he: str
    title_en: str | None
    redemption_count: int


class SoldOutRewardOut(CamelModel):
    """A reward with no units left — same derived availability as CAR-47's `available`."""

    reward_id: str
    title_he: str
    title_en: str | None


class BusinessStatsOut(CamelModel):
    """Redemption performance snapshot for the authenticated business (CAR-81).

    Every field is a database aggregate scoped to this business alone — nothing
    here loads redemption rows into application memory, so the response stays
    the same size no matter how many vouchers the business has ever issued.
    """

    redemptions_today: int
    redemptions_last_30_days: int
    live_vouchers: int
    # Sum of `Redemption.points_cost` — the points a voucher was issued at
    # (CAR-70), not `Reward.cost_points`, which may have since changed.
    total_points_charged: int
    # Every voucher ever issued to this business, any status — PENDING and
    # live vouchers included, not just settled ones.
    vouchers_issued: int
    vouchers_redeemed: int
    issued_to_redeemed_ratio: float | None = Field(
        description=(
            "Redeemed vouchers divided by issued vouchers. A lower value means a "
            "larger share of issued vouchers were not redeemed. `null` when this "
            "business has not issued any vouchers yet — a ratio has no meaning "
            "against a zero denominator."
        )
    )
    top_rewards: list[TopRewardOut]
    sold_out_rewards: list[SoldOutRewardOut]

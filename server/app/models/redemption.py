from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, DateTime, Enum, ForeignKey, Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base
from app.models.enums import RedemptionStatus

if TYPE_CHECKING:
    from app.models.reward import Reward
    from app.models.user import User


class Redemption(Base):
    __tablename__ = "redemptions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: uuid.uuid4().hex)
    user_id: Mapped[str] = mapped_column(String(32), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    reward_id: Mapped[str] = mapped_column(String(32), ForeignKey("rewards.id"), nullable=False)
    # Snapshot of Reward.business_id at issue time, not a join — CAR-79's history
    # is paged per business on (settled_at, id), and a reward never changes owner,
    # so denormalizing here is what lets that ordering stay a single indexed scan
    # instead of a join fanning out over every reward the business has ever had.
    business_id: Mapped[str] = mapped_column(String(32), ForeignKey("businesses.id"), nullable=False)
    # Snapshot of Reward.cost_points at issue time. A later price change on the
    # reward must not reprice a voucher already handed to a driver (CAR-70).
    points_cost: Mapped[int] = mapped_column(Integer, nullable=False)
    qr_code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    qr_data: Mapped[str | None] = mapped_column(String(64))
    status: Mapped[RedemptionStatus] = mapped_column(
        Enum(RedemptionStatus, name="redemption_status"),
        default=RedemptionStatus.PENDING,
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # When this voucher left the live state — set in the same statement as the
    # status write, on every terminal transition (consume, expire, cancel), so
    # the two can never disagree. NULL iff PENDING (see the check constraint
    # below). Distinct from used_at: this answers "when did the lifecycle end",
    # used_at answers "was it redeemed, and when" — EXPIRED/CANCELLED rows set
    # this and leave used_at NULL.
    settled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    user: Mapped[User] = relationship(back_populates="redemptions")
    reward: Mapped[Reward] = relationship(back_populates="redemptions")

    __table_args__ = (
        Index("ix_redemptions_user_status", "user_id", "status"),
        # CAR-72: the reissue-cooldown lookup and the CAR-71 live-voucher-cap
        # lookup both scope to one (driver, reward) pair, but the cooldown
        # query spans three different statuses (EXPIRED, CANCELLED, a lapsed
        # PENDING) rather than one equality, so it cannot narrow past user_id
        # on ix_redemptions_user_status above — it would otherwise scan a
        # driver's entire redemption history, across every reward, on every
        # redeem() call. This index lets it seek straight to this reward's
        # rows regardless of how large the driver's history elsewhere is.
        Index("ix_redemptions_user_reward_status", "user_id", "reward_id", "status"),
        Index("ix_redemptions_qr_code", "qr_code"),
        Index("ix_redemptions_business_settled_id", "business_id", "settled_at", "id"),
        CheckConstraint(
            "(status = 'PENDING') = (settled_at IS NULL)",
            name="ck_redemptions_settled_at_matches_status",
        ),
    )

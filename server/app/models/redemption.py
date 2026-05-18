from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, ForeignKey, Index, String, func
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

    user: Mapped[User] = relationship(back_populates="redemptions")
    reward: Mapped[Reward] = relationship(back_populates="redemptions")

    __table_args__ = (
        Index("ix_redemptions_user_status", "user_id", "status"),
        Index("ix_redemptions_qr_code", "qr_code"),
    )

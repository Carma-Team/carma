from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, CheckConstraint, DateTime, Enum, ForeignKey, Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base
from app.models.enums import BusinessCategory

if TYPE_CHECKING:
    from app.models.business import Business
    from app.models.redemption import Redemption


class Reward(Base):
    __tablename__ = "rewards"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: uuid.uuid4().hex)
    business_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False
    )
    title_he: Mapped[str] = mapped_column(String(120), nullable=False)
    title_en: Mapped[str | None] = mapped_column(String(120))
    description_he: Mapped[str] = mapped_column(String(500), nullable=False)
    description_en: Mapped[str | None] = mapped_column(String(500))
    category: Mapped[BusinessCategory] = mapped_column(
        Enum(BusinessCategory, name="business_category", create_type=False),
        default=BusinessCategory.OTHER,
        nullable=False,
    )
    cost_points: Mapped[int] = mapped_column(Integer, nullable=False)
    image_icon: Mapped[str] = mapped_column(String(40), default="gift-outline", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Independent of is_active: a pause vs. a permanent removal from the catalog.
    # NULL means still in the catalog; a timestamp means archived out of it. Kept
    # separate so a business can reactivate without losing the archive, and an
    # archived reward's own history (vouchers, redemptions) is never touched.
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Total units the business allocated to this reward — never decremented.
    # NULL means unlimited, 0 means sold out. What is left is derived from the
    # redemptions ledger (services/rewards.py), so a lapsed voucher releases its
    # unit with nothing to run and no counter that can drift.
    stock: Mapped[int | None] = mapped_column(Integer)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    business: Mapped[Business] = relationship(back_populates="rewards")
    redemptions: Mapped[list[Redemption]] = relationship(back_populates="reward")

    __table_args__ = (
        Index("ix_rewards_business_active", "business_id", "is_active"),
        Index("ix_rewards_category", "category"),
        CheckConstraint("stock IS NULL OR stock >= 0", name="ck_rewards_stock_non_negative"),
    )

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Enum, Float, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base
from app.models.enums import BusinessCategory

if TYPE_CHECKING:
    from app.models.reward import Reward
    from app.models.user import User


class Business(Base):
    __tablename__ = "businesses"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: uuid.uuid4().hex)
    owner_user_id: Mapped[str | None] = mapped_column(
        String(32), ForeignKey("users.id"), unique=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    category: Mapped[BusinessCategory] = mapped_column(
        Enum(BusinessCategory, name="business_category"),
        default=BusinessCategory.OTHER,
        nullable=False,
    )
    location_lat: Mapped[float] = mapped_column(Float, nullable=False)
    location_lng: Mapped[float] = mapped_column(Float, nullable=False)
    address: Mapped[str | None] = mapped_column(String(200))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    owner: Mapped["User | None"] = relationship(back_populates="business")
    rewards: Mapped[list["Reward"]] = relationship(back_populates="business", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_businesses_category", "category"),
        Index("ix_businesses_location", "location_lat", "location_lng"),
    )

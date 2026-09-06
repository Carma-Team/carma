from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Enum, Float, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base
from app.models.enums import BusinessCategory

if TYPE_CHECKING:
    from app.models.business_branch import BusinessBranch
    from app.models.reward import Reward
    from app.models.user import User


class Business(Base):
    __tablename__ = "businesses"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: uuid.uuid4().hex)
    owner_user_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("users.id"), unique=True)
    # Nullable: businesses that predate CAR-77 (seed data, anything created
    # before approval flowed through a join request) have none. Every Business
    # created via CAR-77's approve path always sets it, copied verbatim from the
    # BusinessJoinRequest — see services.business_join_requests.approve.
    registration_number: Mapped[str | None] = mapped_column(String(64), unique=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)  # canonical / English display name
    name_he: Mapped[str | None] = mapped_column(String(120))  # Hebrew override; falls back to `name`
    category: Mapped[BusinessCategory] = mapped_column(
        Enum(BusinessCategory, name="business_category"),
        default=BusinessCategory.OTHER,
        nullable=False,
    )
    # Superseded by `business_branches` (CAR-341 continuation) as of
    # 0034_business_branches: the profile API and the Branches UI both read
    # and write branch rows now, never these three directly. Frozen at
    # whatever this business had when it was created or migrated — kept only
    # because dropping a NOT NULL column here has to outlive a full deploy
    # cycle (see 0033_drop_users_city's own note on the same hazard), not
    # because anything still depends on them being live.
    location_lat: Mapped[float] = mapped_column(Float, nullable=False)
    location_lng: Mapped[float] = mapped_column(Float, nullable=False)
    address: Mapped[str | None] = mapped_column(String(200))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    owner: Mapped[User | None] = relationship(back_populates="business")
    rewards: Mapped[list[Reward]] = relationship(back_populates="business", cascade="all, delete-orphan")
    branches: Mapped[list[BusinessBranch]] = relationship(back_populates="business", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_businesses_category", "category"),
        Index("ix_businesses_location", "location_lat", "location_lng"),
    )

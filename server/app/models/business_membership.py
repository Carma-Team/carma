from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, ForeignKey, Index, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base
from app.models.enums import BusinessMembershipRole

if TYPE_CHECKING:
    from app.models.business import Business
    from app.models.user import User


def _new_id() -> str:
    return uuid.uuid4().hex


class BusinessMembership(Base):
    """A user's business-scoped role (CAR-74) — never a global one.

    `current_business` (`core/deps.py`) resolves both the business and the role
    from this table on every request; nothing about business authorization is
    ever read off the JWT or off `User.role`, which stays a separate, global
    concept (see `UserRole`). A user can hold this alongside any `UserRole`,
    including `DRIVER` — that is the whole point of moving the role off `User`.
    """

    __tablename__ = "business_memberships"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_new_id)
    user_id: Mapped[str] = mapped_column(String(32), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    business_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[BusinessMembershipRole] = mapped_column(
        Enum(BusinessMembershipRole, name="business_membership_role"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    user: Mapped[User] = relationship()
    business: Mapped[Business] = relationship()

    __table_args__ = (
        UniqueConstraint("user_id", "business_id", name="uq_business_memberships_user_business"),
        Index("ix_business_memberships_business", "business_id"),
    )
